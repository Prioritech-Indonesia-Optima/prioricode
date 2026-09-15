<p align="center">
  <a href="https://prioritech.co.id">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="PrioriCode logo">
    </picture>
  </a>
</p>
<p align="center">Otwartoźródłowy agent kodujący AI.</p>
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

### Instalacja

```bash
# YOLO
curl -fsSL https://prioritech.co.id/install | bash

# Menedżery pakietów
npm i -g prioricode-ai@latest        # albo bun/pnpm/yarn
scoop install prioricode             # Windows
choco install prioricode             # Windows
brew install anomalyco/tap/prioricode # macOS i Linux (polecane, zawsze aktualne)
brew install prioricode              # macOS i Linux (oficjalna formuła brew, rzadziej aktualizowana)
sudo pacman -S prioricode            # Arch Linux (Stable)
paru -S prioricode-bin               # Arch Linux (Latest from AUR)
mise use -g prioricode               # dowolny system
nix run nixpkgs#prioricode           # lub github:Prioritech-Indonesia-Optima/prioricode dla najnowszej gałęzi dev
```

> [!TIP]
> Przed instalacją usuń wersje starsze niż 0.1.x.

### Aplikacja desktopowa (BETA)

PrioriCode jest także dostępny jako aplikacja desktopowa. Pobierz ją bezpośrednio ze strony [releases](https://github.com/Prioritech-Indonesia-Optima/prioricode/releases) lub z [prioritech.co.id/download](https://prioritech.co.id/download).

| Platforma             | Pobieranie                         |
| --------------------- | ---------------------------------- |
| macOS (Apple Silicon) | `prioricode-desktop-mac-arm64.dmg`   |
| macOS (Intel)         | `prioricode-desktop-mac-x64.dmg`     |
| Windows               | `prioricode-desktop-windows-x64.exe` |
| Linux                 | `.deb`, `.rpm` lub AppImage        |

```bash
# macOS (Homebrew)
brew install --cask prioricode-desktop
# Windows (Scoop)
scoop bucket add extras; scoop install extras/prioricode-desktop
```

#### Katalog instalacji

Skrypt instalacyjny stosuje następujący priorytet wyboru ścieżki instalacji:

1. `$PRIORICODE_INSTALL_DIR` - Własny katalog instalacji
2. `$XDG_BIN_DIR` - Ścieżka zgodna ze specyfikacją XDG Base Directory
3. `$HOME/bin` - Standardowy katalog binarny użytkownika (jeśli istnieje lub można go utworzyć)
4. `$HOME/.prioricode/bin` - Domyślny fallback

```bash
# Przykłady
PRIORICODE_INSTALL_DIR=/usr/local/bin curl -fsSL https://prioritech.co.id/install | bash
XDG_BIN_DIR=$HOME/.local/bin curl -fsSL https://prioritech.co.id/install | bash
```

### Agents

PrioriCode zawiera dwóch wbudowanych agentów, między którymi możesz przełączać się klawiszem `Tab`.

- **build** - Domyślny agent z pełnym dostępem do pracy developerskiej
- **plan** - Agent tylko do odczytu do analizy i eksploracji kodu
  - Domyślnie odmawia edycji plików
  - Pyta o zgodę przed uruchomieniem komend bash
  - Idealny do poznawania nieznanych baz kodu lub planowania zmian

Dodatkowo jest subagent **general** do złożonych wyszukiwań i wieloetapowych zadań.
Jest używany wewnętrznie i można go wywołać w wiadomościach przez `@general`.

Dowiedz się więcej o [agents](https://prioritech.co.id/docs/agents).

### Zbudowane na OpenCode

PrioriCode to fork [OpenCode](https://github.com/anomalyco/opencode), open source'owego agenta programistycznego z AI. Dziękujemy zespołowi OpenCode i jego współtwórcom za fundament, na którym opiera się ten projekt.

### PrioriCode w porównaniu z OpenCode

| Funkcja | OpenCode | PrioriCode |
| --- | :---: | :---: |
| Open source'owy agent programistyczny z AI (TUI + desktop) | ✓ | ✓ |
| Wiele dostawców LLM, wtyczki i MCP | ✓ | ✓ |
| Integracja z GitHub Actions | ✓ | ✓ |
| Dostosowywalna kompaktacja kontekstu | ✓ | ✓ |
| Koordynacja między sesjami (narzędzie `sessions`) | — | ✓ |

**Koordynacja między sesjami.** Równoległe sesje PrioriCode w tym samym projekcie mogą koordynować się przez wbudowane narzędzie `sessions`: odkrywanie sesji sióstr, zgłaszanie plików, aby uniknąć kolizji edycji, wysyłanie wiadomości i zadawanie pytań z ograniczonym czasem oczekiwania. Notatki są trwałe i dostarczane automatycznie — tło watcher budzi bezczynną sesję, aby przeczytała notatkę peer bez polling.

**Dostosowywalna kompaktacja kontekstu.** Kontroluj, jak obsługuje się pełne okno kontekstu, za pomocą konfiguracji `compaction`: zarezerwuj bufor tokenów, włącz lub wyłącz automatyczną kompaktację oraz dostosuj, ile ostatnich tur lub tokenów zachować dosłownie.

### Dokumentacja

Więcej informacji o konfiguracji PrioriCode znajdziesz w [**dokumentacji**](https://prioritech.co.id/docs).

### Współtworzenie

Jeśli chcesz współtworzyć PrioriCode, przeczytaj [contributing docs](./CONTRIBUTING.md) przed wysłaniem pull requesta.

### Budowanie na PrioriCode

Jeśli pracujesz nad projektem związanym z PrioriCode i używasz "prioricode" jako części nazwy (na przykład "prioricode-dashboard" lub "prioricode-mobile"), dodaj proszę notatkę do swojego README, aby wyjaśnić, że projekt nie jest tworzony przez zespół PrioriCode i nie jest z nami w żaden sposób powiązany.

---

