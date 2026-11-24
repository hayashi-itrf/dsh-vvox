import test from 'node:test';
import assert from 'node:assert/strict';
import { VoicevoxSettings, registerSettings } from '../lib/settings.js';
import { SpeechQueue, validateConfig } from '../lib/speech.js';

const voices = [{ speaker_uuid: 'one', name: '一人目', styles: [{ id: 2, name: 'ノーマル' }, { id: 3, name: 'あまあま', type: 'talk' }, { id: 9, name: '歌', type: 'sing' }] }, { speaker_uuid: 'two', name: '二人目', styles: [{ id: 4, name: 'ノーマル', type: 'streaming_talk' }] }];
function fixture(speak = async () => {}) {
  let persisted = validateConfig({ speaker: 2 });
  const queue = new SpeechQueue(speak);
  const settings = new VoicevoxSettings(persisted, { speakers: async () => voices }, queue,
    async (patch, check) => { check(persisted); persisted = { ...persisted, ...patch }; },
    config => ({ speak: (text, signal) => speak(text, signal, config) }));
  return { settings, queue, read: () => persisted, change: patch => { persisted = { ...persisted, ...patch }; } };
}
test('settings save validates voices and persists all values atomically; stale drafts cannot overwrite', async () => {
  const f = fixture(), state = f.settings.state();
  const list = await f.settings.speakers();
  assert.deepEqual(list.map(s => s.styles.map(t => t.id)), [[2, 3], [4]]);
  const values = { speaker: 4, speed: 1.25, volume: 0.65 };
  assert.deepEqual(await f.settings.update(values, state.revision), { ...values, revision: JSON.stringify(values) });
  assert.equal(f.read().volume, 0.65);
  await assert.rejects(f.settings.update({ ...values, speaker: 9 }, state.revision), /見つかりません/);
  await assert.rejects(f.settings.update({ ...values, speed: 8 }, state.revision), /speed/);
  await assert.rejects(f.settings.update({ ...values, endpoint: 'http://example.com' }, state.revision), /指定/);
  await assert.rejects(f.settings.update(values, state.revision), /別の画面/);
  await f.queue.dispose();
});
test('preview uses unsaved values, shares serial audio queue, and does not persist', async () => {
  const played = [];
  const f = fixture(async (text, _signal, config) => { played.push({ text, config }); });
  const normal = f.queue.enqueue('chat', 'chat');
  const values = { speaker: 4, speed: 1.5, volume: 0.5 };
  await f.settings.preview(values, '試聴', new AbortController().signal); await normal;
  assert.deepEqual(played.map(x => x.text), ['chat', '試聴']);
  assert.equal(played[1].config.speaker, 4);
  assert.equal(played[1].config.volume, 0.5);
  assert.equal(f.read().speaker, 2);
  await f.queue.dispose();
});
test('preview cancellation leaves normal queued speech intact', async () => {
  let started; const entered = new Promise(r => { started = r; });
  const f = fixture(async (text, signal) => {
    if (text === 'preview') { started(); await new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })); }
  });
  const playing = f.settings.preview({ speaker: 2, speed: 1, volume: 1 }, 'preview', new AbortController().signal);
  await entered;
  const next = f.queue.enqueue('chat', 'chat');
  f.settings.stop();
  assert.equal((await playing).stopped, true);
  assert.equal((await next).ok, true);
  await f.queue.dispose();
});
test('GUI route and agent tool share operations, errors and persistence', async () => {
  const f = fixture(); let rpc, tool;
  registerSettings({ provide() {}, effect() {}, inject(deps, fn) {
    if (deps[0] === 'connection') fn({ connection: { fetch: { register(route) { assert.equal(route.path, '/api/local-voicevox/settings'); rpc = route.fetch; } } } });
    else fn({ tools: { register(def) { tool = def; } } });
  } }, f.settings);
  const signal = new AbortController().signal;
  const ui = async input => (await (await rpc(new Request('http://localhost/api/local-voicevox/settings', { method: 'POST', body: JSON.stringify({ type: 'client-request', rpcId: 'test', method: 'local-voicevox/settings', payload: input }), signal }))).json()).result;
  const invoke = input => tool.execute(input, { signal });
  assert.deepEqual((await ui({ action: 'state' })).value, await invoke({ action: 'state' }));
  assert.deepEqual((await ui({ action: 'speakers' })).value, await invoke({ action: 'speakers' }));
  const state = await invoke({ action: 'state' });
  const input = { action: 'save', values: { speaker: 3, speed: 1.2, volume: 0.7 }, revision: state.revision };
  const fromTool = await invoke(input);
  assert.equal(f.read().speaker, 3);
  f.change({ speaker: 2, speed: 1.1, volume: 1 });
  assert.deepEqual((await ui(input)).value, fromTool);
  const bad = { ...input, values: { ...input.values, volume: -1 } };
  const failed = await ui(bad);
  await assert.rejects(invoke(bad), e => e.message === failed.error.message);
  assert.equal((await rpc(new Request('http://localhost/api/local-voicevox/settings', { method: 'POST', body: '{}' }))).status, 400);
  await f.queue.dispose();
});

test('stop while discovering voices cancels preparation and never starts audio', async () => {
  let release; const delayed = new Promise(r => { release = r; });
  const played = [];
  const f = fixture(async text => played.push(text));
  f.settings.client.speakers = async () => { await delayed; return voices; };
  const pending = f.settings.preview({ speaker: 2, speed: 1, volume: 1 }, 'preview', new AbortController().signal);
  f.settings.stop(); release();
  assert.deepEqual(await pending, { stopped: true });
  assert.deepEqual(played, []);
  await f.queue.dispose();
});
