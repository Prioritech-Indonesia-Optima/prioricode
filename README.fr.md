<p align="center">
  <a href="https://prioritech.co.id">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="Logo PrioriCode">
    </picture>
  </a>
</p>
<p align="center">L'agent de codage IA open source.</p>
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

# Gestionnaires de paquets
npm i -g prioricode-ai@latest        # ou bun/pnpm/yarn
scoop install prioricode             # Windows
choco install prioricode             # Windows
brew install anomalyco/tap/prioricode # macOS et Linux (recommandé, toujours à jour)
brew install prioricode              # macOS et Linux (formule officielle brew, mise à jour moins fréquente)
sudo pacman -S prioricode            # Arch Linux (Stable)
paru -S prioricode-bin               # Arch Linux (Latest from AUR)
mise use -g prioricode               # n'importe quel OS
nix run nixpkgs#prioricode           # ou github:Prioritech-Indonesia-Optima/prioricode pour la branche dev la plus récente
```

> [!TIP]
> Supprimez les versions antérieures à 0.1.x avant d'installer.

### Application de bureau (BETA)

PrioriCode est aussi disponible en application de bureau. Téléchargez-la directement depuis la [page des releases](https://github.com/Prioritech-Indonesia-Optima/prioricode/releases) ou [prioritech.co.id/download](https://prioritech.co.id/download).

| Plateforme            | Téléchargement                     |
| --------------------- | ---------------------------------- |
| macOS (Apple Silicon) | `prioricode-desktop-mac-arm64.dmg`   |
| macOS (Intel)         | `prioricode-desktop-mac-x64.dmg`     |
| Windows               | `prioricode-desktop-windows-x64.exe` |
| Linux                 | `.deb`, `.rpm`, ou AppImage        |

```bash
# macOS (Homebrew)
brew install --cask prioricode-desktop
# Windows (Scoop)
scoop bucket add extras; scoop install extras/prioricode-desktop
```

#### Répertoire d'installation

Le script d'installation respecte l'ordre de priorité suivant pour le chemin d'installation :

1. `$PRIORICODE_INSTALL_DIR` - Répertoire d'installation personnalisé
2. `$XDG_BIN_DIR` - Chemin conforme à la spécification XDG Base Directory
3. `$HOME/bin` - Répertoire binaire utilisateur standard (s'il existe ou peut être créé)
4. `$HOME/.prioricode/bin` - Repli par défaut

```bash
# Exemples
PRIORICODE_INSTALL_DIR=/usr/local/bin curl -fsSL https://prioritech.co.id/install | bash
XDG_BIN_DIR=$HOME/.local/bin curl -fsSL https://prioritech.co.id/install | bash
```

### Agents

PrioriCode inclut deux agents intégrés que vous pouvez basculer avec la touche `Tab`.

- **build** - Par défaut, agent avec accès complet pour le travail de développement
- **plan** - Agent en lecture seule pour l'analyse et l'exploration du code
  - Refuse les modifications de fichiers par défaut
  - Demande l'autorisation avant d'exécuter des commandes bash
  - Idéal pour explorer une base de code inconnue ou planifier des changements

Un sous-agent **general** est aussi inclus pour les recherches complexes et les tâches en plusieurs étapes.
Il est utilisé en interne et peut être invoqué via `@general` dans les messages.

En savoir plus sur les [agents](https://prioritech.co.id/docs/agents).

### Basé sur OpenCode

PrioriCode est un fork de [OpenCode](https://github.com/anomalyco/opencode), l'agent de codage IA open source. Nous remercions l'équipe OpenCode et ses contributeurs pour les fondations sur lesquelles ce projet s'appuie.

### Comparaison entre PrioriCode et OpenCode

| Fonctionnalité | OpenCode | PrioriCode |
| --- | :---: | :---: |
| Agent de codage IA open source (TUI + bureau) | ✓ | ✓ |
| Multiples fournisseurs de LLM, plugins et MCP | ✓ | ✓ |
| Intégration GitHub Actions | ✓ | ✓ |
| Compaction de contexte ajustable | ✓ | ✓ |
| Coordination inter-sessions (outil `sessions`) | — | ✓ |

**Coordination inter-sessions.** Les sessions PrioriCode concurrentes sur le même projet peuvent se coordonner via un outil `sessions` intégré : découvrir les sessions sœurs, réserver des fichiers pour éviter les collisions d'édition, envoyer des messages et poser des questions avec une attente bornée. Les notes sont durables et livrées automatiquement — un observateur en arrière-plan réveille une session inactive afin qu'elle lise la note d'un pair sans sonde.

**Compaction de contexte ajustable.** Contrôlez le traitement d'une fenêtre de contexte pleine via la configuration `compaction` : réserver un tampon de jetons, activer ou désactiver la compaction automatique et ajuster le nombre de tours ou de jetons récents conservés à l'identique.

### Documentation

Pour plus d'informations sur la configuration d'PrioriCode, [**consultez notre documentation**](https://prioritech.co.id/docs).

### Contribuer

Si vous souhaitez contribuer à PrioriCode, lisez nos [docs de contribution](./CONTRIBUTING.md) avant de soumettre une pull request.

### Construire avec PrioriCode

Si vous travaillez sur un projet lié à PrioriCode et que vous utilisez "prioricode" dans le nom du projet (par exemple, "prioricode-dashboard" ou "prioricode-mobile"), ajoutez une note dans votre README pour préciser qu'il n'est pas construit par l'équipe PrioriCode et qu'il n'est pas affilié à nous.

---

