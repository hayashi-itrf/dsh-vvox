import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { LiveText } from '../lib/live-text.js';
import { LiveSpeech } from '../lib/live-speech.js';
import { SpeechQueue, validateConfig } from '../lib/speech.js';

test('fragmented Markdown, think tags, URLs and code never leak into live speech', () => {
  const spoken = [];
  const text = new LiveText(s => spoken.push(s));
  const input = '# 結果\nこんにちは。\n```js\n秘密。secret!\n```\n<think>思考。\nまだ秘密！</think>\n[説明](https://example.com/a(b))と`確認`。\n![画像](file.png)\nhttps://example.com/foo?q=secret\n    インデントコード。\n終わり。';
  for (const char of input) text.push(char);
  text.finish();
  assert.equal(spoken.join(''), '結果こんにちは。説明と確認。終わり。');
});

test('sentence arrives before finish, idle tail flushes, cap and disposal bound output', async () => {
  const spoken = [];
  const text = new LiveText(s => spoken.push(s), { maxChars: 100, flushDelayMs: 20 });
  text.push('最初の文です。');
  assert.deepEqual(spoken, ['最初の文です。']);
  text.push('次の文章はまだ書いている途中です');
  await delay(35);
  assert.equal(spoken.length, 2);
  text.push('あ'.repeat(200));
  text.finish();
  assert.equal(spoken.at(-1), '以下省略します。');
  assert.equal(Array.from(spoken.slice(0, -1).join('')).length, 100);
  const cancelled = new LiveText(s => spoken.push(s), { flushDelayMs: 20 });
  const count = spoken.length;
  cancelled.push('これは停止する文章です'); cancelled.cancel(); await delay(35);
  assert.equal(spoken.length, count);
});

test('comparison signs do not swallow the rest of the reply', () => {
  const spoken = [], parser = new LiveText(s => spoken.push(s));
  for (const char of '条件は 1 < 2 です。これで完了です。') parser.push(char);
  parser.finish();
  assert.equal(spoken.join(''), '条件は 1 ＜ 2 です。これで完了です。');
});

function fixture() {
  const output = [], stops = [];
  const config = validateConfig();
  const queue = { enqueue: (text, session, group) => { output.push({ text, session, group }); return Promise.resolve({ ok: true }); },
    stop: (...args) => stops.push(args), dispose: async () => {} };
  const live = new LiveSpeech(queue, config);
  const session = { id: 's', header: {}, firstLiveSeq: 0 }, agent = { session };
  let index = 0, revision = 0, attemptId = 'a';
  const start = (id = 'a') => { index = 0; attemptId = id; live.frame({ agent, frame: { type: 'start', attemptId, revision: ++revision, turn: 1, step: 0 } }); };
  const frame = chunk => live.frame({ agent, frame: { type: 'chunk', attemptId, revision: ++revision, index: index++, time: 0, chunk } });
  const delta = (text, block = 0) => frame({ type: 'text-delta', index: block, text });
  const commit = (text, extra = {}) => live.event(session, { type: 'assistant/message', seq: 10, surfaceOp: 'append', data: {
    turn: 1, step: 0, message: { role: 'assistant', content: [{ type: 'text', text }] }, ...extra } });
  const end = (kind = 'committed', eventType = 'assistant/message') => live.frame({ agent, frame: { type: 'end', attemptId, revision: ++revision, index, outcome: { kind, eventType, seq: 10 } } });
  return { live, session, agent, start, frame, delta, commit, end, output, stops };
}

test('DSH live deltas speak early; block-end + durable-before-end do not repeat', async () => {
  const f = fixture(); f.start();
  f.frame({ type: 'reasoning-delta', index: 0, text: '秘密。' });
  f.delta('最初です。', 1);
  assert.deepEqual(f.output.map(x => x.text), ['最初です。']);
  f.delta('文末', 1);
  f.frame({ type: 'block-end', index: 1, block: { type: 'text', text: '最初です。文末' } });
  f.commit('最初です。文末'); f.end(); f.commit('最初です。文末');
  assert.deepEqual(f.output.map(x => x.text), ['最初です。', '文末']);
  await f.live.dispose();
});

test('stop mutes later deltas and final settlement but allows the next attempt', async () => {
  const f = fixture(); f.start(); f.delta('最初。'); f.live.stop();
  f.delta('続き。'); f.commit('最初。続き。'); f.end();
  assert.deepEqual(f.output.map(x => x.text), ['最初。']);
  f.start('b'); f.delta('次の返答。'); f.end();
  assert.equal(f.output.at(-1).text, '次の返答。');
  await f.live.dispose();
});

test('retry/abandon cancels only the failed attempt; old and duplicate frames are ignored', async () => {
  const f = fixture(); f.start(); f.delta('失敗予定。');
  const group = f.output[0].group;
  f.end('abandoned');
  assert.ok(f.stops.some(([session, stoppedGroup]) => session === 's' && stoppedGroup === group));
  f.start('b'); f.delta('成功。');
  f.live.frame({ agent: f.agent, frame: { type: 'chunk', attemptId: 'a', revision: 1, index: 1, chunk: { type: 'text-delta', index: 0, text: '古い。' } } });
  f.live.frame({ agent: f.agent, frame: { type: 'chunk', attemptId: 'b', revision: 1, index: 0, chunk: { type: 'text-delta', index: 0, text: '重複。' } } });
  f.commit('成功。'); f.end();
  assert.deepEqual(f.output.map(x => x.text), ['失敗予定。', '成功。']);
  await f.live.dispose();
});

test('interrupted turns cancel current speech; subagents and replay stay silent', async () => {
  const f = fixture(); f.start(); f.delta('途中。');
  f.commit('途中。', { interrupted: true }); f.end();
  assert.ok(f.stops.length);
  const before = f.output.length;
  f.session.header.origin = 'subagent'; f.start('child'); f.delta('子供。'); f.commit('子供。');
  delete f.session.header.origin; f.session.firstLiveSeq = 20; f.commit('過去。');
  assert.equal(f.output.length, before);
  await f.live.dispose();
});

test('completed-only adapters and whole-block-only streams keep working', async () => {
  const f = fixture(); f.commit('確定のみ。');
  assert.equal(f.output[0].text, '確定のみ。');
  const g = fixture(); g.start();
  g.frame({ type: 'block-end', index: 0, block: { type: 'text', text: 'ブロックのみ。' } });
  g.commit('ブロックのみ。'); g.end();
  assert.deepEqual(g.output.map(x => x.text), ['ブロックのみ。']);
  await f.live.dispose(); await g.live.dispose();
});

test('stopping one queue group leaves other sessions and attempts alone', async () => {
  const played = [];
  const queue = new SpeechQueue(async text => { played.push(text); });
  const a = {}, b = {};
  const first = queue.enqueue('first', 's', a), second = queue.enqueue('second', 's', b), third = queue.enqueue('third', 'other', a);
  queue.stop('s', a);
  assert.equal((await first).ok, false);
  await Promise.all([second, third]);
  assert.deepEqual(played, ['second', 'third']);
  await queue.dispose();
});
