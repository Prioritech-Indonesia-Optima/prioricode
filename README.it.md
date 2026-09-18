<p align="center">
  <a href="https://prioritech.co.id">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="Logo PrioriCode">
    </picture>
  </a>
</p>
<p align="center">L’agente di coding AI open source.</p>
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

### Installazione

```bash
# YOLO
curl -fsSL https://prioritech.co.id/install | bash

# Package manager
npm i -g prioricode-ai@latest        # oppure bun/pnpm/yarn
scoop install prioricode             # Windows
choco install prioricode             # Windows
brew install anomalyco/tap/prioricode # macOS e Linux (consigliato, sempre aggiornato)
brew install prioricode              # macOS e Linux (formula brew ufficiale, aggiornata meno spesso)
sudo pacman -S prioricode            # Arch Linux (Stable)
paru -S prioricode-bin               # Arch Linux (Latest from AUR)
mise use -g prioricode               # Qualsiasi OS
nix run nixpkgs#prioricode           # oppure github:Prioritech-Indonesia-Optima/prioricode per l’ultima branch di sviluppo
```

> [!TIP]
> Rimuovi le versioni precedenti alla 0.1.x prima di installare.

### App Desktop (BETA)

PrioriCode è disponibile anche come applicazione desktop. Puoi scaricarla direttamente dalla [pagina delle release](https://github.com/Prioritech-Indonesia-Optima/prioricode/releases) oppure da [prioritech.co.id/download](https://prioritech.co.id/download).

| Piattaforma           | Download                             |
| --------------------- | ------------------------------------ |
| macOS (Apple Silicon) | `prioricode-desktop-mac-arm64.dmg`   |
| macOS (Intel)         | `prioricode-desktop-mac-x64.dmg`     |
| Windows               | `prioricode-desktop-windows-x64.exe` |
| Linux                 | `.deb`, `.rpm`, oppure AppImage      |

```bash
# macOS (Homebrew)
brew install --cask prioricode-desktop
# Windows (Scoop)
scoop bucket add extras; scoop install extras/prioricode-desktop
```

#### Directory di installazione

Lo script di installazione rispetta il seguente ordine di priorità per il percorso di installazione:

1. `$PRIORICODE_INSTALL_DIR` – Directory di installazione personalizzata
2. `$XDG_BIN_DIR` – Percorso conforme alla XDG Base Directory Specification
3. `$HOME/bin` – Directory binaria standard dell’utente (se esiste o può essere creata)
4. `$HOME/.prioricode/bin` – Fallback predefinito

```bash
# Esempi
curl -fsSL https://prioritech.co.id/install | PRIORICODE_INSTALL_DIR=/usr/local/bin bash
curl -fsSL https://prioritech.co.id/install | XDG_BIN_DIR=$HOME/.local/bin bash
```

### Agenti

PrioriCode include due agenti integrati tra cui puoi passare usando il tasto `Tab`.

- **build** – Predefinito, agente con accesso completo per il lavoro di sviluppo
- **plan** – Agente in sola lettura per analisi ed esplorazione del codice
  - Nega le modifiche ai file per impostazione predefinita
  - Chiede il permesso prima di eseguire comandi bash
  - Ideale per esplorare codebase sconosciute o pianificare modifiche

È inoltre incluso un sotto-agente **general** per ricerche complesse e attività multi-step.
Viene utilizzato internamente e può essere invocato usando `@general` nei messaggi.

Scopri di più sugli [agenti](https://prioritech.co.id/docs/agents).

### Basato su OpenCode

PrioriCode è un fork di [OpenCode](https://github.com/anomalyco/opencode), l'agente di coding IA open source. Ringraziamo il team di OpenCode e i suoi contributor per le fondamenta su cui si basa questo progetto.

### Come PrioriCode si confronta con OpenCode

| Funzionalità                                    | OpenCode | PrioriCode |
| ----------------------------------------------- | :------: | :--------: |
| Agente di coding IA open source (TUI + desktop) |    ✓     |     ✓      |
| Multipli provider LLM, plugin e MCP             |    ✓     |     ✓      |
| Integrazione GitHub Actions                     |    ✓     |     ✓      |
| Compattazione del contesto regolabile           |    ✓     |     ✓      |
| Coordinazione tra sessioni (tool `sessions`)    |    —     |     ✓      |

**Coordinazione tra sessioni.** Le sessioni PrioriCode concorrenti sullo stesso progetto possono coordinarsi tramite un tool `sessions` integrato: scoprire sessioni sorelle, riservare file per evitare collisioni di modifica, inviare messaggi e fare domande con attesa limitata. Le note sono durevoli e consegnate automaticamente — un watcher in background risveglia una sessione inattiva affinché legga la nota di un pari senza polling.

**Compattazione del contesto regolabile.** Controlla come viene gestita una finestra di contesto piena con la configurazione `compaction`: riservare un buffer di token, abilitare o disabilitare la compattazione automatica e regolare quanti turni o token recenti vengono preservati alla lettera.

### Documentazione

Per maggiori informazioni su come configurare PrioriCode, [**consulta la nostra documentazione**](https://prioritech.co.id/docs).

### Contribuire

Se sei interessato a contribuire a PrioriCode, leggi la nostra [guida alla contribuzione](./CONTRIBUTING.md) prima di inviare una pull request.

### Costruire su PrioriCode

Se stai lavorando a un progetto correlato a PrioriCode e che utilizza “prioricode” come parte del nome (ad esempio “prioricode-dashboard” o “prioricode-mobile”), aggiungi una nota nel tuo README per chiarire che non è sviluppato dal team PrioriCode e che non è affiliato in alcun modo con noi.

---
