import z from '@deepseek-ai/schemastery';
import { LiveSpeech } from './lib/live-speech.js';
import { VoicevoxSettings, registerSettings, registerVoicevoxRpc } from './lib/settings.js';
import { BrowserAudioBridge } from './lib/player.js';
import { defaults, validateConfig, VoicevoxClient, SpeechQueue } from './lib/speech.js';

export const name = 'voicevox';
export const inject = ['sessions', 'commands'];
export const Config = z.object({
  enabled: z.boolean().default(defaults.enabled).description('AIの新しい返答を読み上げる'),
  endpoint: z.string().default(defaults.endpoint).description('このMacのVOICEVOX Engine URL'),
  speaker: z.number().min(0).step(1).default(defaults.speaker).description('話者スタイルID（3: ずんだもん・ノーマル）'),
  speed: z.number().min(0.5).max(2).default(defaults.speed).description('読み上げ速度'),
  volume: z.number().min(0).max(2).default(defaults.volume).description('音量'),
  autoStart: z.boolean().default(defaults.autoStart).description('VOICEVOX未起動時に自動起動する'),
  maxChars: z.number().min(100).max(10000).step(1).default(defaults.maxChars).description('1メッセージの最大文字数'),
  segmentLength: z.number().min(0.1).max(2).default(defaults.segmentLength).description('VOICEVOXが一度に合成する秒数'),
  flushDelayMs: z.number().min(100).max(5000).step(1).default(defaults.flushDelayMs).description('句点がない本文を読み始めるまでの最大待ち時間（ミリ秒）'),
  ffplayPath: z.string().default('').description('旧バージョンとの互換用。現在は使用しません。'),
});

export function apply(ctx, input = {}) {
  if (process.platform !== 'darwin') throw new Error('このプラグインはmacOS用です。');
  const config = validateConfig(input);
  const audio = new BrowserAudioBridge();
  const makeClient = value => new VoicevoxClient(value, {
    available: () => audio.available(), playStream: (body, signal) => audio.play(body, signal),
  });
  const client = makeClient(config);
  registerVoicevoxRpc(ctx, 'playback', input => audio.execute(input));
  ctx.effect(() => () => audio.dispose());
  const queue = new SpeechQueue((text, signal) => client.speak(text, signal),
    error => ctx.logger.warn(`[VOICEVOX] ${error}`));
  const live = new LiveSpeech(queue, config);
  ctx.effect(() => () => live.dispose());
  ctx.on('agent/assistant-stream', payload => live.frame(payload));
  ctx.on('session/event', (session, event) => live.event(session, event));
  ctx.on('session/disposed', session => live.disposeSession(session));
  ctx.on('agent/disposed', ({ agent }) => live.disposeSession(agent.session));

  async function save(patch, check = () => {}) {
    const editor = ctx.get('configEditor');
    const entry = ctx.fiber?.entry;
    if (!editor || entry === undefined) throw new Error('このプロファイルでは設定を保存できません。');
    validateConfig({ ...config, ...patch });
    await editor.edit(entry, current => { check({ ...config, ...current }); return { ...current, ...patch }; });
  }

  registerSettings(ctx, new VoicevoxSettings(config, client, queue, save, makeClient));

  ctx.commands.register({
    name: 'voicevox',
    description: 'VOICEVOX読み上げの試聴・停止・設定（全チャット共通）',
    input: { hint: 'status | test | stop | on | off | speakers | speaker <ID> | speed <0.5〜2>' },
    handler: async invocation => {
      const [action = 'status', value, ...rest] = invocation.rawInput.trim().split(/\s+/).filter(Boolean);
      const ok = text => ({ kind: 'success', text });
      try {
        if (rest.length || (value !== undefined && !['speaker', 'speed'].includes(action))) throw new Error('引数を確認してください。/voicevox で使い方を表示します。');
        switch (action) {
          case 'status': {
            const mode = {
              streaming: 'ストリーミング合成',
              standard: '通常合成（文ごと）',
            }[client.synthesisMode] ?? '自動選択（次回の読み上げで判定）';
            return ok(`VOICEVOX: ${config.enabled ? 'ON' : 'OFF'}（全チャット共通）\n音声合成: ${mode}\n話者ID: ${config.speaker} / 速度: ${config.speed}\n接続先: ${config.endpoint}\n再生中: ${queue.current ? 'はい' : 'いいえ'} / 待ち: ${queue.pending.length}区間\n直近のエラー: ${queue.lastError ?? 'なし'}\n/voicevox test: 試聴と接続確認（待ち行列の順）\n/voicevox stop: 現在の返答の読み上げを停止\n/voicevox on・off: 自動読み上げ切替\n/voicevox speakers: 話者一覧\n/voicevox speaker <ID>・speed <0.5〜2>: 設定変更`);
          }
          case 'stop': live.stop(); return ok('現在の再生と待機分を停止しました。生成中の返答の続きも読み上げません。次の返答から再開します。');
          case 'on': case 'off':
            await save({ enabled: action === 'on' });
            if (action === 'off') live.stop();
            return ok(`自動読み上げを${action === 'on' ? '有効' : '無効'}にして保存しました（全チャット共通）。`);
          case 'test': {
            const dispose = () => queue.stop(invocation.agent.session.id);
            invocation.signal?.throwIfAborted();
            invocation.signal?.addEventListener('abort', dispose, { once: true });
            try {
              const result = await queue.enqueue('VOICEVOXの読み上げテストです。準備ができました。', invocation.agent.session.id);
              if (!result.ok) throw new Error(result.error);
              return ok('VOICEVOXでテスト音声を再生しました。');
            } finally { invocation.signal?.removeEventListener('abort', dispose); }
          }
          case 'speakers': {
            const speakers = await client.speakers(invocation.signal);
            return ok(speakers.flatMap(s => s.styles.filter(t => t.type === undefined || ['talk', 'streaming_talk'].includes(t.type)).map(t => `${t.id}: ${s.name}（${t.name}）`)).join('\n'));
          }
          case 'speaker': {
            if (!/^\d+$/.test(value ?? '')) throw new Error('例: /voicevox speaker 3');
            const speaker = Number(value);
            const speakers = await client.speakers(invocation.signal);
            const owner = speakers.find(s => s.styles.some(t => t.id === speaker && (t.type === undefined || ['talk', 'streaming_talk'].includes(t.type))));
            if (!owner) throw new Error('トーク用の話者IDが見つかりません。/voicevox speakers で確認してください。');
            await save({ speaker }); return ok(`話者を${owner.name}（ID: ${speaker}）にして保存しました。`);
          }
          case 'speed': {
            if (value === undefined) throw new Error('例: /voicevox speed 1.1');
            const speed = Number(value); await save({ speed }); return ok(`読み上げ速度を${speed}にして保存しました。`);
          }
          default: throw new Error('不明な操作です。/voicevox で使い方を表示します。');
        }
      } catch (error) { return { kind: 'error', text: String(error.message ?? error) }; }
    },
  });
}
