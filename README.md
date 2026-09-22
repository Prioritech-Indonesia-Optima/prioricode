<p align="center">
  <a href="https://prioritech.co.id">
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
  <a href="https://github.com/Prioritech-Indonesia-Optima/prioricode/actions/workflows/publish.yml"><img alt="Build status" src="https://img.shields.io/github/actions/workflow/status/Prioritech-Indonesia-Optima/prioricode/publish.yml?style=flat-square&branch=dev" /></a>
</p>

<p align="center">
  <a href="https://prioritech.co.id">prioritech.co.id</a> ·
  <a href="https://github.com/Prioritech-Indonesia-Optima/prioricode">GitHub</a>
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

### Installation

```bash
# macOS / Linux (bash)
curl -fsSL https://github.com/Prioritech-Indonesia-Optima/prioricode/raw/main/install | bash

# Windows (PowerShell)
irm https://github.com/Prioritech-Indonesia-Optima/prioricode/raw/main/install.ps1 | iex

# Or download a binary directly from GitHub Releases
# https://github.com/Prioritech-Indonesia-Optima/prioricode/releases

# From source (Nix)
nix run github:Prioritech-Indonesia-Optima/prioricode
```

> [!TIP]
> Remove versions older than 0.1.x before installing.

### Desktop App (coming soon)

Desktop builds are not published yet. The CLI above is the supported way to run PrioriCode; desktop downloads will appear on the [releases page](https://github.com/Prioritech-Indonesia-Optima/prioricode/releases).

#### Installation Directory

The install script respects the following priority order for the installation path:

1. `$PRIORICODE_INSTALL_DIR` - Custom installation directory
2. `$XDG_BIN_DIR` - XDG Base Directory Specification compliant path
3. `$HOME/bin` - Standard user binary directory (if it exists or can be created)
4. `$HOME/.prioricode/bin` - Default fallback

```bash
# Examples
curl -fsSL https://github.com/Prioritech-Indonesia-Optima/prioricode/raw/main/install | PRIORICODE_INSTALL_DIR=/usr/local/bin bash
XDG_BIN_DIR=$HOME/.local/bin curl -fsSL https://github.com/Prioritech-Indonesia-Optima/prioricode/raw/main/install | bash
```

On Windows, `install.ps1` uses `$env:PRIORICODE_INSTALL_DIR`, falling back to `%USERPROFILE%\.prioricode\bin`.

### Agents

PrioriCode includes two built-in agents you can switch between with the `Tab` key.

- **build** - Default, full-access agent for development work
- **plan** - Read-only agent for analysis and code exploration
  - Denies file edits by default
  - Asks permission before running bash commands
  - Ideal for exploring unfamiliar codebases or planning changes

Also included is a **general** subagent for complex searches and multistep tasks.
This is used internally and can be invoked using `@general` in messages.

Learn more about [agents](https://prioritech.co.id/docs/agents).

### Built on OpenCode

PrioriCode is a fork of [OpenCode](https://github.com/anomalyco/opencode), the open source AI coding agent. We thank the OpenCode team and its contributors for the foundation this project builds on.

### How PrioriCode compares to OpenCode

PrioriCode keeps the entire OpenCode core — the terminal UI, desktop app, agents, providers, plugins, MCP, and GitHub integration — and layers new capabilities on top.

| Capability                                   | OpenCode | PrioriCode |
| -------------------------------------------- | :------: | :--------: |
| Open source AI coding agent (TUI + desktop)  |    ✓     |     ✓      |
| Multiple LLM providers, plugins, and MCP     |    ✓     |     ✓      |
| GitHub Actions integration                   |    ✓     |     ✓      |
| Tunable context compaction                   |    ✓     |     ✓      |
| Cross-session coordination (`sessions` tool) |    —     |     ✓      |

**Cross-session coordination.** Concurrent PrioriCode sessions working on the same project can coordinate through a built-in `sessions` tool: discover sibling sessions, claim files to avoid edit collisions, send messages, and ask questions with a bounded wait. Notes are durable and delivered automatically — a background watcher wakes an idle session so it reads a peer's note without polling.

**Tunable context compaction.** Control how a full context window is handled with the `compaction` config: reserve a token buffer, enable or disable automatic compaction, and tune how many recent turns or tokens are preserved verbatim.

### Documentation

For more info on how to configure PrioriCode, [**head over to our docs**](https://prioritech.co.id/docs).

### Contributing

If you're interested in contributing to PrioriCode, please read our [contributing docs](./CONTRIBUTING.md) before submitting a pull request.

---

prioricode is maintained by [Prioritech Indonesia Optima](https://prioritech.co.id).
