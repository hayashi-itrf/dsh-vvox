import { VoicevoxClient, validateConfig } from '../lib/speech.js';
import { probeStream } from './stream-probe.mjs';
const client = new VoicevoxClient(validateConfig(), { playStream: probeStream });
await client.speak('DSHとVOICEVOXの接続テストです。読み上げの準備ができました。', AbortSignal.timeout(60000));
console.log('PASS: VOICEVOX streaming synthesis → incremental PCM parser (headless; no speaker playback)');
