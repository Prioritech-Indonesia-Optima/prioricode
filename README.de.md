<p align="center">
  <a href="https://prioritech.co.id">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="PrioriCode logo">
    </picture>
  </a>
</p>
<p align="center">Der Open-Source KI-Coding-Agent.</p>
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

# Paketmanager
npm i -g prioricode-ai@latest        # oder bun/pnpm/yarn
scoop install prioricode             # Windows
choco install prioricode             # Windows
brew install anomalyco/tap/prioricode # macOS und Linux (empfohlen, immer aktuell)
brew install prioricode              # macOS und Linux (offizielle Brew-Formula, seltener aktualisiert)
sudo pacman -S prioricode            # Arch Linux (Stable)
paru -S prioricode-bin               # Arch Linux (Latest from AUR)
mise use -g prioricode               # jedes Betriebssystem
nix run nixpkgs#prioricode           # oder github:Prioritech-Indonesia-Optima/prioricode für den neuesten dev-Branch
```

> [!TIP]
> Entferne Versionen älter als 0.1.x vor der Installation.

### Desktop-App (BETA)

PrioriCode ist auch als Desktop-Anwendung verfügbar. Lade sie direkt von der [Releases-Seite](https://github.com/Prioritech-Indonesia-Optima/prioricode/releases) oder [prioritech.co.id/download](https://prioritech.co.id/download) herunter.

| Plattform             | Download                           |
| --------------------- | ---------------------------------- |
| macOS (Apple Silicon) | `prioricode-desktop-mac-arm64.dmg`   |
| macOS (Intel)         | `prioricode-desktop-mac-x64.dmg`     |
| Windows               | `prioricode-desktop-windows-x64.exe` |
| Linux                 | `.deb`, `.rpm` oder AppImage       |

```bash
# macOS (Homebrew)
brew install --cask prioricode-desktop
# Windows (Scoop)
scoop bucket add extras; scoop install extras/prioricode-desktop
```

#### Installationsverzeichnis

Das Installationsskript beachtet die folgende Prioritätsreihenfolge für den Installationspfad:

1. `$PRIORICODE_INSTALL_DIR` - Benutzerdefiniertes Installationsverzeichnis
2. `$XDG_BIN_DIR` - XDG Base Directory Specification-konformer Pfad
3. `$HOME/bin` - Standard-Binärverzeichnis des Users (falls vorhanden oder erstellbar)
4. `$HOME/.prioricode/bin` - Standard-Fallback

```bash
# Beispiele
PRIORICODE_INSTALL_DIR=/usr/local/bin curl -fsSL https://prioritech.co.id/install | bash
XDG_BIN_DIR=$HOME/.local/bin curl -fsSL https://prioritech.co.id/install | bash
```

### Agents

PrioriCode enthält zwei eingebaute Agents, zwischen denen du mit der `Tab`-Taste wechseln kannst.

- **build** - Standard-Agent mit vollem Zugriff für Entwicklungsarbeit
- **plan** - Nur-Lese-Agent für Analyse und Code-Exploration
  - Verweigert Datei-Edits standardmäßig
  - Fragt vor dem Ausführen von bash-Befehlen nach
  - Ideal zum Erkunden unbekannter Codebases oder zum Planen von Änderungen

Außerdem ist ein **general**-Subagent für komplexe Suchen und mehrstufige Aufgaben enthalten.
Dieser wird intern genutzt und kann in Nachrichten mit `@general` aufgerufen werden.

Mehr dazu unter [Agents](https://prioritech.co.id/docs/agents).

### Basiert auf OpenCode

PrioriCode ist ein Fork von [OpenCode](https://github.com/anomalyco/opencode), dem Open-Source-KI-Coding-Agenten. Wir danken dem OpenCode-Team und seinen Mitwirkenden für das Fundament, auf dem dieses Projekt aufbaut.

### PrioriCode im Vergleich zu OpenCode

| Funktion | OpenCode | PrioriCode |
| --- | :---: | :---: |
| Open-Source-KI-Coding-Agent (TUI + Desktop) | ✓ | ✓ |
| Mehrere LLM-Anbieter, Plugins und MCP | ✓ | ✓ |
| GitHub-Actions-Integration | ✓ | ✓ |
| Anpassbare Kontext-Kompaktierung | ✓ | ✓ |
| Sitzungsübergreifende Koordination (`sessions`-Tool) | — | ✓ |

**Sitzungsübergreifende Koordination.** Gleichzeitige PrioriCode-Sitzungen im selben Projekt können über ein eingebautes `sessions`-Tool koordinieren: Geschwistersitzungen entdecken, Dateien beanspruchen, um Editierkonflikte zu vermeiden, Nachrichten senden und Fragen mit begrenzter Wartezeit stellen. Notizen sind dauerhaft und werden automatisch zugestellt — ein Hintergrund-Watcher weckt eine idle Sitzung, damit sie die Notiz eines Peers ohne Polling liest.

**Anpassbare Kontext-Kompaktierung.** Steuere über die `compaction`-Konfiguration, wie ein volles Kontextfenster behandelt wird: Token-Puffer reservieren, automatische Kompaktierung aktivieren oder deaktivieren und einstellen, wie viele aktuelle Runden oder Token wortwörtlich beibehalten werden.

### Dokumentation

Mehr Infos zur Konfiguration von PrioriCode findest du in unseren [**Docs**](https://prioritech.co.id/docs).

### Beitragen

Wenn du zu PrioriCode beitragen möchtest, lies bitte unsere [Contributing Docs](./CONTRIBUTING.md), bevor du einen Pull Request einreichst.

### Auf PrioriCode aufbauen

Wenn du an einem Projekt arbeitest, das mit PrioriCode zusammenhängt und "prioricode" als Teil seines Namens verwendet (z.B. "prioricode-dashboard" oder "prioricode-mobile"), füge bitte einen Hinweis in deine README ein, dass es nicht vom PrioriCode-Team gebaut wird und nicht in irgendeiner Weise mit uns verbunden ist.

---

