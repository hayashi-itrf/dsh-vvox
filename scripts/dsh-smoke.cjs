// Actual installed DSH AgentLoop with a deterministic, offline model adapter.
// No profile, credentials, or persisted user conversations are read or changed.
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const { join } = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const installed = createRequire(join(process.resourcesPath, 'app.asar/dsh/package.json'));
const { Context } = installed('@deepseek-ai/cordis');
const { SessionStore } = installed('@deepseek-ai/dsh-session');
const { CommandRuntime } = installed('@deepseek-ai/dsh-commands');
const { AgentRegistry } = installed('@deepseek-ai/dsh-agent');
const { AgentLoop } = installed('@deepseek-ai/dsh-agent-loop');
const { LlmRuntime, LlmAdapter } = installed('@deepseek-ai/dsh-llm');
const { ToolsService } = installed('@deepseek-ai/dsh-tools');
const { SystemPrompt } = installed('@deepseek-ai/dsh-system-prompt');
const { SessionProjectionRegistry } = installed('@deepseek-ai/dsh-session-projection');
const { VoicevoxClient } = require('../lib/speech.js');
const plugin = require('../index.js');

(async () => {
  const root = new Context(), spoken = [], playing = [];
  const { probeStream } = await import('./stream-probe.mjs');
  const original = VoicevoxClient.prototype.speak;
  let complete, failed, committed = false, handle;
  const playback = new Promise((resolve, reject) => { complete = resolve; failed = reject; });
  const deadline = setTimeout(() => failed(new Error('DSH streaming smoke timed out')), 60000);
  playback.catch(() => {});
  VoicevoxClient.prototype.speak = async function (text, signal) {
    this.available = () => {};
    this.playStream = probeStream;
    console.log('Speech started:', text);
    spoken.push(text);
    const task = original.call(this, text, signal);
    playing.push(task);
    try {
      await task;
      if (spoken.length === 1) {
        assert.equal(committed, false, 'first audio must finish BEFORE model settlement');
        complete();
      }
    } catch (error) { failed(error); throw error; }
  };
  const first = '文章を書いている途中から、読み上げています。';
  const last = '続きも一度だけ再生します。';
  class FixtureAdapter extends LlmAdapter {
    async *stream() {
      console.log('Fixture model streaming');
      yield { type: 'block-start', index: 0, blockType: 'reasoning' };
      yield { type: 'reasoning-delta', index: 0, text: 'この思考は読み上げません。' };
      yield { type: 'block-end', index: 0, block: { type: 'reasoning', text: 'この思考は読み上げません。' } };
      yield { type: 'block-start', index: 1, blockType: 'text' };
      for (const text of first) { yield { type: 'text-delta', index: 1, text }; await delay(15); }
      await playback;
      for (const text of last) { yield { type: 'text-delta', index: 1, text }; await delay(15); }
      yield { type: 'block-end', index: 1, block: { type: 'text', text: first + last } };
      yield { type: 'finish', reason: { kind: 'stop' } };
    }
  }
  try {
    for (const service of [SessionStore, SessionProjectionRegistry, AgentRegistry, LlmRuntime,
      SystemPrompt, ToolsService, CommandRuntime, AgentLoop]) {
      console.log('Mounting', service.name);
      await root.plugin(service);
    }
    root.on('agent/error', ({ error }) => failed(error));
    await root.plugin(installed('@deepseek-ai/dsh-tool-executor-native'));
    root.llm.registerAdapter(['voicevox-test'], new FixtureAdapter());
    const fiber = root.plugin(plugin); await fiber;
    root.on('agent/assistant-stream', ({ frame }) => { if (frame.type !== 'chunk') console.log('Stream frame', frame.type); });
    root.on('session/event', (_session, event) => { console.log('Event', event.type); if (event.type === 'assistant/message') committed = true; });
    handle = await root.agents.create({ agentOptions: { provider: 'voicevox-test', model: 'fixture' } });
    console.log('Agent created');
    await handle.agent.followup({ content: [{ type: 'text', text: 'ストリーミングのテスト' }], source: { kind: 'user' } });
    await Promise.race([handle.agent.whenIdle(), playback.then(() => new Promise(() => {}))]);
    await playback;
    const finishDeadline = Date.now() + 30000;
    while (spoken.length < 2 && Date.now() < finishDeadline) await delay(20);
    await Promise.all(playing);
    assert.equal(committed, true);
    assert.deepEqual(spoken, [first, last]);
    root.sessions.create(undefined, { seed: handle.agent.session.events });
    await fiber.dispose();
    assert.deepEqual(spoken, [first, last]);
    console.log('PASS: real DSH AgentLoop live deltas → VOICEVOX streaming PCM BEFORE model completion; final event does not repeat audio (headless probe)');
  } finally {
    clearTimeout(deadline);
    await handle?.dispose();
    await root.fiber.dispose();
    VoicevoxClient.prototype.speak = original;
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
