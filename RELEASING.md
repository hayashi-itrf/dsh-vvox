# DSH Open掲載用

## 申請文案

**Title:** `[plugin-add] dsh-vvox`

**Plugin link:** npm公開後は `dsh-vvox`。Git経由の場合は、公開GitHubリポジトリのURL、バージョン、完全なコミットSHAを記載する。

**Summary (English)**

Read DeepSeek Harness replies aloud as they are written using local VOICEVOX on macOS. Speech synthesis supports Japanese only. The plugin automatically uses standard synthesis when the engine lacks streaming support. Includes character and voice style selection, speed, volume, and voice previews. No FFmpeg required.

**掲載用の中国語訳**

在 macOS 上通过本地 VOICEVOX，在 DeepSeek Harness 生成回复时开始朗读。**朗读仅支持日语**。引擎不支持流式合成时自动切换为逐句合成。可选择角色和声音风格，调整语速及音量，并试听。无需安装 FFmpeg。

**Additional details (English)**

This bundle brings Japanese VOICEVOX voices to the regular DSH chat. It sends the text to the local VOICEVOX Engine API and plays the audio inside DSH. Tested with DSH Desktop 0.2.2-rc.5 on macOS and VOICEVOX Engine 0.26.2. MIT license. VOICEVOX and its voice models are installed separately.

## 公開前の確認

1. 公開するGitHubリポジトリを用意し、`package.json` の `repository` に実際のURLを設定する。
2. npm公開の場合は `private: true` を外す。
3. `npm run check`、`npm test`、`npm pack --dry-run` を実行する。公開形態の配布物を別のテスト用プロファイルから導入し、詳細ページ、設定画面、試聴を確認する。
4. 公開npm版またはインストール可能な固定Gitコミットを用意し、[掲載申請フォーム](https://github.com/polang233/dsh-plugin-index/issues/new?template=plugin-add.yml)に申請文を記入する。掲載文に「読み上げは日本語のみ対応」を残すよう伝える。

[DSH Open掲載ガイド](https://github.com/polang233/dsh-plugin-index/blob/main/.github/CONTRIBUTING.md)
