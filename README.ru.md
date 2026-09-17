<p align="center">
  <a href="https://prioritech.co.id">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="PrioriCode logo">
    </picture>
  </a>
</p>
<p align="center">Открытый AI-агент для программирования.</p>
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

### Установка

```bash
# YOLO
curl -fsSL https://prioritech.co.id/install | bash

# Менеджеры пакетов
npm i -g prioricode-ai@latest        # или bun/pnpm/yarn
scoop install prioricode             # Windows
choco install prioricode             # Windows
brew install anomalyco/tap/prioricode # macOS и Linux (рекомендуем, всегда актуально)
brew install prioricode              # macOS и Linux (официальная формула brew, обновляется реже)
sudo pacman -S prioricode            # Arch Linux (Stable)
paru -S prioricode-bin               # Arch Linux (Latest from AUR)
mise use -g prioricode               # любая ОС
nix run nixpkgs#prioricode           # или github:Prioritech-Indonesia-Optima/prioricode для самой свежей ветки dev
```

> [!TIP]
> Перед установкой удалите версии старше 0.1.x.

### Десктопное приложение (BETA)

PrioriCode также доступен как десктопное приложение. Скачайте его со [страницы релизов](https://github.com/Prioritech-Indonesia-Optima/prioricode/releases) или с [prioritech.co.id/download](https://prioritech.co.id/download).

| Платформа             | Загрузка                           |
| --------------------- | ---------------------------------- |
| macOS (Apple Silicon) | `prioricode-desktop-mac-arm64.dmg`   |
| macOS (Intel)         | `prioricode-desktop-mac-x64.dmg`     |
| Windows               | `prioricode-desktop-windows-x64.exe` |
| Linux                 | `.deb`, `.rpm` или AppImage        |

```bash
# macOS (Homebrew)
brew install --cask prioricode-desktop
# Windows (Scoop)
scoop bucket add extras; scoop install extras/prioricode-desktop
```

#### Каталог установки

Скрипт установки выбирает путь установки в следующем порядке приоритета:

1. `$PRIORICODE_INSTALL_DIR` - Пользовательский каталог установки
2. `$XDG_BIN_DIR` - Путь, совместимый со спецификацией XDG Base Directory
3. `$HOME/bin` - Стандартный каталог пользовательских бинарников (если существует или можно создать)
4. `$HOME/.prioricode/bin` - Fallback по умолчанию

```bash
# Примеры
curl -fsSL https://prioritech.co.id/install | PRIORICODE_INSTALL_DIR=/usr/local/bin bash
curl -fsSL https://prioritech.co.id/install | XDG_BIN_DIR=$HOME/.local/bin bash
```

### Agents

В PrioriCode есть два встроенных агента, между которыми можно переключаться клавишей `Tab`.

- **build** - По умолчанию, агент с полным доступом для разработки
- **plan** - Агент только для чтения для анализа и изучения кода
  - По умолчанию запрещает редактирование файлов
  - Запрашивает разрешение перед выполнением bash-команд
  - Идеален для изучения незнакомых кодовых баз или планирования изменений

Также включен сабагент **general** для сложных поисков и многошаговых задач.
Он используется внутренне и может быть вызван в сообщениях через `@general`.

Подробнее об [agents](https://prioritech.co.id/docs/agents).

### Построено на OpenCode

PrioriCode — это форк [OpenCode](https://github.com/anomalyco/opencode), открытого AI-агента для программирования. Благодарим команду OpenCode и её вкладчиков за фундамент, на котором построен этот проект.

### Сравнение PrioriCode и OpenCode

| Возможность | OpenCode | PrioriCode |
| --- | :---: | :---: |
| Открытый AI-агент для программирования (TUI + desktop) | ✓ | ✓ |
| Множество LLM-провайдеров, плагины и MCP | ✓ | ✓ |
| Интеграция с GitHub Actions | ✓ | ✓ |
| Настраиваемая компакция контекста | ✓ | ✓ |
| Межсессионная координация (инструмент `sessions`) | — | ✓ |

**Межсессионная координация.** Одновременные сессии PrioriCode в одном проекте могут координироваться через встроенный инструмент `sessions`: обнаружение сестринских сессий, резервирование файлов для избежания конфликтов редактирования, отправка сообщений и вопросы с ограниченным ожиданием. Заметки долговечны и доставляются автоматически — фоновый наблюдатель будит бездействующую сессию, чтобы она прочитала заметку сверстника без опроса.

**Настраиваемая компакция контекста.** Управляйте обработкой заполненного окна контекста с помощью конфигурации `compaction`: резервируйте буфер токенов, включайте или отключайте автоматическую компакцию и настраивайте, сколько последних ходов или токенов сохраняется дословно.

### Документация

Больше информации о том, как настроить PrioriCode: [**наши docs**](https://prioritech.co.id/docs).

### Вклад

Если вы хотите внести вклад в PrioriCode, прочитайте [contributing docs](./CONTRIBUTING.md) перед тем, как отправлять pull request.

### Разработка на базе PrioriCode

Если вы делаете проект, связанный с PrioriCode, и используете "prioricode" как часть имени (например, "prioricode-dashboard" или "prioricode-mobile"), добавьте примечание в README, чтобы уточнить, что проект не создан командой PrioriCode и не аффилирован с нами.

---

