import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { BrowserAudioBridge } from '../lib/player.js';
import { PcmWaveReader, WebAudioStream } from '../lib/web-audio.js';
import { BrowserPlayer } from '../lib/browser-player.js';

function wave(channels = 1, frames = 100) {
  const wav = Buffer.alloc(44 + frames * channels * 2);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(channels, 22);
  wav.writeUInt32LE(24000, 24); wav.writeUInt32LE(48000 * channels, 28);
  wav.writeUInt16LE(channels * 2, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(frames * channels * 2, 40);
  for (let i = 44; i < wav.length; i += 2) wav.writeInt16LE(i % 4 ? 16384 : -16384, i);
  return wav;
}
const clientId = 'test-client';
const pull = (bridge, input = {}) => bridge.execute({ action: 'pull', clientId, ...input });

test('PCM parser accepts every byte boundary, deinterleaves stereo and rejects bad/truncated data', () => {
  const reader = new PcmWaveReader(), output = [];
  for (const byte of wave(2)) output.push(...reader.push(Uint8Array.of(byte)));
  reader.end();
  assert.equal(output.reduce((n, p) => n + p.frames, 0), 100);
  assert.ok(output.every(p => p.pcm[0][0] === -0.5 && p.pcm[1][0] === 0.5));
  assert.throws(() => new PcmWaveReader().push(Buffer.alloc(12)), /WAV/);
  const partial = new PcmWaveReader(); partial.push(wave().subarray(0, 45));
  assert.throws(() => partial.end(), /WAV/);
  const unsupported = wave(); unsupported.writeUInt16LE(3, 20);
  assert.throws(() => new PcmWaveReader().push(unsupported), /PCM16/);
});

test('Web Audio schedules PCM before EOF, uses audio clock and stops all scheduled buffers', () => {
  const scheduled = [], context = { currentTime: 10, destination: {},
    createBuffer: (channels, frames, rate) => ({ channels, frames, rate, copyToChannel() {} }),
    createBufferSource() { const s = { connect() {}, disconnect() {}, start(time) { s.time = time; scheduled.push(s); }, stop() { s.stopped = true; } }; return s; },
  };
  const player = new WebAudioStream(context), wav = wave(1, 2400);
  player.push(wav.subarray(0, 2444));
  assert.equal(scheduled.length, 1); assert.equal(player.ended, false);
  player.push(wav.subarray(2444)); player.end();
  assert.equal(scheduled[1].time, scheduled[0].time + 0.05);
  assert.equal(player.finished, false);
  context.currentTime = 11; assert.equal(player.finished, true);
  player.stop(); assert.ok(scheduled.every(s => s.stopped));
});

test('bridge streams BEFORE HTTP EOF and waits for renderer playback acknowledgement', async () => {
  const bridge = new BrowserAudioBridge(); await bridge.execute({ action: 'claim', clientId });
  let source, finished = false;
  const playing = bridge.play(new ReadableStream({ start(c) { source = c; } }), new AbortController().signal).then(() => { finished = true; });
  source.enqueue(wave()); await delay(10);
  const first = await pull(bridge); assert.ok(first.chunk); assert.equal(first.eof, false);
  await pull(bridge, { done: true, job: first.job }); assert.equal(finished, false);
  source.close(); await delay(10);
  assert.equal((await pull(bridge)).eof, true); assert.equal(finished, false);
  await pull(bridge, { done: true, job: first.job }); await playing;
  assert.equal(finished, true); bridge.dispose();
});

test('bridge cancellation covers stalled HTTP and waiting-for-playback after EOF', async () => {
  for (const eof of [false, true]) {
    const bridge = new BrowserAudioBridge(); await bridge.execute({ action: 'claim', clientId });
    let cancelled = false;
    const body = new ReadableStream({ start(c) { c.enqueue(wave()); if (eof) c.close(); }, cancel() { cancelled = true; } });
    const controller = new AbortController(); const playing = bridge.play(body, controller.signal);
    const rejected = assert.rejects(playing);
    await delay(10); controller.abort(); await rejected;
    assert.equal(bridge.job, null); if (!eof) assert.equal(cancelled, true);
    bridge.dispose();
  }
});

test('bridge bounds transport, expires disconnected renderers and prevents double playback', async () => {
  const bridge = new BrowserAudioBridge({ leaseMs: 80 });
  await bridge.execute({ action: 'claim', clientId });
  assert.equal((await bridge.execute({ action: 'claim', clientId: 'another-client' })).owner, false);
  const body = new ReadableStream({ start(c) { c.enqueue(Buffer.alloc(100000)); } });
  const playing = bridge.play(body, new AbortController().signal);
  const rejected = assert.rejects(playing, /接続が切れ/);
  await delay(30); assert.equal(bridge.job.chunks.length, 2);
  assert.equal((await bridge.execute({ action: 'pull', clientId: 'another-client' })).owner, false);
  await rejected; assert.equal(bridge.job, null); bridge.dispose();
});

test('explicit renderer takeover cancels existing audio; stale acknowledgements cannot finish next job', async () => {
  const bridge = new BrowserAudioBridge(); await bridge.execute({ action: 'claim', clientId });
  const playing = bridge.play(new ReadableStream(), new AbortController().signal);
  const rejected = assert.rejects(playing, /切り替わり/);
  await bridge.execute({ action: 'claim', clientId: 'another-client', takeover: true });
  await rejected; assert.equal((await pull(bridge)).owner, false);
  bridge.dispose();
});

test('browser loop plays through bridge before EOF, completes after audio time and disposes cleanly', async () => {
  const bridge = new BrowserAudioBridge(), started = [], states = [];
  class AudioContext {
    state = 'suspended'; destination = {};
    get currentTime() { return performance.now() / 1000; }
    async resume() { this.state = 'running'; }
    async close() { this.state = 'closed'; }
    createBuffer(channels, frames, rate) { return { copyToChannel() {}, duration: frames / rate }; }
    createBufferSource() {
      const source = { connect() {}, disconnect() {}, stop() { source.stopped = true; }, start(time) { source.time = time; started.push(source); } };
      return source;
    }
  }
  const player = new BrowserPlayer(input => bridge.execute(input), AudioContext);
  player.subscribe(() => states.push(player.state));
  await player.activate();
  let source;
  const controller = new AbortController();
  const played = bridge.play(new ReadableStream({ start(c) { source = c; c.enqueue(wave(1, 2400)); } }), controller.signal);
  played.catch(() => {});
  try {
    const deadline = Date.now() + 2000;
    while (!started.length && Date.now() < deadline) await delay(10);
    assert.equal(started.length, 1); // HTTP is intentionally still open.
    source.enqueue(wave(1, 2400).subarray(44)); source.close();
    await played;
    assert.equal(started.length, 2);
    assert.ok(player.context.currentTime >= started.at(-1).time + 0.1);
    assert.ok(states.includes('playingAudio'));
  } finally { controller.abort(); player.dispose(); await player.running; bridge.dispose(); }
  assert.equal(player.context.state, 'closed'); assert.ok(started.every(s => s.stopped));
});

test('browser transport failure immediately clears queued sources and releases ownership', async () => {
  const bridge = new BrowserAudioBridge(), sources = [];
  let fail = false;
  class AudioContext {
    state = 'running'; currentTime = 0; destination = {};
    async resume() {} async close() { this.state = 'closed'; }
    createBuffer() { return { copyToChannel() {} }; }
    createBufferSource() { const s = { connect() {}, disconnect() {}, start() { sources.push(s); }, stop() { s.stopped = true; } }; return s; }
  }
  const player = new BrowserPlayer(input => {
    if (fail && input.action === 'pull') throw new Error('connection lost');
    return bridge.execute(input);
  }, AudioContext);
  await player.activate();
  const played = bridge.play(new ReadableStream({ start(c) { c.enqueue(wave()); } }), new AbortController().signal);
  const rejected = assert.rejects(played);
  try {
    const deadline = Date.now() + 2000;
    while (!sources.length && Date.now() < deadline) await delay(10);
    assert.equal(sources.length, 1); fail = true;
    await player.running; await rejected;
    assert.ok(sources.every(s => s.stopped)); assert.equal(player.state, 'locked'); assert.equal(bridge.owner, null);
  } finally { player.dispose(); bridge.dispose(); }
});
