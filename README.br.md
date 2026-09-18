<p align="center">
  <a href="https://prioritech.co.id">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="Logo do PrioriCode">
    </picture>
  </a>
</p>
<p align="center">O agente de programação com IA de código aberto.</p>
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

### Instalação

```bash
# YOLO
curl -fsSL https://prioritech.co.id/install | bash

# Gerenciadores de pacotes
npm i -g prioricode-ai@latest        # ou bun/pnpm/yarn
scoop install prioricode             # Windows
choco install prioricode             # Windows
brew install anomalyco/tap/prioricode # macOS e Linux (recomendado, sempre atualizado)
brew install prioricode              # macOS e Linux (fórmula oficial do brew, atualiza menos)
sudo pacman -S prioricode            # Arch Linux (Stable)
paru -S prioricode-bin               # Arch Linux (Latest from AUR)
mise use -g prioricode               # qualquer sistema
nix run nixpkgs#prioricode           # ou github:Prioritech-Indonesia-Optima/prioricode para a branch dev mais recente
```

> [!TIP]
> Remova versões anteriores a 0.1.x antes de instalar.

### App desktop (BETA)

O PrioriCode também está disponível como aplicativo desktop. Baixe diretamente pela [página de releases](https://github.com/Prioritech-Indonesia-Optima/prioricode/releases) ou em [prioritech.co.id/download](https://prioritech.co.id/download).

| Plataforma            | Download                             |
| --------------------- | ------------------------------------ |
| macOS (Apple Silicon) | `prioricode-desktop-mac-arm64.dmg`   |
| macOS (Intel)         | `prioricode-desktop-mac-x64.dmg`     |
| Windows               | `prioricode-desktop-windows-x64.exe` |
| Linux                 | `.deb`, `.rpm` ou AppImage           |

```bash
# macOS (Homebrew)
brew install --cask prioricode-desktop
# Windows (Scoop)
scoop bucket add extras; scoop install extras/prioricode-desktop
```

#### Diretório de instalação

O script de instalação respeita a seguinte ordem de prioridade para o caminho de instalação:

1. `$PRIORICODE_INSTALL_DIR` - Diretório de instalação personalizado
2. `$XDG_BIN_DIR` - Caminho compatível com a especificação XDG Base Directory
3. `$HOME/bin` - Diretório binário padrão do usuário (se existir ou puder ser criado)
4. `$HOME/.prioricode/bin` - Fallback padrão

```bash
# Exemplos
curl -fsSL https://prioritech.co.id/install | PRIORICODE_INSTALL_DIR=/usr/local/bin bash
curl -fsSL https://prioritech.co.id/install | XDG_BIN_DIR=$HOME/.local/bin bash
```

### Agents

O PrioriCode inclui dois agents integrados, que você pode alternar com a tecla `Tab`.

- **build** - Padrão, agent com acesso total para trabalho de desenvolvimento
- **plan** - Agent somente leitura para análise e exploração de código
  - Nega edições de arquivos por padrão
  - Pede permissão antes de executar comandos bash
  - Ideal para explorar codebases desconhecidas ou planejar mudanças

Também há um subagent **general** para buscas complexas e tarefas em várias etapas.
Ele é usado internamente e pode ser invocado com `@general` nas mensagens.

Saiba mais sobre [agents](https://prioritech.co.id/docs/agents).

### Baseado no OpenCode

O PrioriCode é um fork do [OpenCode](https://github.com/anomalyco/opencode), o agente de programação com IA de código aberto. Agradecemos à equipe do OpenCode e aos seus contribuidores pela base sobre a qual este projeto é construído.

### Como o PrioriCode se compara ao OpenCode

| Capacidade                                                    | OpenCode | PrioriCode |
| ------------------------------------------------------------- | :------: | :--------: |
| Agente de programação com IA de código aberto (TUI + desktop) |    ✓     |     ✓      |
| Múltiplos provedores de LLM, plugins e MCP                    |    ✓     |     ✓      |
| Integração com GitHub Actions                                 |    ✓     |     ✓      |
| Compactação de contexto ajustável                             |    ✓     |     ✓      |
| Coordenação entre sessões (ferramenta `sessions`)             |    —     |     ✓      |

**Coordenação entre sessões.** Sessões do PrioriCode concorrentes no mesmo projeto podem se coordenar por meio de uma ferramenta `sessions` integrada: descobrir sessões irmãs, reivindicar arquivos para evitar colisões de edição, enviar mensagens e fazer perguntas com espera limitada. As notas são duráveis e entregues automaticamente — um observador em segundo plano acorda uma sessão ociosa para que ela leia a nota de um par sem polling.

**Compactação de contexto ajustável.** Controle como uma janela de contexto cheia é tratada com a configuração `compaction`: reservar um buffer de tokens, ativar ou desativar a compactação automática e ajustar quantas rodadas ou tokens recentes são preservados literalmente.

### Documentação

Para mais informações sobre como configurar o PrioriCode, [**veja nossa documentação**](https://prioritech.co.id/docs).

### Contribuir

Se você tem interesse em contribuir com o PrioriCode, leia os [contributing docs](./CONTRIBUTING.md) antes de enviar um pull request.

### Construindo com PrioriCode

Se você estiver trabalhando em um projeto relacionado ao PrioriCode e estiver usando "prioricode" como parte do nome (por exemplo, "prioricode-dashboard" ou "prioricode-mobile"), adicione uma nota no README para deixar claro que não foi construído pela equipe do PrioriCode e não é afiliado a nós de nenhuma forma.

---
