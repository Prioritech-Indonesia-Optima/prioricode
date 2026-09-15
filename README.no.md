<p align="center">
  <a href="https://prioritech.co.id">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="PrioriCode logo">
    </picture>
  </a>
</p>
<p align="center">AI-kodeagent med åpen kildekode.</p>
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

### Installasjon

```bash
# YOLO
curl -fsSL https://prioritech.co.id/install | bash

# Pakkehåndterere
npm i -g prioricode-ai@latest        # eller bun/pnpm/yarn
scoop install prioricode             # Windows
choco install prioricode             # Windows
brew install anomalyco/tap/prioricode # macOS og Linux (anbefalt, alltid oppdatert)
brew install prioricode              # macOS og Linux (offisiell brew-formel, oppdateres sjeldnere)
sudo pacman -S prioricode            # Arch Linux (Stable)
paru -S prioricode-bin               # Arch Linux (Latest from AUR)
mise use -g prioricode               # alle OS
nix run nixpkgs#prioricode           # eller github:Prioritech-Indonesia-Optima/prioricode for nyeste dev-branch
```

> [!TIP]
> Fjern versjoner eldre enn 0.1.x før du installerer.

### Desktop-app (BETA)

PrioriCode er også tilgjengelig som en desktop-app. Last ned direkte fra [releases-siden](https://github.com/Prioritech-Indonesia-Optima/prioricode/releases) eller [prioritech.co.id/download](https://prioritech.co.id/download).

| Plattform             | Nedlasting                         |
| --------------------- | ---------------------------------- |
| macOS (Apple Silicon) | `prioricode-desktop-mac-arm64.dmg`   |
| macOS (Intel)         | `prioricode-desktop-mac-x64.dmg`     |
| Windows               | `prioricode-desktop-windows-x64.exe` |
| Linux                 | `.deb`, `.rpm` eller AppImage      |

```bash
# macOS (Homebrew)
brew install --cask prioricode-desktop
# Windows (Scoop)
scoop bucket add extras; scoop install extras/prioricode-desktop
```

#### Installasjonsmappe

Installasjonsskriptet bruker følgende prioritet for installasjonsstien:

1. `$PRIORICODE_INSTALL_DIR` - Egendefinert installasjonsmappe
2. `$XDG_BIN_DIR` - Sti som følger XDG Base Directory Specification
3. `$HOME/bin` - Standard brukerbinar-mappe (hvis den finnes eller kan opprettes)
4. `$HOME/.prioricode/bin` - Standard fallback

```bash
# Eksempler
PRIORICODE_INSTALL_DIR=/usr/local/bin curl -fsSL https://prioritech.co.id/install | bash
XDG_BIN_DIR=$HOME/.local/bin curl -fsSL https://prioritech.co.id/install | bash
```

### Agents

PrioriCode har to innebygde agents du kan bytte mellom med `Tab`-tasten.

- **build** - Standard, agent med full tilgang for utviklingsarbeid
- **plan** - Skrivebeskyttet agent for analyse og kodeutforsking
  - Nekter filendringer som standard
  - Spør om tillatelse før bash-kommandoer
  - Ideell for å utforske ukjente kodebaser eller planlegge endringer

Det finnes også en **general**-subagent for komplekse søk og flertrinnsoppgaver.
Den brukes internt og kan kalles via `@general` i meldinger.

Les mer om [agents](https://prioritech.co.id/docs/agents).

### Bygget på OpenCode

PrioriCode er en fork av [OpenCode](https://github.com/anomalyco/opencode), den open source AI-kodingagenten. Vi takker OpenCode-teamet og dets bidragsytere for grunnlaget dette prosjektet bygger på.

### PrioriCode sammenlignet med OpenCode

| Funksjon | OpenCode | PrioriCode |
| --- | :---: | :---: |
| Open source AI-kodingagent (TUI + desktop) | ✓ | ✓ |
| Flere LLM-leverandører, plugins og MCP | ✓ | ✓ |
| GitHub Actions-integrasjon | ✓ | ✓ |
| Justerbart kontekstkompakt | ✓ | ✓ |
| Tverrsesjonskoordinering (`sessions`-verktøy) | — | ✓ |

**Tverrsesjonskoordinering.** Samtidige PrioriCode-sesjoner i samme prosjekt kan koordineres via et innebygd `sessions`-verktøy: oppdag søstersesjoner, reserver filer for å unngå redigeringskollisjoner, send meldinger og still spørsmål med begrenset ventetid. Notater er varige og leveres automatisk — en bakgrunnsvokter vekker en inaktiv sesjon slik at den leser en peers notat uten polling.

**Justerbart kontekstkompakt.** Kontroller hvordan et fullt kontekstvindu håndteres med `compaction`-konfigurasjonen: reserver en tokenbuffer, aktiver eller deaktiver automatisk komprimering og juster hvor mange nylige runder eller token som beholdes ordrett.

### Dokumentasjon

For mer info om hvordan du konfigurerer PrioriCode, [**se dokumentasjonen**](https://prioritech.co.id/docs).

### Bidra

Hvis du vil bidra til PrioriCode, les [contributing docs](./CONTRIBUTING.md) før du sender en pull request.

### Bygge på PrioriCode

Hvis du jobber med et prosjekt som er relatert til PrioriCode og bruker "prioricode" som en del av navnet; for eksempel "prioricode-dashboard" eller "prioricode-mobile", legg inn en merknad i README som presiserer at det ikke er bygget av PrioriCode-teamet og ikke er tilknyttet oss på noen måte.

---

