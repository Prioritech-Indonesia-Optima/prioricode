<p align="center">
  <a href="https://prioricode.ai">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="PrioriCode logo">
    </picture>
  </a>
</p>
<p align="center">The open source AI coding agent.</p>
<p align="center">prioricode, by Prioritech Indonesia Optima.</p>

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

[![PrioriCode Terminal UI](packages/web/src/assets/lander/screenshot.png)](https://prioricode.ai)

---

### Installation

```bash
# YOLO
curl -fsSL https://prioricode.ai/install | bash

# Package managers
npm i -g prioricode-ai@latest        # or bun/pnpm/yarn
scoop install prioricode             # Windows
choco install prioricode             # Windows
brew install anomalyco/tap/prioricode # macOS and Linux (recommended, always up to date)
brew install prioricode              # macOS and Linux (official brew formula, updated less)
sudo pacman -S prioricode            # Arch Linux (Stable)
paru -S prioricode-bin               # Arch Linux (Latest from AUR)
mise use -g prioricode               # Any OS
nix run nixpkgs#prioricode           # or github:Prioritech-Indonesia-Optima/prioricode for latest dev branch
```

> [!TIP]
> Remove versions older than 0.1.x before installing.

### Desktop App (BETA)

PrioriCode is also available as a desktop application. Download directly from the [releases page](https://github.com/Prioritech-Indonesia-Optima/prioricode/releases) or [prioricode.ai/download](https://prioricode.ai/download).

| Platform              | Download                           |
| --------------------- | ---------------------------------- |
| macOS (Apple Silicon) | `prioricode-desktop-mac-arm64.dmg`   |
| macOS (Intel)         | `prioricode-desktop-mac-x64.dmg`     |
| Windows               | `prioricode-desktop-windows-x64.exe` |
| Linux                 | `.deb`, `.rpm`, or `.AppImage`     |

```bash
# macOS (Homebrew)
brew install --cask prioricode-desktop
# Windows (Scoop)
scoop bucket add extras; scoop install extras/prioricode-desktop
```

#### Installation Directory

The install script respects the following priority order for the installation path:

1. `$PRIORICODE_INSTALL_DIR` - Custom installation directory
2. `$XDG_BIN_DIR` - XDG Base Directory Specification compliant path
3. `$HOME/bin` - Standard user binary directory (if it exists or can be created)
4. `$HOME/.prioricode/bin` - Default fallback

```bash
# Examples
PRIORICODE_INSTALL_DIR=/usr/local/bin curl -fsSL https://prioricode.ai/install | bash
XDG_BIN_DIR=$HOME/.local/bin curl -fsSL https://prioricode.ai/install | bash
```

### Agents

PrioriCode includes two built-in agents you can switch between with the `Tab` key.

- **build** - Default, full-access agent for development work
- **plan** - Read-only agent for analysis and code exploration
  - Denies file edits by default
  - Asks permission before running bash commands
  - Ideal for exploring unfamiliar codebases or planning changes

Also included is a **general** subagent for complex searches and multistep tasks.
This is used internally and can be invoked using `@general` in messages.

Learn more about [agents](https://prioricode.ai/docs/agents).

### Documentation

For more info on how to configure PrioriCode, [**head over to our docs**](https://prioricode.ai/docs).

### Contributing

If you're interested in contributing to PrioriCode, please read our [contributing docs](./CONTRIBUTING.md) before submitting a pull request.

### Building on PrioriCode

If you are working on a project that's related to PrioriCode and is using "prioricode" as part of its name, for example "prioricode-dashboard" or "prioricode-mobile", please add a note to your README to clarify that it is not built by the PrioriCode team and is not affiliated with us in any way.

---

prioricode is maintained by Prioritech Indonesia Optima.
