import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

/** One leased renderer, bounded transport, and explicit playback completion. */
export class BrowserAudioBridge {
  constructor({ leaseMs = 6000 } = {}) {
    this.leaseMs = leaseMs;
    this.owner = null;
    this.job = null;
    this.closed = false;
  }
  alive() { return this.owner && Date.now() - this.owner.seen < this.leaseMs; }
  available() {
    if (!this.alive()) throw new Error('DSHの「声の設定」で「この画面で読み上げを有効にする」を押してください。');
  }
  finish(error) {
    const job = this.job;
    if (!job) return;
    this.job = null;
    if (error) job.reject(error); else job.resolve();
    job.controller.abort();
  }
  async execute(input) {
    if (this.closed) throw new Error('音声再生は停止しています。');
    if (!input || typeof input.clientId !== 'string' || !/^[\w-]{8,80}$/.test(input.clientId)) throw new Error('Invalid audio client');
    const mine = this.owner?.id === input.clientId;
    if (input.action === 'claim') {
      if (!this.alive() || mine || input.takeover === true) {
        if (!mine || !this.alive()) this.finish(new Error('音声の再生先が切り替わりました。'));
        this.owner = { id: input.clientId, seen: Date.now() };
        return { owner: true };
      }
      return { owner: false };
    }
    if (!mine || !this.alive()) return { owner: false };
    if (input.action === 'release') {
      this.finish(new Error('DSHの音声再生画面との接続が切れました。'));
      this.owner = null;
      return { owner: false };
    }
    if (input.action !== 'pull') throw new Error('Invalid audio action');
    this.owner.seen = Date.now();
    if (input.done && this.job?.id === input.job) {
      if (input.error) this.finish(new Error(String(input.error).slice(0, 300)));
      else if (this.job.eof && !this.job.chunks.length) this.finish();
    }
    const job = this.job;
    const chunk = input.accept !== false ? job?.chunks.shift() : null;
    return { owner: true, job: job?.id ?? null, chunk: chunk?.toString('base64') ?? null,
      eof: !!job?.eof && !job.chunks.length };
  }
  async play(body, signal) {
    this.available();
    if (!body) throw new Error('VOICEVOXの音声ストリームが空です。');
    signal.throwIfAborted();
    if (this.job) throw new Error('音声再生が重複しました。');
    const controller = new AbortController();
    const combined = AbortSignal.any([signal, controller.signal, AbortSignal.timeout(120000)]);
    let resolve, reject;
    const completed = new Promise((yes, no) => { resolve = yes; reject = no; });
    completed.catch(() => {});
    const job = this.job = { id: randomUUID(), chunks: [], eof: false, controller, resolve, reject };
    const reader = body.getReader();
    const cancel = () => { void reader.cancel().catch(() => {}); };
    combined.addEventListener('abort', cancel, { once: true });
    const watchdog = setInterval(() => {
      if (!this.alive()) this.finish(new Error('DSHの音声再生画面との接続が切れました。'));
    }, Math.min(500, this.leaseMs));
    try {
      while (true) {
        combined.throwIfAborted();
        const { done, value } = await reader.read();
        combined.throwIfAborted();
        if (done) break;
        for (let offset = 0; offset < value.length; offset += 8192) {
          while (job.chunks.length >= 2) await delay(15, undefined, { signal: combined });
          combined.throwIfAborted();
          job.chunks.push(Buffer.from(value.subarray(offset, offset + 8192)));
        }
      }
      job.eof = true;
      await Promise.race([completed, delay(120000, undefined, { signal: combined })]);
      signal.throwIfAborted();
    } catch (error) {
      if (this.job === job) this.finish(error);
      await completed;
      throw error;
    } finally {
      clearInterval(watchdog);
      combined.removeEventListener('abort', cancel);
      await reader.cancel().catch(() => {});
      reader.releaseLock();
      if (this.job === job) this.finish(new Error('音声の再生を終了しました。'));
    }
  }
  dispose() { this.closed = true; this.finish(new Error('プラグインを終了しました。')); this.owner = null; }
}
