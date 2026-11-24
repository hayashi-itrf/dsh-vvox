window.__ModuleLoader__.load({
  id: 'dsh-vvox',
  factory(require) {
    /* AUDIO_RUNTIME */
    const React = require('react');
    const h = React.createElement;
    const en = {
      enableAudio: 'Enable speech in this window', ready: 'Audio ready in this window', locked: 'Click to enable audio playback', elsewhere: 'Audio is active in another window', playingAudio: 'Playing audio…', audioHint: 'Keep this DSH window open. No FFmpeg installation is needed.',
      title: 'Voice settings', intro: 'Choose a voice, preview it, then save. Saved settings apply to every chat.',
      character: 'Character', style: 'Voice style', speed: 'Speech speed', volume: 'Volume',
      voiceCredit: 'Voice credit',
      previewText: 'Preview text', preview: 'Preview this voice', playing: 'Waiting / playing…', stop: 'Stop preview',
      save: 'Save settings', saving: 'Saving…', saved: 'Saved. These settings apply to new speech.',
      reload: 'Reload settings and voices', loading: 'Loading settings and voices…', retry: 'Retry',
      unsaved: 'Unsaved changes', current: 'Saved settings', complete: 'Preview finished.', stopped: 'Preview stopped.',
      hint: 'Preview uses the values shown here without saving. It plays in this DSH window, after any queued speech.',
      saveHint: 'Saving stops current speech. New replies use the saved voice.',
      unknown: 'Current voice is unavailable', empty: 'No speaking voices found. Check VOICEVOX and reload.',
      sample: 'こんにちは。VOICEVOXの読み上げテストです。この声でお話しします。',
      range: 'Speed: 0.5–2×. Volume: 0–200%.', mute: 'Volume is 0% (muted).', invalid: 'Check the voice, speed, volume and preview text.',
    };
    const ja = {
      enableAudio: 'この画面で読み上げを有効にする', ready: 'この画面で音声を再生できます', locked: 'クリックして音声再生を有効にしてください', elsewhere: '別の画面で音声再生が有効です', playingAudio: '音声を再生中…', audioHint: 'このDSHの画面を開いたまま使用してください。FFmpegのインストールは不要です。',
      title: '声の設定', intro: 'キャラクターと声質を選び、試聴してから保存できます。保存した設定は全チャットに適用されます。',
      character: 'キャラクター', style: '声質', speed: '読み上げ速度', volume: '音量',
      voiceCredit: '音声クレジット',
      previewText: '試聴する文章', preview: 'この設定で試聴', playing: '再生待ち・試聴中…', stop: '試聴を停止',
      save: '設定を保存', saving: '保存中…', saved: '保存しました。新しい読み上げに反映されます。',
      reload: '設定とキャラクターを再読み込み', loading: '設定とキャラクターを読み込み中…', retry: '再試行',
      unsaved: '未保存の変更があります', current: '保存済みの設定', complete: '試聴が完了しました。', stopped: '試聴を停止しました。',
      hint: '試聴は保存前の設定で行えます。このDSHの画面から、読み上げ待ちの音声に続けて再生します。',
      saveHint: '保存すると現在の読み上げは停止します。次の返答から新しい設定を使います。',
      unknown: '現在の声が見つかりません', empty: '読み上げ用の声が見つかりません。VOICEVOXを確認して再読み込みしてください。',
      sample: 'こんにちは。VOICEVOXの読み上げテストです。この声でお話しします。',
      range: '速度は0.5〜2倍、音量は0〜200%で調整できます。', mute: '音量が0%のため、音は出ません。', invalid: '声・速度・音量・試聴文の入力を確認してください。',
    };
    const css = `
.vvx-settings{color:var(--dsw-alias-label-primary);font-size:14px;line-height:1.6;max-width:760px;padding:0 0 20px}
.vvx-settings h3{font-size:16px;font-weight:500;margin:0 0 8px}
.vvx-settings p{margin:0 0 16px;color:var(--dsw-alias-label-secondary);font-size:13px}
.vvx-settings .vvx-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px;margin:24px 0}
.vvx-settings label{display:block;font-weight:500;margin-bottom:8px}
.vvx-settings select,.vvx-settings input[type=number],.vvx-settings textarea{box-sizing:border-box;width:100%;font:inherit;border:1px solid var(--dsw-alias-border-l3);border-radius:8px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);padding:8px 10px;min-height:40px}
.vvx-settings textarea{resize:vertical;min-height:80px}
.vvx-settings .vvx-adjust{display:flex;align-items:center;gap:12px}
.vvx-settings input[type=range]{flex:1;min-width:60px;accent-color:var(--dsw-alias-state-business-primary)}
.vvx-settings .vvx-adjust input[type=number]{width:90px}
.vvx-settings .vvx-actions{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin:16px 0}
.vvx-settings button{font:inherit;border:1px solid var(--dsw-alias-border-l3);border-radius:8px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);padding:8px 14px;min-height:40px;cursor:pointer}
.vvx-settings button.vvx-primary{border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-state-business-primary);font-weight:500}
.vvx-settings button:hover:enabled{background:var(--dsw-alias-interactive-bg-hover)}
.vvx-settings :is(button,select,input,textarea):focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}
.vvx-settings :disabled{opacity:.55;cursor:default}
.vvx-settings .vvx-error{color:var(--dsw-alias-state-error-primary);white-space:pre-wrap}
.vvx-settings .vvx-status{min-height:24px;font-size:13px;color:var(--dsw-alias-label-secondary)}
.vvx-settings .vvx-footer{border-top:1px solid var(--dsw-alias-border-l3);margin-top:24px;padding-top:16px}
@media(max-width:600px){.vvx-settings .vvx-grid{grid-template-columns:1fr}.vvx-settings select,.vvx-settings input,.vvx-settings textarea{font-size:16px}}
`;
    return {
      inject: ['slots', 'locale', 'connection'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register('local.voicevox', { en, zh: en, ja }));
        const call = async (input, signal) => {
          const result = await ctx.connection.rpc.call('/api', 'local-voicevox/settings', input, signal);
          if (!result.ok) throw new Error(result.error.message);
          return result.value;
        };
        const player = new BrowserPlayer(async (input, signal) => {
          const result = await ctx.connection.rpc.call('/api', 'local-voicevox/playback', input, signal);
          if (!result.ok) throw new Error(result.error.message);
          return result.value;
        });
        ctx.effect(() => {
          const unlock = () => { if (player.state === 'locked') void player.activate().catch(() => {}); };
          document.addEventListener('pointerdown', unlock);
          document.addEventListener('keydown', unlock);
          void player.activate().catch(() => {});
          return () => { document.removeEventListener('pointerdown', unlock); document.removeEventListener('keydown', unlock); player.dispose(); };
        });
        function Settings({ t }) {
          const [, refreshAudio] = React.useReducer(n => n + 1, 0);
          React.useEffect(() => player.subscribe(refreshAudio), []);
          const [saved, setSaved] = React.useState(null);
          const [values, setValues] = React.useState(null);
          const [speakers, setSpeakers] = React.useState([]);
          const [text, setText] = React.useState(() => t('sample'));
          const [loading, setLoading] = React.useState(true);
          const [busy, setBusy] = React.useState('');
          const [error, setError] = React.useState('');
          const [notice, setNotice] = React.useState('');
          const life = React.useRef(null), preview = React.useRef(null);
          const ids = React.useId();
          const load = async signal => {
            setLoading(true); setError(''); setNotice('');
            try {
              const [state, list] = await Promise.all([call({ action: 'state' }, signal), call({ action: 'speakers' }, signal)]);
              if (signal.aborted) return;
              setSaved(state); setValues({ speaker: state.speaker, speed: state.speed, volume: state.volume * 100 }); setSpeakers(list);
              if (!list.length) setError(t('empty'));
            } catch (e) { if (!signal.aborted) setError(e.message); }
            finally { if (!signal.aborted) setLoading(false); }
          };
          React.useEffect(() => {
            const controller = new AbortController(); life.current = controller;
            void load(controller.signal);
            return () => { controller.abort(); preview.current?.abort(); };
          }, []);
          const patch = change => { setValues(v => ({ ...v, ...change })); setNotice(''); setError(''); };
          const owner = speakers.find(s => s.styles.some(style => style.id === values?.speaker));
          const numeric = values && { speaker: values.speaker, speed: Number(values.speed), volume: Number(values.volume) / 100 };
          const dirty = saved && numeric && ['speaker', 'speed', 'volume'].some(key => saved[key] !== numeric[key]);
          const valid = owner && values.speed !== '' && values.volume !== ''
            && Number.isFinite(numeric.speed) && numeric.speed >= 0.5 && numeric.speed <= 2
            && Number.isFinite(numeric.volume) && numeric.volume >= 0 && numeric.volume <= 2;
          const audition = async () => {
            if (!valid || !text.trim() || Array.from(text).length > 300) { setError(t('invalid')); return; }
            const controller = new AbortController(); preview.current = controller;
            setBusy('preview'); setError(''); setNotice('');
            try {
              if (!await player.activate(true)) throw new Error(t('locked'));
              const result = await call({ action: 'preview', values: numeric, text }, controller.signal);
              if (!life.current.signal.aborted) setNotice(result.stopped ? 'stopped' : 'complete');
            } catch (e) { if (!life.current.signal.aborted && !controller.signal.aborted) setError(e.message); }
            finally { if (!life.current.signal.aborted) { setBusy(''); preview.current = null; } }
          };
          const stop = async () => {
            try { await call({ action: 'stop' }, life.current.signal); preview.current?.abort(); setNotice('stopped'); }
            catch (e) { if (!life.current.signal.aborted) setError(e.message); }
          };
          const save = async () => {
            setBusy('save'); setError(''); setNotice('');
            try {
              const state = await call({ action: 'save', values: numeric, revision: saved.revision }, life.current.signal);
              if (!life.current.signal.aborted) { setSaved(state); setNotice('saved'); }
            } catch (e) { if (!life.current.signal.aborted) setError(e.message); }
            finally { if (!life.current.signal.aborted) setBusy(''); }
          };
          const control = (key, min, max, step, unit) => h('div', null,
            h('label', { htmlFor: ids + key }, t(key)),
            h('div', { className: 'vvx-adjust' },
              h('input', { type: 'range', min, max, step, value: values[key] === '' ? min : Number(values[key]),
                'aria-label': t(key), disabled: !!busy || loading,
                onChange: e => patch({ [key]: e.target.value }) }),
              h('input', { id: ids + key, type: 'number', min, max, step, value: values[key],
                disabled: !!busy || loading, onChange: e => patch({ [key]: e.target.value === '' ? '' : e.target.value }) }),
              h('span', { 'aria-hidden': true }, unit)));
          return h('section', { className: 'vvx-settings', 'aria-label': t('title'), 'aria-busy': loading },
            h('style', null, css), h('h3', null, t('title')), h('p', null, t('intro')),
            h('div', { className: 'vvx-actions' },
              h('span', { role: 'status' }, t(player.state)),
              ['locked', 'elsewhere'].includes(player.state) ? h('button', { type: 'button',
                onClick: () => { void player.activate(true).catch(() => {}); } }, t('enableAudio')) : null),
            h('p', null, t('audioHint')),
            player.error ? h('p', { role: 'alert', className: 'vvx-error' }, player.error) : null,
            loading ? h('p', { role: 'status' }, t('loading')) : null,
            values ? h(React.Fragment, null,
              h('div', { className: 'vvx-grid' },
                h('div', null, h('label', { htmlFor: ids + 'character' }, t('character')),
                  h('select', { id: ids + 'character', value: owner?.id ?? '', disabled: !!busy || loading,
                    onChange: e => patch({ speaker: speakers.find(s => s.id === e.target.value).styles[0].id }) },
                    !owner ? h('option', { value: '', disabled: true }, t('unknown')) : null,
                    speakers.map(s => h('option', { key: s.id, value: s.id }, s.name)))),
                h('div', null, h('label', { htmlFor: ids + 'style' }, t('style')),
                  h('select', { id: ids + 'style', value: values.speaker, disabled: !owner || !!busy || loading,
                    onChange: e => patch({ speaker: Number(e.target.value) }) },
                    !owner ? h('option', { value: values.speaker }, String(values.speaker)) : null,
                    owner?.styles.map(s => h('option', { key: s.id, value: s.id }, s.name)))),
                control('speed', 0.5, 2, 0.05, '×'), control('volume', 0, 200, 5, '%')),
              owner ? h('p', null, t('voiceCredit'), ' ', h('code', null, 'VOICEVOX:' + owner.name)) : null,
              h('p', null, t('range')),
              numeric.volume === 0 ? h('p', { role: 'status' }, t('mute')) : null,
              h('label', { htmlFor: ids + 'text' }, t('previewText')),
              h('textarea', { id: ids + 'text', value: text, maxLength: 300, disabled: !!busy || loading, onChange: e => setText(e.target.value) }),
              h('div', { className: 'vvx-actions' },
                h('button', { type: 'button', disabled: !valid || !!busy || loading || !text.trim(), onClick: audition }, t(busy === 'preview' ? 'playing' : 'preview')),
                busy === 'preview' ? h('button', { type: 'button', onClick: stop }, t('stop')) : null),
              h('p', null, t('hint')),
              h('div', { className: 'vvx-footer' },
                h('div', { className: 'vvx-actions' },
                  h('button', { type: 'button', className: 'vvx-primary', disabled: !valid || !dirty || !!busy || loading, onClick: save }, t(busy === 'save' ? 'saving' : 'save')),
                  h('span', { className: 'vvx-status' }, t(dirty ? 'unsaved' : 'current'))),
                h('p', null, t('saveHint')))) : null,
            error ? h('p', { role: 'alert', className: 'vvx-error' }, error) : null,
            h('div', { className: 'vvx-status', role: 'status' }, notice ? t(notice) : ''),
            h('div', { className: 'vvx-actions' }, h('button', { type: 'button', disabled: !!busy || loading,
              onClick: () => load(life.current.signal) }, t(values ? 'reload' : 'retry'))));
        }
        ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
          name: 'plugins.bundle.config', key: 'dsh-vvox', locale: 'local.voicevox',
        }, Settings));
      },
    };
  },
});
