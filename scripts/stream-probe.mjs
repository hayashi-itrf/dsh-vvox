import { PcmWaveReader } from '../lib/web-audio.js';

/** Headless integration probe: parse incrementally, without pretending to play sound. */
export async function probeStream(body, signal) {
  const reader = body.getReader(), parser = new PcmWaveReader();
  let receivedBeforeEof = false;
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      if (parser.push(value).length) receivedBeforeEof = true;
    }
    signal.throwIfAborted(); parser.end();
    if (!receivedBeforeEof) throw new Error('No incremental PCM received');
    console.log(`PCM stream verified: ${parser.samples} frames, ${parser.format.rate} Hz`);
  } finally { signal.removeEventListener('abort', abort); await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
