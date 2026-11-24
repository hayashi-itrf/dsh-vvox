/** Incremental RIFF/PCM16 parser. HTTP chunks need not align with headers or samples. */
export class PcmWaveReader {
  constructor() { this.bytes = new Uint8Array(); this.riff = false; this.format = null; this.data = false; this.samples = 0; }
  push(chunk) {
    const bytes = new Uint8Array(this.bytes.length + chunk.length);
    bytes.set(this.bytes); bytes.set(chunk, this.bytes.length); this.bytes = bytes;
    const tag = offset => String.fromCharCode(...this.bytes.subarray(offset, offset + 4));
    if (!this.riff) {
      if (this.bytes.length < 12) return [];
      if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('Invalid WAV stream');
      this.bytes = this.bytes.slice(12); this.riff = true;
    }
    while (!this.data) {
      if (this.bytes.length < 8) return [];
      const view = new DataView(this.bytes.buffer, this.bytes.byteOffset, this.bytes.byteLength);
      const kind = tag(0), size = view.getUint32(4, true);
      if (kind === 'data') {
        if (!this.format) throw new Error('WAV format is missing');
        this.data = true; this.bytes = this.bytes.slice(8); break;
      }
      if (size > 65536) throw new Error('WAV header is too large');
      const length = 8 + size + (size % 2);
      if (this.bytes.length < length) return [];
      if (kind === 'fmt ') {
        if (size < 16 || view.getUint16(8, true) !== 1 || view.getUint16(22, true) !== 16) throw new Error('Expected PCM16 WAV');
        const channels = view.getUint16(10, true), rate = view.getUint32(12, true);
        if (![1, 2].includes(channels) || rate < 8000 || rate > 96000 || view.getUint16(20, true) !== channels * 2) throw new Error('Unsupported WAV format');
        this.format = { channels, rate };
      }
      this.bytes = this.bytes.slice(length);
    }
    const { channels, rate } = this.format;
    const frames = Math.floor(this.bytes.length / (2 * channels));
    if (!frames) return [];
    const view = new DataView(this.bytes.buffer, this.bytes.byteOffset, frames * channels * 2);
    const pcm = Array.from({ length: channels }, () => new Float32Array(frames));
    for (let i = 0; i < frames; i++) for (let c = 0; c < channels; c++) pcm[c][i] = view.getInt16((i * channels + c) * 2, true) / 32768;
    this.bytes = this.bytes.slice(frames * channels * 2); this.samples += frames;
    return [{ pcm, rate, frames }];
  }
  end() { if (!this.data || !this.samples || this.bytes.length) throw new Error('WAV stream ended mid-header or sample'); }
}

/** Queue short buffers on the audio clock; never decodeAudioData on partial WAV files. */
export class WebAudioStream {
  constructor(context) { this.context = context; this.reader = new PcmWaveReader(); this.sources = new Set(); this.until = 0; this.ended = false; }
  get bufferedSeconds() { return Math.max(0, this.until - this.context.currentTime); }
  get finished() { return this.ended && this.bufferedSeconds === 0; }
  push(bytes) {
    for (const { pcm, rate, frames } of this.reader.push(bytes)) {
      const buffer = this.context.createBuffer(pcm.length, frames, rate);
      pcm.forEach((samples, channel) => buffer.copyToChannel(samples, channel));
      const source = this.context.createBufferSource(); source.buffer = buffer;
      source.connect(this.context.destination); this.sources.add(source);
      source.onended = () => { source.disconnect(); this.sources.delete(source); };
      const start = Math.max(this.until, this.context.currentTime + (this.until ? 0 : 0.12));
      source.start(start); this.until = start + frames / rate;
    }
  }
  end() { if (!this.ended) this.reader.end(); this.ended = true; }
  stop() { for (const source of this.sources) { source.onended = null; try { source.stop(); } catch {} source.disconnect(); } this.sources.clear(); this.until = 0; }
}
