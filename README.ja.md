<p align="center">
  <a href="https://prioritech.co.id">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="PrioriCode logo">
    </picture>
  </a>
</p>
<p align="center">オープンソースのAIコーディングエージェント。</p>
<p align="center">
  <a href="https://www.npmjs.com/package/prioricode-ai"><img alt="npm" src="https://img.shields.io/npm/v/prioricode-ai?style=flat-square" /></a>
  <a href="https://github.com/Prioritech-Indonesia-Optima/prioricode/actions/workflows/publish.yml"><img alt="Build status" src="https://img.shields.io/github/actions/workflow/status/Prioritech-Indonesia-Optima/prioricode/publish.yml?style=flat-square&branch=dev" /></a>
</p>

<p align="center">
  <a href="README.md">English</a> |
  <a href="README.zh.md">简体中文</a> |
  <a href="README.zht.md">繁體中文</a> |
  <a href="README.ko.md">한국어</a> |
  <a href="README.de.md">Deutsch</a> |
  <a href="README.es.md">Español</a> |
  <a href="README.fr.md">Français</a> |
  <a href="README.it.md">Italiano</a> |
  <a href="README.da.md">Dansk</a> |
  <a href="README.ja.md">日本語</a> |
  <a href="README.pl.md">Polski</a> |
  <a href="README.ru.md">Русский</a> |
  <a href="README.bs.md">Bosanski</a> |
  <a href="README.ar.md">العربية</a> |
  <a href="README.no.md">Norsk</a> |
  <a href="README.br.md">Português (Brasil)</a> |
  <a href="README.th.md">ไทย</a> |
  <a href="README.tr.md">Türkçe</a> |
  <a href="README.uk.md">Українська</a> |
  <a href="README.bn.md">বাংলা</a> |
  <a href="README.gr.md">Ελληνικά</a> |
  <a href="README.vi.md">Tiếng Việt</a>
</p>

---

### インストール

```bash
# YOLO
curl -fsSL https://prioritech.co.id/install | bash

# パッケージマネージャー
npm i -g prioricode-ai@latest        # bun/pnpm/yarn でもOK
scoop install prioricode             # Windows
choco install prioricode             # Windows
brew install anomalyco/tap/prioricode # macOS と Linux（推奨。常に最新）
brew install prioricode              # macOS と Linux（公式 brew formula。更新頻度は低め）
sudo pacman -S prioricode            # Arch Linux (Stable)
paru -S prioricode-bin               # Arch Linux (Latest from AUR)
mise use -g prioricode               # どのOSでも
nix run nixpkgs#prioricode           # または github:Prioritech-Indonesia-Optima/prioricode で最新 dev ブランチ
```

> [!TIP]
> インストール前に 0.1.x より古いバージョンを削除してください。

### デスクトップアプリ (BETA)

PrioriCode はデスクトップアプリとしても利用できます。[releases page](https://github.com/Prioritech-Indonesia-Optima/prioricode/releases) から直接ダウンロードするか、[prioritech.co.id/download](https://prioritech.co.id/download) を利用してください。

| プラットフォーム      | ダウンロード                       |
| --------------------- | ---------------------------------- |
| macOS (Apple Silicon) | `prioricode-desktop-mac-arm64.dmg`   |
| macOS (Intel)         | `prioricode-desktop-mac-x64.dmg`     |
| Windows               | `prioricode-desktop-windows-x64.exe` |
| Linux                 | `.deb`、`.rpm`、または AppImage    |

```bash
# macOS (Homebrew)
brew install --cask prioricode-desktop
# Windows (Scoop)
scoop bucket add extras; scoop install extras/prioricode-desktop
```

#### インストールディレクトリ

インストールスクリプトは、インストール先パスを次の優先順位で決定します。

1. `$PRIORICODE_INSTALL_DIR` - カスタムのインストールディレクトリ
2. `$XDG_BIN_DIR` - XDG Base Directory Specification に準拠したパス
3. `$HOME/bin` - 標準のユーザー用バイナリディレクトリ（存在する場合、または作成できる場合）
4. `$HOME/.prioricode/bin` - デフォルトのフォールバック

```bash
# 例
PRIORICODE_INSTALL_DIR=/usr/local/bin curl -fsSL https://prioritech.co.id/install | bash
XDG_BIN_DIR=$HOME/.local/bin curl -fsSL https://prioritech.co.id/install | bash
```

### Agents

PrioriCode には組み込みの Agent が2つあり、`Tab` キーで切り替えられます。

- **build** - デフォルト。開発向けのフルアクセス Agent
- **plan** - 分析とコード探索向けの読み取り専用 Agent
  - デフォルトでファイル編集を拒否
  - bash コマンド実行前に確認
  - 未知のコードベース探索や変更計画に最適

また、複雑な検索やマルチステップのタスク向けに **general** サブ Agent も含まれています。
内部的に使用されており、メッセージで `@general` と入力して呼び出せます。

[agents](https://prioritech.co.id/docs/agents) の詳細はこちら。

### OpenCode をベースに

PrioriCode は、オープンソースの AI コーディングエージェント [OpenCode](https://github.com/anomalyco/opencode) のフォークです。このプロジェクトの基盤を築いてくれた OpenCode チームと貢献者に感謝します。

### PrioriCode と OpenCode の比較

| 機能 | OpenCode | PrioriCode |
| --- | :---: | :---: |
| オープンソース AI コーディングエージェント (TUI + デスクトップ) | ✓ | ✓ |
| 複数の LLM プロバイダー、プラグイン、MCP | ✓ | ✓ |
| GitHub Actions 統合 | ✓ | ✓ |
| 調整可能なコンテキスト圧縮 | ✓ | ✓ |
| セッション間協調 (`sessions` ツール) | — | ✓ |

**セッション間協調.** 同じプロジェクトで並行して動作する複数の PrioriCode セッションは、組み込みの `sessions` ツールで協調できます: 兄弟セッションの発見、ファイルの確保による編集競合の回避、メッセージの送信、制限付き待機での質問。ノートは永続的で自動的に配信されます — バックグラウンドのウォッチャーがアイドルのセッションを起動し、ポーリングせずにピアのノートを读取します。

**調整可能なコンテキスト圧縮.** `compaction` 設定で、コンテキストウィンドウが満杯になったときの処理を制御します: トークンバッファの確保、自動圧縮の有効/無効、圧縮後にそのまま保持する最近のターン数やトークン数の調整。

### ドキュメント

PrioriCode の設定については [**ドキュメント**](https://prioritech.co.id/docs) を参照してください。

### コントリビュート

PrioriCode に貢献したい場合は、Pull Request を送る前に [contributing docs](./CONTRIBUTING.md) を読んでください。

### PrioriCode の上に構築する

PrioriCode に関連するプロジェクトで、名前に "prioricode"（例: "prioricode-dashboard" や "prioricode-mobile"）を含める場合は、そのプロジェクトが PrioriCode チームによって作られたものではなく、いかなる形でも関係がないことを README に明記してください。

---

