<p align="center">
  <a href="https://prioritech.co.id">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="PrioriCode logo">
    </picture>
  </a>
</p>
<p align="center">오픈 소스 AI 코딩 에이전트.</p>
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

### 설치

```bash
# YOLO
curl -fsSL https://prioritech.co.id/install | bash

# 패키지 매니저
npm i -g prioricode-ai@latest        # bun/pnpm/yarn 도 가능
scoop install prioricode             # Windows
choco install prioricode             # Windows
brew install anomalyco/tap/prioricode # macOS 및 Linux (권장, 항상 최신)
brew install prioricode              # macOS 및 Linux (공식 brew formula, 업데이트 빈도 낮음)
sudo pacman -S prioricode            # Arch Linux (Stable)
paru -S prioricode-bin               # Arch Linux (Latest from AUR)
mise use -g prioricode               # 어떤 OS든
nix run nixpkgs#prioricode           # 또는 github:Prioritech-Indonesia-Optima/prioricode 로 최신 dev 브랜치
```

> [!TIP]
> 설치 전에 0.1.x 보다 오래된 버전을 제거하세요.

### 데스크톱 앱 (BETA)

PrioriCode 는 데스크톱 앱으로도 제공됩니다. [releases page](https://github.com/Prioritech-Indonesia-Optima/prioricode/releases) 에서 직접 다운로드하거나 [prioritech.co.id/download](https://prioritech.co.id/download) 를 이용하세요.

| 플랫폼                | 다운로드                           |
| --------------------- | ---------------------------------- |
| macOS (Apple Silicon) | `prioricode-desktop-mac-arm64.dmg`   |
| macOS (Intel)         | `prioricode-desktop-mac-x64.dmg`     |
| Windows               | `prioricode-desktop-windows-x64.exe` |
| Linux                 | `.deb`, `.rpm`, 또는 AppImage      |

```bash
# macOS (Homebrew)
brew install --cask prioricode-desktop
# Windows (Scoop)
scoop bucket add extras; scoop install extras/prioricode-desktop
```

#### 설치 디렉터리

설치 스크립트는 설치 경로를 다음 우선순위로 결정합니다.

1. `$PRIORICODE_INSTALL_DIR` - 사용자 지정 설치 디렉터리
2. `$XDG_BIN_DIR` - XDG Base Directory Specification 준수 경로
3. `$HOME/bin` - 표준 사용자 바이너리 디렉터리 (존재하거나 생성 가능할 경우)
4. `$HOME/.prioricode/bin` - 기본 폴백

```bash
# 예시
PRIORICODE_INSTALL_DIR=/usr/local/bin curl -fsSL https://prioritech.co.id/install | bash
XDG_BIN_DIR=$HOME/.local/bin curl -fsSL https://prioritech.co.id/install | bash
```

### Agents

PrioriCode 에는 내장 에이전트 2개가 있으며 `Tab` 키로 전환할 수 있습니다.

- **build** - 기본값, 개발 작업을 위한 전체 권한 에이전트
- **plan** - 분석 및 코드 탐색을 위한 읽기 전용 에이전트
  - 기본적으로 파일 편집을 거부
  - bash 명령 실행 전에 권한을 요청
  - 낯선 코드베이스를 탐색하거나 변경을 계획할 때 적합

또한 복잡한 검색과 여러 단계 작업을 위한 **general** 서브 에이전트가 포함되어 있습니다.
내부적으로 사용되며, 메시지에서 `@general` 로 호출할 수 있습니다.

[agents](https://prioritech.co.id/docs/agents) 에 대해 더 알아보세요.

### OpenCode 기반

PrioriCode는 오픈소스 AI 코딩 에이전트인 [OpenCode](https://github.com/anomalyco/opencode)의 포크입니다. 이 프로젝트의 기반을 마련해 준 OpenCode 팀과 기여자들에게 감사드립니다.

### PrioriCode와 OpenCode 비교

| 기능 | OpenCode | PrioriCode |
| --- | :---: | :---: |
| 오픈소스 AI 코딩 에이전트 (TUI + 데스크톱) | ✓ | ✓ |
| 다중 LLM 프로바이더, 플러그인, MCP | ✓ | ✓ |
| GitHub Actions 통합 | ✓ | ✓ |
| 조정 가능한 컨텍스트 압축 | ✓ | ✓ |
| 세션 간 조정 (`sessions` 도구) | — | ✓ |

**세션 간 조정.** 같은 프로젝트에서 동시에 실행되는 여러 PrioriCode 세션은 내장 `sessions` 도구를 통해 조정할 수 있습니다: 형제 세션 발견, 파일 점유를 통한 편집 충돌 방지, 메시지 전송, 제한된 대기 시간의 질문. 노트는 영구적이며 자동으로 전달됩니다 — 백그라운드 워처가 유휴 세션을 깨워 폴링 없이 동료 세션의 노트를 읽게 합니다.

**조정 가능한 컨텍스트 압축.** `compaction` 설정으로 컨텍스트 윈도우가 가득 찼을 때의 처리를 제어합니다: 토큰 버퍼 예약, 자동 압축 사용/사용 안 함, 압축 후 그대로 유지할 최근 턴 또는 토큰 수 조정.

### 문서

PrioriCode 설정에 대한 자세한 내용은 [**문서**](https://prioritech.co.id/docs) 를 참고하세요.

### 기여하기

PrioriCode 에 기여하고 싶다면, Pull Request 를 제출하기 전에 [contributing docs](./CONTRIBUTING.md) 를 읽어주세요.

### PrioriCode 기반으로 만들기

PrioriCode 와 관련된 프로젝트를 진행하면서 이름에 "prioricode"(예: "prioricode-dashboard" 또는 "prioricode-mobile") 를 포함한다면, README 에 해당 프로젝트가 PrioriCode 팀이 만든 것이 아니며 어떤 방식으로도 우리와 제휴되어 있지 않다는 점을 명시해 주세요.

---

