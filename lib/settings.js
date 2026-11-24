import { validateConfig, VoicevoxClient } from './speech.js';

const fields = ['speaker', 'speed', 'volume'];
export const voiceValues = config => Object.fromEntries(fields.map(key => [key, config[key]]));
const revision = config => JSON.stringify(voiceValues(config));

/** Shared application operations for the settings page and agent tool. */
export class VoicevoxSettings {
  constructor(config, client, queue, save, makeClient = value => new VoicevoxClient(value)) {
    Object.assign(this, { config, client, queue, save, makeClient });
    this.previewGroup = {};
  }
  state() { return { ...voiceValues(this.config), revision: revision(this.config) }; }
  async speakers(signal) {
    return (await this.client.speakers(signal)).map(s => ({
      id: s.speaker_uuid, name: s.name,
      styles: s.styles.filter(t => t.type === undefined || ['talk', 'streaming_talk'].includes(t.type))
        .map(t => ({ id: t.id, name: t.name })),
    })).filter(s => s.styles.length);
  }
  async checked(values, signal) {
    if (!values || typeof values !== 'object' || Array.isArray(values)
      || Object.keys(values).some(k => !fields.includes(k))
      || fields.some(k => typeof values[k] !== 'number')) throw new Error('声・速度・音量を指定してください。');
    const candidate = validateConfig({ ...this.config, ...values });
    if (!(await this.speakers(signal)).some(s => s.styles.some(t => t.id === candidate.speaker))) {
      throw new Error('選択した声質が見つかりません。キャラクター一覧を再読み込みしてください。');
    }
    return candidate;
  }
  async update(values, expected, signal) {
    if (typeof expected !== 'string') throw new Error('設定を再読み込みしてから保存してください。');
    const candidate = await this.checked(values, signal);
    signal?.throwIfAborted();
    await this.save(voiceValues(candidate), current => {
      if (revision(validateConfig(current)) !== expected) throw new Error('別の画面で設定が変更されました。再読み込みしてから保存してください。');
    });
    return { ...voiceValues(candidate), revision: revision(candidate) };
  }
  async preview(values, text, signal) {
    if (typeof text !== 'string' || !text.trim() || Array.from(text).length > 300) throw new Error('試聴文は1〜300文字で指定してください。');
    this.stop();
    const group = this.previewGroup = {};
    const controller = this.previewController = new AbortController();
    const combined = AbortSignal.any([controller.signal, ...(signal ? [signal] : [])]);
    const abort = () => this.queue.stop(undefined, group);
    combined.addEventListener('abort', abort, { once: true });
    try {
      const candidate = await this.checked(values, combined);
      combined.throwIfAborted();
      const client = this.makeClient(candidate);
      const result = await this.queue.enqueue(text.trim(), undefined, group, (text, signal) => client.speak(text, signal));
      if (!result.ok && !combined.aborted) throw new Error(result.error);
      return { stopped: !result.ok };
    } catch (error) {
      if (combined.aborted) return { stopped: true };
      throw error;
    } finally {
      combined.removeEventListener('abort', abort);
      if (this.previewController === controller) this.previewController = null;
    }
  }
  stop() {
    this.previewController?.abort();
    this.queue.stop(undefined, this.previewGroup);
    this.previewGroup = {};
    return { stopped: true };
  }
  async execute(input, signal) {
    if (!input || typeof input !== 'object') throw new Error('操作を指定してください。');
    switch (input.action) {
      case 'state': return this.state();
      case 'speakers': return this.speakers(signal);
      case 'save': return this.update(input.values, input.revision, signal);
      case 'preview': return this.preview(input.values, input.text, signal);
      case 'stop': return this.stop();
      default: throw new Error('不明な操作です。');
    }
  }
}

export function registerSettings(ctx, settings) {
  ctx.provide('voicevoxSettings', settings);
  ctx.effect(() => () => settings.stop());
  // Exact Connection routes inherit Host/Origin checks and owner-only admission.
  registerVoicevoxRpc(ctx, 'settings', (input, signal) => settings.execute(input, signal));
  ctx.inject(['tools'], sub => sub.tools.register({
    name: 'voicevox_settings',
    description: 'VOICEVOXの設定画面と共通の操作。stateで現在値とrevision、speakersで声の一覧を取得。saveは最新revisionとvaluesを指定。previewは保存せず試聴し、stopは試聴のみ停止。設定は全チャット共通。',
    parameters: { type: 'object', properties: {
      action: { type: 'string', enum: ['state', 'speakers', 'save', 'preview', 'stop'] },
      values: { type: 'object', properties: { speaker: { type: 'integer', minimum: 0 }, speed: { type: 'number', minimum: 0.5, maximum: 2 }, volume: { type: 'number', minimum: 0, maximum: 2 } }, required: fields, additionalProperties: false },
      revision: { type: 'string' }, text: { type: 'string', minLength: 1, maxLength: 300 },
    }, required: ['action'], additionalProperties: false },
    output: { schema: {}, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    execute: (input, exec) => settings.execute(input, exec.signal),
  }));
}

export function registerVoicevoxRpc(ctx, name, execute) {
  ctx.inject(['connection'], sub => sub.connection.fetch.register({
    path: `/api/local-voicevox/${name}`, methods: ['POST'], requestBody: 'buffered',
    fetch: async request => {
      let body;
      try { body = await request.json(); } catch { return new Response('Invalid JSON', { status: 400 }); }
      if (body?.type !== 'client-request' || typeof body.rpcId !== 'string' || body.method !== `local-voicevox/${name}`) return new Response('Invalid request', { status: 400 });
      let result;
      try { result = { ok: true, value: await execute(body.payload, request.signal) }; }
      catch (error) { result = { ok: false, error: { code: `voicevox/${name}`, message: String(error.message ?? error), details: {} } }; }
      return Response.json({ type: 'server-response', rpcId: body.rpcId, result });
    },
  }));
}
