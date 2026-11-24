import { WebAudioStream } from './web-audio.js';

export class BrowserPlayer {
  constructor(call, AudioContextClass = globalThis.AudioContext) {
    this.call = call; this.AudioContextClass = AudioContextClass;
    this.clientId = globalThis.crypto.randomUUID(); this.context = null;
    this.controller = new AbortController(); this.listeners = new Set();
    this.state = 'locked'; this.error = ''; this.job = null; this.stream = null;
    this.owned = false; this.activating = null; this.running = null;
  }
  notify(state, error = '') { this.state = state; this.error = error; for (const fn of this.listeners) fn(); }
  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  async rpc(input) {
    return this.call({ ...input, clientId: this.clientId }, AbortSignal.any([this.controller.signal, AbortSignal.timeout(3000)]));
  }
  activate(takeover = false) {
    if (this.controller.signal.aborted) return Promise.reject(new Error('音声再生を終了しました。'));
    // Must run synchronously in the click handler, before any network awaits.
    this.context ??= new this.AudioContextClass({ latencyHint: 'interactive' });
    const resumed = this.context.resume();
    if (this.activating) return this.activating;
    this.activating = (async () => {
      let timer;
      try {
        await Promise.race([resumed, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('音声を有効にするボタンを押してください。')), 1500); })]);
        if (this.context.state !== 'running') throw new Error('音声を有効にするボタンを押してください。');
        const result = await this.rpc({ action: 'claim', takeover });
        this.owned = result.owner;
        this.notify(result.owner ? 'ready' : 'elsewhere');
        if (result.owner && !this.running) {
          this.running = this.loop().finally(() => { this.running = null; });
        }
        return result.owner;
      } catch (error) { this.notify('locked', error.message); throw error; }
      finally { clearTimeout(timer); this.activating = null; }
    })();
    return this.activating;
  }
  clearAudio() { this.stream?.stop(); this.stream = null; this.job = null; }
  async loop() {
    try {
      while (!this.controller.signal.aborted && this.owned) {
        if (this.context.state !== 'running') throw new Error('音声が一時停止しています。読み上げを有効にしてください。');
        const result = await this.rpc({ action: 'pull', job: this.job, done: !!this.stream?.finished,
          accept: !this.stream || this.stream.bufferedSeconds < 0.75 });
        if (this.controller.signal.aborted) break;
        if (!result.owner) {
          this.clearAudio();
          const claimed = await this.rpc({ action: 'claim' });
          if (claimed.owner) continue;
          this.owned = false; this.notify('elsewhere'); break;
        }
        if (result.job !== this.job) {
          this.clearAudio(); this.job = result.job;
          if (this.job) this.stream = new WebAudioStream(this.context);
        }
        if (result.chunk) this.stream.push(Uint8Array.from(atob(result.chunk), c => c.charCodeAt(0)));
        if (result.eof) this.stream.end();
        const state = this.job ? 'playingAudio' : 'ready';
        if (this.state !== state) this.notify(state);
        await new Promise(resolve => { this.timer = setTimeout(resolve, this.job ? 30 : 200); this.wake = resolve; });
      }
    } catch (error) {
      this.stream?.stop();
      if (!this.controller.signal.aborted) {
        await this.rpc({ action: 'pull', job: this.job, done: true, error: error.message }).catch(() => {});
        await this.rpc({ action: 'release' }).catch(() => {});
        this.notify('locked', error.message);
      }
    } finally { this.owned = false; this.clearAudio(); }
  }
  dispose() {
    this.clearAudio(); this.controller.abort(); clearTimeout(this.timer); this.wake?.();
    void this.call({ action: 'release', clientId: this.clientId }, AbortSignal.timeout(1000)).catch(() => {});
    void this.context?.close().catch(() => {}); this.listeners.clear();
  }
}
