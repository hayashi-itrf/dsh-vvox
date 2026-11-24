import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { splitText } from './text.js';

export const defaults = Object.freeze({ enabled: true, endpoint: 'http://127.0.0.1:50021',
  speaker: 3, speed: 1.1, volume: 1, autoStart: true, maxChars: 3000,
  segmentLength: 0.3, flushDelayMs: 700 });

export function validateConfig(input = {}) {
  const config = { ...defaults, ...input };
  const url = new URL(config.endpoint);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
      || url.search || url.hash || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
    throw new Error('endpoint は認証情報を含まない、このMacのループバックURLを指定してください。');
  }
  for (const [key, min, max, integer] of [
    ['speaker', 0, 2147483647, true], ['speed', 0.5, 2, false],
    ['volume', 0, 2, false], ['maxChars', 100, 10000, true],
    ['segmentLength', 0.1, 2, false], ['flushDelayMs', 100, 5000, true],
  ]) {
    if (!Number.isFinite(config[key]) || config[key] < min || config[key] > max
        || (integer && !Number.isInteger(config[key]))) throw new Error(`${key} は ${min}〜${max} で指定してください。`);
  }
  for (const key of ['enabled', 'autoStart']) if (typeof config[key] !== 'boolean') throw new Error(`${key} は真偽値で指定してください。`);
  config.endpoint = url.href.replace(/\/$/, '');
  return config;
}

function run(command, args, signal, timeout = 120000) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'ignore', signal, timeout, killSignal: 'SIGKILL' });
    child.once('error', reject);
    child.once('close', (code, reason) => code === 0 ? resolve() : reject(new Error(`${command}: ${reason ?? code}`)));
  });
}

class VoicevoxHttpError extends Error {
  constructor(path, status) {
    super(`VOICEVOX ${path.split('?')[0]}: HTTP ${status}`);
    this.status = status;
  }
}

export class VoicevoxClient {
  constructor(config, dependencies = {}) {
    this.config = config;
    this.fetch = dependencies.fetch ?? globalThis.fetch;
    this.run = dependencies.run ?? run;
    this.available = dependencies.available ?? (() => {});
    this.playStream = dependencies.playStream ?? (() => { throw new Error('DSHの音声再生画面に接続してください。'); });
    this.engineVersion = null;
    this.synthesisMode = null;
  }

  async request(path, options = {}, signal, timeout = 30000) {
    const response = await this.fetch(this.config.endpoint + path, {
      ...options, redirect: 'error',
      signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(timeout)]),
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      throw new VoicevoxHttpError(path, response.status);
    }
    return response;
  }

  async checkVersion(signal, timeout) {
    const version = await (await this.request('/version', {}, signal, timeout)).json();
    if (this.engineVersion !== version) {
      this.engineVersion = version;
      this.synthesisMode = null;
    }
  }

  async ready(signal) {
    try { await this.checkVersion(signal, 1500); return; }
    catch (error) {
      if (signal?.aborted) throw error;
      this.synthesisMode = null;
      const url = new URL(this.config.endpoint);
      if (!this.config.autoStart || url.port !== '50021' || url.pathname !== '/') {
        throw new Error('VOICEVOXに接続できません。VOICEVOXを起動し、接続先を確認してください。');
      }
    }
    await this.run('/usr/bin/open', ['-a', 'VOICEVOX'], signal, 10000);
    for (let i = 0; i < 30; i++) {
      await delay(500, undefined, { signal });
      try { await this.checkVersion(signal, 1000); return; }
      catch (error) { if (signal?.aborted) throw error; }
    }
    throw new Error('VOICEVOXの起動を確認できません。アプリの画面を確認してください。');
  }

  async speakers(signal) {
    await this.ready(signal);
    return (await this.request('/speakers', {}, signal)).json();
  }

  async synthesize(text, signal) {
    const speaker = String(this.config.speaker);
    const params = new URLSearchParams({ text, speaker });
    const query = await (await this.request(`/audio_query?${params}`, { method: 'POST' }, signal)).json();
    query.speedScale = this.config.speed;
    query.volumeScale = this.config.volume;
    const options = {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(query),
    };
    if (this.synthesisMode !== 'standard') {
      const streamParams = new URLSearchParams({ speaker, segment_length: String(this.config.segmentLength) });
      try {
        const response = await this.request(`/streaming_synthesis?${streamParams}`, options, signal, 120000);
        this.synthesisMode = 'streaming';
        return response;
      } catch (error) {
        // Only switch when the endpoint is unavailable. Keep real synthesis errors visible.
        if (!(error instanceof VoicevoxHttpError) || ![404, 405, 501].includes(error.status)) throw error;
        signal?.throwIfAborted();
      }
    }
    const response = await this.request(`/synthesis?speaker=${speaker}`, options, signal, 120000);
    this.synthesisMode = 'standard';
    return response;
  }

  async speak(text, signal) {
    this.available();
    await this.ready(signal);
    for (const chunk of splitText(text)) {
      signal.throwIfAborted();
      const response = await this.synthesize(chunk, signal);
      try { await this.playStream(response.body, signal); }
      finally { if (response.body && !response.body.locked) await response.body.cancel().catch(() => {}); }
    }
  }
}

/** One FIFO across sessions; listeners never await audio or block model work. */
export class SpeechQueue {
  constructor(speak, onError = () => {}) {
    this.speak = speak;
    this.onError = onError;
    this.pending = [];
    this.current = null;
    this.running = null;
    this.closed = false;
    this.lastError = null;
  }
  enqueue(text, sessionId, group, speak = this.speak) {
    if (this.closed) return Promise.resolve({ ok: false, error: '停止しています。' });
    if (this.pending.length >= 20) {
      this.lastError = '読み上げ待ちが20区間に達したため、新しい音声区間をスキップしました。';
      this.onError(this.lastError);
      return Promise.resolve({ ok: false, error: this.lastError });
    }
    const result = new Promise(resolve => this.pending.push({ text, sessionId, group, speak, resolve }));
    if (!this.running) this.running = this.drain();
    return result;
  }
  async drain() {
    // Yield before starting so enqueue can assign running before drain finishes.
    await Promise.resolve();
    try {
      while (this.pending.length && !this.closed) {
        const item = this.pending.shift();
        const controller = new AbortController();
        this.current = { ...item, controller };
        try {
          await item.speak(item.text, controller.signal);
          controller.signal.throwIfAborted();
          this.lastError = null;
          item.resolve({ ok: true });
        } catch (error) {
          const message = controller.signal.aborted ? '読み上げを停止しました。' : String(error.message ?? error);
          if (!controller.signal.aborted) { this.lastError = message; this.onError(message); }
          item.resolve({ ok: false, error: message });
        } finally { this.current = null; }
      }
    } finally { this.running = null; }
  }
  stop(sessionId, group) {
    const matches = item => (sessionId === undefined || item.sessionId === sessionId)
      && (group === undefined || item.group === group);
    if (this.current && matches(this.current)) this.current.controller.abort();
    const remaining = [];
    for (const item of this.pending) {
      if (matches(item)) item.resolve({ ok: false, error: '読み上げを停止しました。' });
      else remaining.push(item);
    }
    this.pending = remaining;
  }
  async dispose() { this.closed = true; this.stop(); await this.running; }
}
