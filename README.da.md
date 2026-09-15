<p align="center">
  <a href="https://prioritech.co.id">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="PrioriCode logo">
    </picture>
  </a>
</p>
<p align="center">Den open source AI-kodeagent.</p>
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

### Installation

```bash
# YOLO
curl -fsSL https://prioritech.co.id/install | bash

# Pakkehåndteringer
npm i -g prioricode-ai@latest        # eller bun/pnpm/yarn
scoop install prioricode             # Windows
choco install prioricode             # Windows
brew install anomalyco/tap/prioricode # macOS og Linux (anbefalet, altid up to date)
brew install prioricode              # macOS og Linux (officiel brew formula, opdateres sjældnere)
sudo pacman -S prioricode            # Arch Linux (Stable)
paru -S prioricode-bin               # Arch Linux (Latest from AUR)
mise use -g prioricode               # alle OS
nix run nixpkgs#prioricode           # eller github:Prioritech-Indonesia-Optima/prioricode for nyeste dev-branch
```

> [!TIP]
> Fjern versioner ældre end 0.1.x før installation.

### Desktop-app (BETA)

PrioriCode findes også som desktop-app. Download direkte fra [releases-siden](https://github.com/Prioritech-Indonesia-Optima/prioricode/releases) eller [prioritech.co.id/download](https://prioritech.co.id/download).

| Platform              | Download                           |
| --------------------- | ---------------------------------- |
| macOS (Apple Silicon) | `prioricode-desktop-mac-arm64.dmg`   |
| macOS (Intel)         | `prioricode-desktop-mac-x64.dmg`     |
| Windows               | `prioricode-desktop-windows-x64.exe` |
| Linux                 | `.deb`, `.rpm`, eller AppImage     |

```bash
# macOS (Homebrew)
brew install --cask prioricode-desktop
# Windows (Scoop)
scoop bucket add extras; scoop install extras/prioricode-desktop
```

#### Installationsmappe

Installationsscriptet bruger følgende prioriteringsrækkefølge for installationsstien:

1. `$PRIORICODE_INSTALL_DIR` - Tilpasset installationsmappe
2. `$XDG_BIN_DIR` - Sti der følger XDG Base Directory Specification
3. `$HOME/bin` - Standard bruger-bin-mappe (hvis den findes eller kan oprettes)
4. `$HOME/.prioricode/bin` - Standard fallback

```bash
# Eksempler
PRIORICODE_INSTALL_DIR=/usr/local/bin curl -fsSL https://prioritech.co.id/install | bash
XDG_BIN_DIR=$HOME/.local/bin curl -fsSL https://prioritech.co.id/install | bash
```

### Agents

PrioriCode har to indbyggede agents, som du kan skifte mellem med `Tab`-tasten.

- **build** - Standard, agent med fuld adgang til udviklingsarbejde
- **plan** - Skrivebeskyttet agent til analyse og kodeudforskning
  - Afviser filredigering som standard
  - Spørger om tilladelse før bash-kommandoer
  - Ideel til at udforske ukendte kodebaser eller planlægge ændringer

Derudover findes der en **general**-subagent til komplekse søgninger og flertrinsopgaver.
Den bruges internt og kan kaldes via `@general` i beskeder.

Læs mere om [agents](https://prioritech.co.id/docs/agents).

### Bygget på OpenCode

PrioriCode er en fork af [OpenCode](https://github.com/anomalyco/opencode), den open source AI-kodingagent. Vi takker OpenCode-holdet og dets bidragydere for fundamentet, dette projekt bygger på.

### PrioriCode sammenlignet med OpenCode

| Funktion | OpenCode | PrioriCode |
| --- | :---: | :---: |
| Open source AI-kodingagent (TUI + desktop) | ✓ | ✓ |
| Flere LLM-udbydere, plugins og MCP | ✓ | ✓ |
| GitHub Actions-integration | ✓ | ✓ |
| Justerbart kontekstkompakt | ✓ | ✓ |
| Tværsession-koordination (`sessions`-værktøj) | — | ✓ |

**Tværsession-koordination.** Samtidige PrioriCode-sessioner i samme projekt kan koordineres via et indbygget `sessions`-værktøj: opdag søstersessioner, reserver filer for at undgå redigeringskollisioner, send beskeder og still spørgsmål med begrænset ventetid. Noter er varige og leveres automatisk — en baggrunds-watcher vækker en inaktiv session, så den læser en peers note uden polling.

**Justerbart kontekstkompakt.** Kontrol, hvordan en fyldt kontekstvindue håndteres, med `compaction`-konfigurationen: reserver en token-buffer, aktiver eller deaktiver automatisk kompaktering og juster, hvor mange seneste rundgang eller token der bevares ordret.

### Dokumentation

For mere info om konfiguration af PrioriCode, [**se vores docs**](https://prioritech.co.id/docs).

### Bidrag

Hvis du vil bidrage til PrioriCode, så læs vores [contributing docs](./CONTRIBUTING.md) før du sender en pull request.

### Bygget på PrioriCode

Hvis du arbejder på et projekt der er relateret til PrioriCode og bruger "prioricode" som en del af navnet; f.eks. "prioricode-dashboard" eller "prioricode-mobile", så tilføj en note i din README, der tydeliggør at projektet ikke er bygget af PrioriCode-teamet og ikke er tilknyttet os på nogen måde.

---

