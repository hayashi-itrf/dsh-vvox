import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { messageText, cleanText, splitText } from '../lib/text.js';
import { SpeechQueue, VoicevoxClient, validateConfig } from '../lib/speech.js';
import { apply, Config } from '../index.js';

const session = { id: 'chat', header: {}, firstLiveSeq: 10 };
const event = { type: 'assistant/message', seq: 10, surfaceOp: 'append', data: {
  message: { role: 'assistant', content: [{ type: 'reasoning', text: '秘密の思考' },
    { type: 'text', text: 'こんにちは。' }, { type: 'tool_use', text: '秘密のツール' }] },
} };

test('only newly committed visible text is spoken; excludes replay, children and replacements', () => {
  assert.equal(messageText(session, event), 'こんにちは。');
  for (const change of [{ type: 'user/message' }, { seq: 9 }, { surfaceOp: 'replace' },
    { data: { ...event.data, interrupted: true } }]) assert.equal(messageText(session, { ...event, ...change }), '');
  assert.equal(messageText({ ...session, header: { origin: 'subagent' } }, event), '');
  assert.equal(messageText({ ...session, header: { parentSession: 'ordinary-fork' } }, event), 'こんにちは。');
});

test('speech cleanup strips fenced code including unclosed fences, reasoning and decoration', () => {
  const markdown = '# **結果**\n[説明](https://example.com) を `確認`。\n```js\nsecret()\n```\n~~~py\nsecret2()\n~~~\n![image](file.png)\n<think>secret</think>\n完了。\n```\nhidden';
  assert.equal(cleanText(markdown), '結果 説明 を 確認。 完了。');
  assert.equal(cleanText('あ'.repeat(101), 100), 'あ'.repeat(100) + '。以下省略します。');
  const input = 'あ'.repeat(200) + '。こんにちは！';
  const chunks = splitText(input);
  assert.equal(chunks.join(''), input);
  assert.ok(chunks.every(chunk => Array.from(chunk).length <= 180));
});

test('config rejects invalid ranges and non-local destinations', () => {
  assert.equal(Config({}).speaker, 3);
  for (const patch of [{ speed: NaN }, { speed: 0 }, { speaker: 1.5 }, { enabled: 'yes' },
    { endpoint: 'http://example.com' }, { endpoint: 'http://secret@localhost:50021' },
    { endpoint: 'file:///tmp/a' }]) assert.throws(() => validateConfig(patch));
  assert.equal(validateConfig({ endpoint: 'http://[::1]:50021/' }).endpoint, 'http://[::1]:50021');
});

test('FIFO prevents overlap; a failed utterance does not poison later audio', async () => {
  const order = [], errors = [];
  let active = 0;
  const queue = new SpeechQueue(async text => {
    assert.equal(++active, 1);
    order.push(text);
    await new Promise(resolve => setImmediate(resolve));
    active--;
    if (text === 'bad') throw new Error('offline');
  }, error => errors.push(error));
  const results = await Promise.all(['one', 'bad', 'three'].map(text => queue.enqueue(text, 'chat')));
  assert.deepEqual(order, ['one', 'bad', 'three']);
  assert.deepEqual(results.map(r => r.ok), [true, false, true]);
  assert.deepEqual(errors, ['offline']);
  await queue.dispose();
});

test('stop aborts active audio and drops pending work; later messages still work', async () => {
  let started;
  const entered = new Promise(resolve => { started = resolve; });
  const played = [];
  const queue = new SpeechQueue(async (text, signal) => {
    played.push(text);
    if (text === 'first') {
      started();
      await new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
    }
  });
  const first = queue.enqueue('first', 'one');
  const second = queue.enqueue('second', 'two');
  await entered;
  queue.stop();
  assert.equal((await first).ok, false);
  assert.equal((await second).ok, false);
  assert.equal((await queue.enqueue('third', 'one')).ok, true);
  assert.deepEqual(played, ['first', 'third']);
  await queue.dispose();
  assert.equal((await queue.enqueue('fourth', 'one')).ok, false);
});

test('a disposed session cancels only its audio and queue size is bounded', async () => {
  const queue = new SpeechQueue(async (_text, signal) => {
    signal.throwIfAborted();
    await new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  });
  const jobs = Array.from({ length: 20 }, () => queue.enqueue('text', 'one'));
  assert.equal((await queue.enqueue('overflow', 'one')).ok, false);
  queue.stop('different');
  assert.equal(queue.pending.length + Number(Boolean(queue.current)), 20);
  queue.stop('one');
  assert.ok((await Promise.all(jobs)).every(r => !r.ok));
  await queue.dispose();
});

function wav() {
  const audio = Buffer.alloc(48);
  audio.write('RIFF'); audio.writeUInt32LE(40, 4); audio.write('WAVE', 8);
  return audio;
}

