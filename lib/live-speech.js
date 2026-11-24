import { messageText, cleanText } from './text.js';
import { LiveText } from './live-text.js';

/** Transient speech state only. DSH's durable log remains untouched. */
export class LiveSpeech {
  constructor(queue, config) {
    this.queue = queue; this.config = config;
    this.active = new Map();
    this.seen = new WeakMap();
  }
  frame({ agent, frame }) {
    const session = agent.session;
    if (!this.config.enabled || session.header?.origin === 'subagent') return;
    if (frame.type === 'start') {
      const previous = this.active.get(session);
      if (previous?.attemptId === frame.attemptId) return;
      if (previous) this.cancelState(session, previous);
      const state = { attemptId: frame.attemptId, revision: frame.revision, turn: frame.turn,
        step: frame.step, nextIndex: 0, blocks: new Map(), lengths: new Map(), group: {}, settled: false, muted: false, truncated: false };
      state.parser = new LiveText(text => { void this.queue.enqueue(text, session.id, state.group); }, this.config);
      this.active.set(session, state); return;
    }
    const state = this.active.get(session);
    // revision advances for EVERY publication, not just once per attempt.
    if (!state || state.attemptId !== frame.attemptId || frame.revision <= state.revision) return;
    state.revision = frame.revision;
    if (frame.type === 'chunk') {
      if (frame.index < state.nextIndex || state.settled || state.muted) return;
      // A gap means an incomplete subscription. Never invent the missing words.
      if (frame.index !== state.nextIndex) { this.cancelState(session, state); return; }
      state.nextIndex++;
      const chunk = frame.chunk;
      if (chunk.type === 'text-delta') this.block(state, chunk.index, chunk.text, false);
      else if (chunk.type === 'block-end' && chunk.block.type === 'text') this.block(state, chunk.index, chunk.block.text, true);
    } else if (frame.type === 'end') {
      if (frame.outcome.kind !== 'committed' || frame.outcome.eventType !== 'assistant/message') this.cancelState(session, state);
      else if (!state.muted) state.parser.finish();
      this.active.delete(session);
    }
  }
  block(state, index, text, complete) {
    if (typeof text !== 'string') return;
    const old = state.blocks.get(index) ?? '';
    const previousLength = state.lengths.get(index) ?? 0;
    const suffix = complete ? (text.startsWith(old) ? text.slice(previousLength) : '') : text;
    if (!state.blocks.has(index) && state.blocks.size) state.parser.push('\n');
    // Keep a bounded prefix for block-end reconciliation, even for enormous code output.
    state.blocks.set(index, (complete ? text : old + text).slice(0, 100000));
    const length = complete ? text.length : previousLength + text.length;
    state.lengths.set(index, length);
    if (length > 100000) state.truncated = true;
    if (suffix) state.parser.push(suffix);
  }
  event(session, event) {
    if (event.seq < session.firstLiveSeq) return;
    if (event.type === 'turn/end' && ['aborted', 'error', 'interrupted'].includes(event.data.reason.kind)) {
      this.stopSession(session); return;
    }
    if (!this.config.enabled || session.header?.origin === 'subagent' || event.type !== 'assistant/message'
        || event.surfaceOp !== 'append' || event.seq <= (this.seen.get(session) ?? -1)) return;
    this.seen.set(session, event.seq);
    const state = this.active.get(session);
    // The durable message is published BEFORE the live end frame. Settle here once.
    if (state && state.turn === event.data.turn && state.step === event.data.step) {
      state.settled = true;
      if (event.data.interrupted) { this.cancelState(session, state); return; }
      if (state.muted) return;
      const text = messageText(session, event);
      const streamed = [...state.blocks.values()].join('\n');
      if (!streamed) state.parser.push(text);
      else if (!state.truncated && text.startsWith(streamed)) state.parser.push(text.slice(streamed.length));
      state.parser.finish();
      return;
    }
    // Adapters without live frames still work, once, on the committed message.
    const text = cleanText(messageText(session, event), this.config.maxChars);
    if (text) void this.queue.enqueue(text, session.id);
  }
  cancelState(session, state) {
    state.muted = true; state.parser.cancel(); this.queue.stop(session.id, state.group);
  }
  stopSession(session) {
    const state = this.active.get(session);
    if (state) this.cancelState(session, state);
    this.queue.stop(session.id);
  }
  disposeSession(session) { this.stopSession(session); this.active.delete(session); }
  stop() {
    for (const [session, state] of this.active) this.cancelState(session, state);
    this.queue.stop();
  }
  async dispose() { this.stop(); this.active.clear(); await this.queue.dispose(); }
}
