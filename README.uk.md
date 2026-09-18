<p align="center">
  <a href="https://prioritech.co.id">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="PrioriCode logo">
    </picture>
  </a>
</p>
<p align="center">AI-агент для програмування з відкритим кодом.</p>
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

### Встановлення

```bash
# YOLO
curl -fsSL https://prioritech.co.id/install | bash

# Менеджери пакетів
npm i -g prioricode-ai@latest        # або bun/pnpm/yarn
scoop install prioricode             # Windows
choco install prioricode             # Windows
brew install anomalyco/tap/prioricode # macOS і Linux (рекомендовано, завжди актуально)
brew install prioricode              # macOS і Linux (офіційна формула Homebrew, оновлюється рідше)
sudo pacman -S prioricode            # Arch Linux (Stable)
paru -S prioricode-bin               # Arch Linux (Latest from AUR)
mise use -g prioricode               # Будь-яка ОС
nix run nixpkgs#prioricode           # або github:Prioritech-Indonesia-Optima/prioricode для найновішої dev-гілки
```

> [!TIP]
> Перед встановленням видаліть версії старші за 0.1.x.

### Десктопний застосунок (BETA)

PrioriCode також доступний як десктопний застосунок. Завантажуйте напряму зі [сторінки релізів](https://github.com/Prioritech-Indonesia-Optima/prioricode/releases) або [prioritech.co.id/download](https://prioritech.co.id/download).

| Платформа             | Завантаження                         |
| --------------------- | ------------------------------------ |
| macOS (Apple Silicon) | `prioricode-desktop-mac-arm64.dmg`   |
| macOS (Intel)         | `prioricode-desktop-mac-x64.dmg`     |
| Windows               | `prioricode-desktop-windows-x64.exe` |
| Linux                 | `.deb`, `.rpm` або AppImage          |

```bash
# macOS (Homebrew)
brew install --cask prioricode-desktop
# Windows (Scoop)
scoop bucket add extras; scoop install extras/prioricode-desktop
```

#### Каталог встановлення

Скрипт встановлення дотримується такого порядку пріоритету для шляху встановлення:

1. `$PRIORICODE_INSTALL_DIR` - Користувацький каталог встановлення
2. `$XDG_BIN_DIR` - Шлях, сумісний зі специфікацією XDG Base Directory
3. `$HOME/bin` - Стандартний каталог користувацьких бінарників (якщо існує або його можна створити)
4. `$HOME/.prioricode/bin` - Резервний варіант за замовчуванням

```bash
# Приклади
curl -fsSL https://prioritech.co.id/install | PRIORICODE_INSTALL_DIR=/usr/local/bin bash
curl -fsSL https://prioritech.co.id/install | XDG_BIN_DIR=$HOME/.local/bin bash
```

### Агенти

PrioriCode містить два вбудовані агенти, між якими можна перемикатися клавішею `Tab`.

- **build** - Агент за замовчуванням із повним доступом для завдань розробки
- **plan** - Агент лише для читання для аналізу та дослідження коду
  - За замовчуванням забороняє редагування файлів
  - Запитує дозвіл перед запуском bash-команд
  - Ідеально підходить для дослідження незнайомих кодових баз або планування змін

Також доступний допоміжний агент **general** для складного пошуку та багатокрокових завдань.
Він використовується всередині системи й може бути викликаний у повідомленнях через `@general`.

Дізнайтеся більше про [agents](https://prioritech.co.id/docs/agents).

### Побудовано на OpenCode

PrioriCode — це форк [OpenCode](https://github.com/anomalyco/opencode), відкритого AI-агента для програмування. Дякуємо команді OpenCode та її учасникам за фундамент, на якому ґрунтується цей проєкт.

### Порівняння PrioriCode з OpenCode

| Можливість                                           | OpenCode | PrioriCode |
| ---------------------------------------------------- | :------: | :--------: |
| Відкритий AI-агент для програмування (TUI + desktop) |    ✓     |     ✓      |
| Багато LLM-провайдерів, плагіни та MCP               |    ✓     |     ✓      |
| Інтеграція з GitHub Actions                          |    ✓     |     ✓      |
| Налаштовуване стискання контексту                    |    ✓     |     ✓      |
| Міжсесійна координація (інструмент `sessions`)       |    —     |     ✓      |

**Міжсесійна координація.** Одночасні сесії PrioriCode в одному проєкті можуть координуватися через вбудований інструмент `sessions`: виявлення сестринських сесій, резервування файлів для уникнення конфліктів редагування, відправка повідомлень і запитання з обмеженим очікуванням. Нотатки є стійкими та доставляються автоматично — фоновий спостерігач пробуджує бездіяльну сесію, щоб вона прочитала нотатку однолітка без опитування.

**Налаштовуване стискання контексту.** Керуйте обробкою заповненого вікна контексту за допомогою конфігурації `compaction`: резервуйте буфер токенів, увімкніть або вимкніть автоматичне стискання та налаштуйте, скільки останніх ходів або токенів зберігається дослівно.

### Документація

Щоб дізнатися більше про налаштування PrioriCode, [**перейдіть до нашої документації**](https://prioritech.co.id/docs).

### Внесок

Якщо ви хочете зробити внесок в PrioriCode, будь ласка, прочитайте нашу [документацію для контриб'юторів](./CONTRIBUTING.md) перед надсиланням pull request.

### Проєкти на базі PrioriCode

Якщо ви працюєте над проєктом, пов'язаним з PrioriCode, і використовуєте "prioricode" у назві, наприклад "prioricode-dashboard" або "prioricode-mobile", додайте примітку до свого README.
Уточніть, що цей проєкт не створений командою PrioriCode і жодним чином не афілійований із нами.

---
