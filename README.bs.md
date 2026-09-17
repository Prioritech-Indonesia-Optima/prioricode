<p align="center">
  <a href="https://prioritech.co.id">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="PrioriCode logo">
    </picture>
  </a>
</p>
<p align="center">PrioriCode je open source AI agent za programiranje.</p>
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

### Instalacija

```bash
# YOLO
curl -fsSL https://prioritech.co.id/install | bash

# Package manageri
npm i -g prioricode-ai@latest        # ili bun/pnpm/yarn
scoop install prioricode             # Windows
choco install prioricode             # Windows
brew install anomalyco/tap/prioricode # macOS i Linux (preporučeno, uvijek ažurno)
brew install prioricode              # macOS i Linux (zvanična brew formula, rjeđe se ažurira)
sudo pacman -S prioricode            # Arch Linux (Stable)
paru -S prioricode-bin               # Arch Linux (Latest from AUR)
mise use -g prioricode               # Bilo koji OS
nix run nixpkgs#prioricode           # ili github:Prioritech-Indonesia-Optima/prioricode za najnoviji dev branch
```

> [!TIP]
> Ukloni verzije starije od 0.1.x prije instalacije.

### Desktop aplikacija (BETA)

PrioriCode je dostupan i kao desktop aplikacija. Preuzmi je direktno sa [stranice izdanja](https://github.com/Prioritech-Indonesia-Optima/prioricode/releases) ili sa [prioritech.co.id/download](https://prioritech.co.id/download).

| Platforma             | Preuzimanje                        |
| --------------------- | ---------------------------------- |
| macOS (Apple Silicon) | `prioricode-desktop-mac-arm64.dmg`   |
| macOS (Intel)         | `prioricode-desktop-mac-x64.dmg`     |
| Windows               | `prioricode-desktop-windows-x64.exe` |
| Linux                 | `.deb`, `.rpm`, ili AppImage       |

```bash
# macOS (Homebrew)
brew install --cask prioricode-desktop
# Windows (Scoop)
scoop bucket add extras; scoop install extras/prioricode-desktop
```

#### Instalacijski direktorij

Instalacijska skripta koristi sljedeći redoslijed prioriteta za putanju instalacije:

1. `$PRIORICODE_INSTALL_DIR` - Prilagođeni instalacijski direktorij
2. `$XDG_BIN_DIR` - Putanja usklađena sa XDG Base Directory specifikacijom
3. `$HOME/bin` - Standardni korisnički bin direktorij (ako postoji ili se može kreirati)
4. `$HOME/.prioricode/bin` - Podrazumijevana rezervna lokacija

```bash
# Primjeri
curl -fsSL https://prioritech.co.id/install | PRIORICODE_INSTALL_DIR=/usr/local/bin bash
curl -fsSL https://prioritech.co.id/install | XDG_BIN_DIR=$HOME/.local/bin bash
```

### Agenti

PrioriCode uključuje dva ugrađena agenta između kojih možeš prebacivati tasterom `Tab`.

- **build** - Podrazumijevani agent sa punim pristupom za razvoj
- **plan** - Agent samo za čitanje za analizu i istraživanje koda
  - Podrazumijevano zabranjuje izmjene datoteka
  - Traži dozvolu prije pokretanja bash komandi
  - Idealan za istraživanje nepoznatih codebase-ova ili planiranje izmjena

Uključen je i **general** pod-agent za složene pretrage i višekoračne zadatke.
Koristi se interno i može se pozvati pomoću `@general` u porukama.

Saznaj više o [agentima](https://prioritech.co.id/docs/agents).

### Izgrađeno na OpenCode

PrioriCode je fork od [OpenCode](https://github.com/anomalyco/opencode), open source AI agenta za programiranje. Hvala OpenCode timu i njegovim doprinosiocima za temelj na kojem se ovaj projekt gradi.

### PrioriCode u poređenju sa OpenCode

| Mogućnost | OpenCode | PrioriCode |
| --- | :---: | :---: |
| Open source AI agent za programiranje (TUI + desktop) | ✓ | ✓ |
| Više LLM provajdera, pluginovi i MCP | ✓ | ✓ |
| GitHub Actions integracija | ✓ | ✓ |
| Podesivo sabijanje konteksta | ✓ | ✓ |
| Koordinacija između sesija (alat `sessions`) | — | ✓ |

**Koordinacija između sesija.** Konkurentne PrioriCode sesije u istom projektu mogu se koordinirati kroz ugrađeni `sessions` alat: otkrivanje sestrinskih sesija, rezervisanje datoteka da se izbjegnu sudari uređivanja, slanje poruka i postavljanje pitanja sa ograničenim čekanjem. Bilješke su trajne i isporučuju se automatski — pozadinski promatrajar budi neaktivnu sesiju da pročitaju bilješku vršnjaka bez pollinga.

**Podesivo sabijanje konteksta.** Kontrolišite kako se obrađuje pun prozor konteksta pomoću `compaction` konfiguracije: rezervišite bafer tokena, uključite ili isključite automatsko sabijanje i podesite koliko nedavnih rundi ili tokena se čuva doslovno.

### Dokumentacija

Za više informacija o konfiguraciji PrioriCode-a, [**pogledaj dokumentaciju**](https://prioritech.co.id/docs).

### Doprinosi

Ako želiš doprinositi PrioriCode-u, pročitaj [upute za doprinošenje](./CONTRIBUTING.md) prije slanja pull requesta.

### Gradnja na PrioriCode-u

Ako radiš na projektu koji je povezan s PrioriCode-om i koristi "prioricode" kao dio naziva, npr. "prioricode-dashboard" ili "prioricode-mobile", dodaj napomenu u svoj README da projekat nije napravio PrioriCode tim i da nije povezan s nama.

---

