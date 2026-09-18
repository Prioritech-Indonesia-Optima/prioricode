<p align="center">
  <a href="https://prioritech.co.id">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="PrioriCode logo">
    </picture>
  </a>
</p>
<p align="center">El agente de programación con IA de código abierto.</p>
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

### Instalación

```bash
# YOLO
curl -fsSL https://prioritech.co.id/install | bash

# Gestores de paquetes
npm i -g prioricode-ai@latest        # o bun/pnpm/yarn
scoop install prioricode             # Windows
choco install prioricode             # Windows
brew install anomalyco/tap/prioricode # macOS y Linux (recomendado, siempre al día)
brew install prioricode              # macOS y Linux (fórmula oficial de brew, se actualiza menos)
sudo pacman -S prioricode            # Arch Linux (Stable)
paru -S prioricode-bin               # Arch Linux (Latest from AUR)
mise use -g prioricode               # cualquier sistema
nix run nixpkgs#prioricode           # o github:Prioritech-Indonesia-Optima/prioricode para la rama dev más reciente
```

> [!TIP]
> Elimina versiones anteriores a 0.1.x antes de instalar.

### App de escritorio (BETA)

PrioriCode también está disponible como aplicación de escritorio. Descárgala directamente desde la [página de releases](https://github.com/Prioritech-Indonesia-Optima/prioricode/releases) o desde [prioritech.co.id/download](https://prioritech.co.id/download).

| Plataforma            | Descarga                             |
| --------------------- | ------------------------------------ |
| macOS (Apple Silicon) | `prioricode-desktop-mac-arm64.dmg`   |
| macOS (Intel)         | `prioricode-desktop-mac-x64.dmg`     |
| Windows               | `prioricode-desktop-windows-x64.exe` |
| Linux                 | `.deb`, `.rpm`, o AppImage           |

```bash
# macOS (Homebrew)
brew install --cask prioricode-desktop
# Windows (Scoop)
scoop bucket add extras; scoop install extras/prioricode-desktop
```

#### Directorio de instalación

El script de instalación respeta el siguiente orden de prioridad para la ruta de instalación:

1. `$PRIORICODE_INSTALL_DIR` - Directorio de instalación personalizado
2. `$XDG_BIN_DIR` - Ruta compatible con la especificación XDG Base Directory
3. `$HOME/bin` - Directorio binario estándar del usuario (si existe o se puede crear)
4. `$HOME/.prioricode/bin` - Alternativa por defecto

```bash
# Ejemplos
curl -fsSL https://prioritech.co.id/install | PRIORICODE_INSTALL_DIR=/usr/local/bin bash
curl -fsSL https://prioritech.co.id/install | XDG_BIN_DIR=$HOME/.local/bin bash
```

### Agentes

PrioriCode incluye dos agentes integrados que puedes alternar con la tecla `Tab`.

- **build** - Por defecto, agente con acceso completo para tareas de desarrollo
- **plan** - Agente de solo lectura para análisis y exploración de código
  - Deniega ediciones de archivos por defecto
  - Pide permiso antes de ejecutar comandos bash
  - Ideal para explorar codebases desconocidas o planificar cambios

Además, incluye un subagente **general** para búsquedas complejas y tareas de varios pasos.
Se usa internamente y se puede invocar con `@general` en los mensajes.

Más información sobre [agentes](https://prioritech.co.id/docs/agents).

### Basado en OpenCode

PrioriCode es un fork de [OpenCode](https://github.com/anomalyco/opencode), el agente de programación con IA de código abierto. Agradecemos al equipo de OpenCode y a sus contribuyentes por el fundamento sobre el que se construye este proyecto.

### Cómo se compara PrioriCode con OpenCode

| Capacidad                                                          | OpenCode | PrioriCode |
| ------------------------------------------------------------------ | :------: | :--------: |
| Agente de programación con IA de código abierto (TUI + escritorio) |    ✓     |     ✓      |
| Múltiples proveedores de LLM, plugins y MCP                        |    ✓     |     ✓      |
| Integración con GitHub Actions                                     |    ✓     |     ✓      |
| Compactación de contexto ajustable                                 |    ✓     |     ✓      |
| Coordinación entre sesiones (herramienta `sessions`)               |    —     |     ✓      |

**Coordinación entre sesiones.** Las sesiones de PrioriCode concurrentes en el mismo proyecto pueden coordinarse mediante una herramienta `sessions` integrada: descubrir sesiones hermanas, reclamar archivos para evitar colisiones de edición, enviar mensajes y hacer preguntas con espera acotada. Las notas son duraderas y se entregan automáticamente: un observador en segundo plano despierta a una sesión inactiva para que lea la nota de un par sin hacer polling.

**Compactación de contexto ajustable.** Controla cómo se maneja una ventana de contexto llena con la configuración `compaction`: reservar un búfer de tokens, activar o desactivar la compactación automática y ajustar cuántos turnos o tokens recientes se conservan tal cual.

### Documentación

Para más información sobre cómo configurar PrioriCode, [**ve a nuestra documentación**](https://prioritech.co.id/docs).

### Contribuir

Si te interesa contribuir a PrioriCode, lee nuestras [docs de contribución](./CONTRIBUTING.md) antes de enviar un pull request.

### Proyectos basados en PrioriCode

Si estás trabajando en un proyecto basado en PrioriCode y usas "prioricode" como parte del nombre, por ejemplo, "prioricode-dashboard" u "prioricode-mobile", agrega una nota en tu README para aclarar que no está hecho por el equipo de PrioriCode y que no está afiliado con nosotros de ninguna manera.

---