test('actual HTTP client uses streaming endpoint and passes voice/speed/volume', async t => {
  const calls = [];
  const server = createServer(async (request, response) => {
    const body = [];
    for await (const part of request) body.push(part);
    calls.push({ url: request.url, body: Buffer.concat(body).toString() });
    if (request.url === '/version') response.end('"0.26.2"');
    else if (request.url.startsWith('/audio_query')) response.end('{"speedScale":1,"volumeScale":1}');
    else response.end(wav());
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const played = [];
  const config = validateConfig({ endpoint: `http://127.0.0.1:${server.address().port}`, speaker: 8, speed: 1.3, volume: 0.7 });
  const client = new VoicevoxClient(config, { playStream: async (body, signal) => {
    assert.deepEqual(Buffer.from(await new Response(body).arrayBuffer()), wav());
    played.push(true);
  } });
  await client.speak('一文。二文。', new AbortController().signal);
  assert.equal(played.length, 2);
  const query = new URL(calls[1].url, config.endpoint);
  assert.equal(query.searchParams.get('speaker'), '8');
  assert.equal(query.searchParams.get('text'), '一文。');
  assert.deepEqual(JSON.parse(calls[2].body), { speedScale: 1.3, volumeScale: 0.7 });
  assert.match(calls[2].url, /^\/streaming_synthesis\?speaker=8&segment_length=0.3$/);
});

test('abort propagates to stream playback and cancels the HTTP body', async () => {
  const controller = new AbortController();
  let stream;
  const client = new VoicevoxClient(validateConfig(), { playStream: async (body, signal) => {
    stream = body; assert.equal(signal, controller.signal); controller.abort(); throw controller.signal.reason;
  } });
  client.ready = async () => {};
  client.synthesize = async () => new Response(wav());
  await assert.rejects(client.speak('テスト。', controller.signal));
  assert.equal((await stream.getReader().read()).done, true);
});

test('older engine plays each sentence with normal synthesis and an upgrade restores streaming', async () => {
  let version = '0.25.0';
  const utterances = [], played = [], calls = [];
  const signal = new AbortController().signal;
  const config = validateConfig({ speaker: 8, speed: 1.3, volume: 0.7 });
  const client = new VoicevoxClient(config, {
    fetch: async (raw, options) => {
      const { pathname, searchParams } = new URL(raw);
      if (pathname === '/version') return Response.json(version);
      if (pathname === '/audio_query') {
        utterances.push(searchParams.get('text'));
        return Response.json({ speedScale: 1, volumeScale: 1 });
      }
      calls.push(pathname);
      assert.equal(searchParams.get('speaker'), '8');
      assert.deepEqual(JSON.parse(options.body), { speedScale: 1.3, volumeScale: 0.7 });
      if (pathname === '/streaming_synthesis' && version === '0.25.0') {
        return Response.json({ detail: 'Not Found' }, { status: 404 });
      }
      return new Response(wav());
    },
    playStream: async body => {
      assert.deepEqual(Buffer.from(await new Response(body).arrayBuffer()), wav());
      played.push(utterances.at(-1));
    },
  });
  await client.speak('一文。二文。', signal);
  assert.deepEqual(calls, ['/streaming_synthesis', '/synthesis', '/synthesis']);
  assert.equal(client.synthesisMode, 'standard');
  version = '0.26.2';
  await client.speak('新版。', signal);
  assert.equal(calls.at(-1), '/streaming_synthesis');
  assert.equal(client.synthesisMode, 'streaming');
  assert.deepEqual(played, ['一文。', '二文。', '新版。']);
});

test('synthesis failures on a supported endpoint surface without retrying normal synthesis', async () => {
  const requests = [];
  const client = new VoicevoxClient(validateConfig(), {
    fetch: async raw => {
      const { pathname } = new URL(raw);
      requests.push(pathname);
      if (pathname === '/audio_query') return Response.json({});
      return new Response('', { status: 422 });
    },
  });
  await assert.rejects(client.synthesize('一文。', new AbortController().signal), /streaming_synthesis: HTTP 422/);
  assert.deepEqual(requests, ['/audio_query', '/streaming_synthesis']);
});

test('VOICEVOX requests do not forward reply text through HTTP redirects', async t => {
  let redirectedRequests = 0;
  const server = createServer((request, response) => {
    if (request.url.startsWith('/audio_query?')) response.writeHead(307, { location: '/redirect-target' }).end();
    else { redirectedRequests++; response.end('{}'); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const client = new VoicevoxClient(validateConfig({ endpoint: `http://127.0.0.1:${server.address().port}` }));
  await assert.rejects(client.synthesize('テストの返信', new AbortController().signal));
  assert.equal(redirectedRequests, 0);
});

test('plugin lifecycle, duplicate suppression, commands and persisted config', async () => {
  const listeners = new Map(), cleanups = [], played = [];
  let definition, saved;
  const original = VoicevoxClient.prototype.speak;
  VoicevoxClient.prototype.speak = async text => { played.push(text); };
  const ctx = {
    provide() {}, inject() {}, logger: { warn() {} }, fiber: { entry: 'entry' },
    get: name => name === 'configEditor' ? { edit: async (entry, fn) => {
      assert.equal(entry, 'entry'); saved = fn({ unrelated: true });
    } } : undefined,
    effect: factory => cleanups.push(factory()),
    on: (name, callback) => listeners.set(name, callback),
    commands: { register: command => { definition = command; } },
  };
  try {
    apply(ctx);
    listeners.get('session/event')(session, event);
    listeners.get('session/event')(session, event);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(played, ['こんにちは。']);
    const invoke = rawInput => definition.handler({ rawInput, agent: { session }, signal: new AbortController().signal });
    assert.match((await invoke('status')).text, /ON/);
    assert.equal((await invoke('speed 1.5')).kind, 'success');
    assert.deepEqual(saved, { unrelated: true, speed: 1.5 });
    assert.equal((await invoke('speed 99')).kind, 'error');
    assert.equal((await invoke('test')).kind, 'success');
    assert.equal((await invoke('off')).kind, 'success');
    assert.equal(saved.enabled, false);
    for (const cleanup of cleanups) await cleanup();
  } finally { VoicevoxClient.prototype.speak = original; }
});
