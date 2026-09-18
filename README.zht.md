<p align="center">
  <a href="https://prioritech.co.id">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="PrioriCode logo">
    </picture>
  </a>
</p>
<p align="center">開源的 AI Coding Agent。</p>
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

### 安裝

```bash
# 直接安裝 (YOLO)
curl -fsSL https://prioritech.co.id/install | bash

# 套件管理員
npm i -g prioricode-ai@latest        # 也可使用 bun/pnpm/yarn
scoop install prioricode             # Windows
choco install prioricode             # Windows
brew install anomalyco/tap/prioricode # macOS 與 Linux（推薦，始終保持最新）
brew install prioricode              # macOS 與 Linux（官方 brew formula，更新頻率較低）
sudo pacman -S prioricode            # Arch Linux (Stable)
paru -S prioricode-bin               # Arch Linux (Latest from AUR)
mise use -g prioricode               # 任何作業系統
nix run nixpkgs#prioricode           # 或使用 github:Prioritech-Indonesia-Optima/prioricode 以取得最新開發分支
```

> [!TIP]
> 安裝前請先移除 0.1.x 以前的舊版本。

### 桌面應用程式 (BETA)

PrioriCode 也提供桌面版應用程式。您可以直接從 [發佈頁面 (releases page)](https://github.com/Prioritech-Indonesia-Optima/prioricode/releases) 或 [prioritech.co.id/download](https://prioritech.co.id/download) 下載。

| 平台                  | 下載連結                             |
| --------------------- | ------------------------------------ |
| macOS (Apple Silicon) | `prioricode-desktop-mac-arm64.dmg`   |
| macOS (Intel)         | `prioricode-desktop-mac-x64.dmg`     |
| Windows               | `prioricode-desktop-windows-x64.exe` |
| Linux                 | `.deb`, `.rpm`, 或 AppImage          |

```bash
# macOS (Homebrew Cask)
brew install --cask prioricode-desktop
# Windows (Scoop)
scoop bucket add extras; scoop install extras/prioricode-desktop
```

#### 安裝目錄

安裝腳本會依據以下優先順序決定安裝路徑：

1. `$PRIORICODE_INSTALL_DIR` - 自定義安裝目錄
2. `$XDG_BIN_DIR` - 符合 XDG 基礎目錄規範的路徑
3. `$HOME/bin` - 標準使用者執行檔目錄 (若存在或可建立)
4. `$HOME/.prioricode/bin` - 預設備用路徑

```bash
# 範例
curl -fsSL https://prioritech.co.id/install | PRIORICODE_INSTALL_DIR=/usr/local/bin bash
curl -fsSL https://prioritech.co.id/install | XDG_BIN_DIR=$HOME/.local/bin bash
```

### Agents

PrioriCode 內建了兩種 Agent，您可以使用 `Tab` 鍵快速切換。

- **build** - 預設模式，具備完整權限的 Agent，適用於開發工作。
- **plan** - 唯讀模式，適用於程式碼分析與探索。
  - 預設禁止修改檔案。
  - 執行 bash 指令前會詢問權限。
  - 非常適合用來探索陌生的程式碼庫或規劃變更。

此外，PrioriCode 還包含一個 **general** 子 Agent，用於處理複雜搜尋與多步驟任務。此 Agent 供系統內部使用，亦可透過在訊息中輸入 `@general` 來呼叫。

了解更多關於 [Agents](https://prioritech.co.id/docs/agents) 的資訊。

### 基於 OpenCode

PrioriCode 是 [OpenCode](https://github.com/anomalyco/opencode)（開源 AI 程式設計代理）的分支。我們感謝 OpenCode 團隊及其貢獻者為該項目奠定的基礎。

### PrioriCode 與 OpenCode 的對比

| 功能                                 | OpenCode | PrioriCode |
| ------------------------------------ | :------: | :--------: |
| 開源 AI 程式設計代理（TUI + 桌面端） |    ✓     |     ✓      |
| 多 LLM 供應商、外掛與 MCP            |    ✓     |     ✓      |
| GitHub Actions 整合                  |    ✓     |     ✓      |
| 可調整的上下文壓縮                   |    ✓     |     ✓      |
| 跨工作階段協調（`sessions` 工具）    |    —     |     ✓      |

**跨工作階段協調.** 在同一專案上並行的多個 PrioriCode 工作階段可透過內建的 `sessions` 工具協調：發現同級工作階段、聲明檔案以避免編輯衝突、傳送訊息，以及帶逾時等待地提問。筆記是持久的並自動投递——背景監視器會喚起閒置工作階段，使其無需輪詢即可讀取來自其他工作階段的筆記。

**可調整的上下文壓縮.** 透過 `compaction` 設定控制上下文窗口寫滿時的處理方式：預留 token 緩衝、啟用或停用自動壓縮，以及調整壓縮後逐字保留的最近輪次或 token 數量。

### 線上文件

關於如何設定 PrioriCode 的詳細資訊，請參閱我們的 [**官方文件**](https://prioritech.co.id/docs)。

### 參與貢獻

如果您有興趣參與 PrioriCode 的開發，請在提交 Pull Request 前先閱讀我們的 [貢獻指南 (Contributing Docs)](./CONTRIBUTING.md)。

### 基於 PrioriCode 進行開發

如果您正在開發與 PrioriCode 相關的專案，並在名稱中使用了 "prioricode"（例如 "prioricode-dashboard" 或 "prioricode-mobile"），請在您的 README 中加入聲明，說明該專案並非由 PrioriCode 團隊開發，且與我們沒有任何隸屬關係。

---
