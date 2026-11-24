import { cleanText } from './text.js';

/** Incremental Markdown filter. Ambiguous/incomplete constructs are held, never read early. */
export class LiveText {
  constructor(emit, { maxChars = 3000, flushDelayMs = 700 } = {}) {
    Object.assign(this, { emit, maxChars, flushDelayMs });
    this.pending = '';
    this.prose = '';
    this.lineStart = true;
    this.fence = null;
    this.skipLine = false;
    this.thinking = false;
    this.count = 0;
    this.closed = false;
    this.timer = null;
  }
  push(text) {
    if (this.closed) return;
    this.pending += text;
    this.parse(false);
    // Bound malformed markup / a single enormous code line without storing it all.
    if (this.pending.length > 8192) { this.pending = ''; this.skipLine = true; }
    // A maximum latency timer, not a debounce: continuous tokens cannot postpone it.
    if (!this.timer && this.prose.trim().length >= 8) {
      this.timer = setTimeout(() => { this.timer = null; this.flush(); }, this.flushDelayMs);
      this.timer.unref?.();
    }
  }
  append(text) {
    for (const char of text) {
      this.prose += char;
      if (/[。！？!?\n]/u.test(char) || (this.prose.length >= 80 && /[、,;；\s]/u.test(char)) || this.prose.length >= 180) this.flush();
      if (this.closed) return;
    }
  }
  parse(final) {
    while (this.pending && !this.closed) {
      const input = this.pending;
      if (this.thinking) {
        const end = input.toLowerCase().indexOf('</think>');
        if (end < 0) { this.pending = final ? '' : input.slice(-7); return; }
        this.pending = input.slice(end + 8); this.thinking = false; continue;
      }
      if (this.skipLine || this.fence) {
        const newline = input.indexOf('\n');
        if (newline < 0 && !final) return;
        const line = newline < 0 ? input : input.slice(0, newline);
        if (!this.skipLine && this.fence) {
          const closing = line.match(/^ {0,3}(`{3,}|~{3,})\s*$/);
          if (closing && closing[1][0] === this.fence[0] && closing[1].length >= this.fence.length) this.fence = null;
        }
        this.skipLine = false; this.lineStart = true;
        this.pending = newline < 0 ? '' : input.slice(newline + 1); continue;
      }
      if (this.lineStart) {
        if (!final && (/^ {0,3}$/.test(input) || /^ {0,3}[`~]+$/.test(input))) return;
        const fence = input.match(/^ {0,3}(`{3,}|~{3,})/);
        if (fence) { this.fence = fence[1]; this.skipLine = true; continue; }
        if (/^( {4}|\t)/.test(input)) { this.skipLine = true; continue; }
        this.lineStart = false;
      }
      if (input[0] === '\n') {
        this.append('\n'); this.lineStart = true; this.pending = input.slice(1); continue;
      }
      if (input === '<' && !final) return;
      if (/^<[a-zA-Z/!]/.test(input)) {
        const end = input.indexOf('>');
        if (end < 0) { if (final) this.pending = ''; return; }
        if (/^<think\b[^>]*>$/i.test(input.slice(0, end + 1))) this.thinking = true;
        this.pending = input.slice(end + 1); continue;
      }
      if (input[0] === '<') { this.append('＜'); this.pending = input.slice(1); continue; }
      if (input[0] === '`') {
        const run = input.match(/^`+/)[0];
        const end = input.indexOf(run, run.length);
        if (end < 0) { if (final) this.pending = ''; return; }
        this.append(input.slice(run.length, end)); this.pending = input.slice(end + run.length); continue;
      }
      if (input[0] === '[' || input.startsWith('![') || input === '!') {
        if (input === '!' && !final) return;
        if (input === '!') { this.append('!'); this.pending = ''; continue; }
        const image = input[0] === '!';
        const endLabel = input.indexOf(']');
        if (endLabel < 0 || (endLabel === input.length - 1 && !final)) { if (final) this.pending = ''; return; }
        let end = endLabel + 1;
        if (input[end] === '(') {
          let depth = 1;
          for (end++; end < input.length && depth; end++) {
            if (input[end] === '(') depth++;
            if (input[end] === ')') depth--;
          }
          if (depth) { if (final) this.pending = ''; return; }
        } else if (input[end] === ':') { this.skipLine = true; continue; }
        if (!image) this.append(input.slice(1, endLabel));
        this.pending = input.slice(end); continue;
      }
      if (!final && ['http://', 'https://'].some(s => s.startsWith(input))) return;
      if (/^https?:\/\//.test(input)) {
        const end = input.search(/\s/);
        if (end < 0) { if (final) this.pending = ''; return; }
        this.pending = input.slice(end); continue;
      }
      // Wait for a possible Markdown image opener split across deltas.
      if (input[0] === '!' && input.length === 1 && !final) return;
      const char = String.fromCodePoint(input.codePointAt(0));
      // A UTF-16 pair may be split by a producer; retain a trailing high surrogate.
      if (!final && input.length === 1 && /[\uD800-\uDBFF]/.test(input)) return;
      this.append(char); this.pending = input.slice(char.length);
    }
  }
  flush() {
    clearTimeout(this.timer); this.timer = null;
    if (this.closed) return;
    const text = cleanText(this.prose, 100000);
    this.prose = '';
    if (!text) return;
    const characters = Array.from(text), available = this.maxChars - this.count;
    const spoken = characters.slice(0, available).join('');
    this.count += Array.from(spoken).length;
    if (spoken) this.emit(spoken);
    if (characters.length > available) { this.emit('以下省略します。'); this.cancel(); }
  }
  finish() {
    if (this.closed) return;
    this.parse(true); this.flush(); this.cancel();
  }
  cancel() {
    clearTimeout(this.timer); this.timer = null;
    this.closed = true; this.pending = ''; this.prose = '';
  }
}
