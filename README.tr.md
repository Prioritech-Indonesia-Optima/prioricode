<p align="center">
  <a href="https://prioritech.co.id">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="PrioriCode logo">
    </picture>
  </a>
</p>
<p align="center">Açık kaynaklı yapay zeka kodlama asistanı.</p>
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

### Kurulum

```bash
# YOLO
curl -fsSL https://prioritech.co.id/install | bash

# Paket yöneticileri
npm i -g prioricode-ai@latest        # veya bun/pnpm/yarn
scoop install prioricode             # Windows
choco install prioricode             # Windows
brew install anomalyco/tap/prioricode # macOS ve Linux (önerilir, her zaman güncel)
brew install prioricode              # macOS ve Linux (resmi brew formülü, daha az güncellenir)
sudo pacman -S prioricode            # Arch Linux (Stable)
paru -S prioricode-bin               # Arch Linux (Latest from AUR)
mise use -g prioricode               # Tüm işletim sistemleri
nix run nixpkgs#prioricode           # veya en güncel geliştirme dalı için github:Prioritech-Indonesia-Optima/prioricode
```

> [!TIP]
> Kurulumdan önce 0.1.x'ten eski sürümleri kaldırın.

### Masaüstü Uygulaması (BETA)

PrioriCode ayrıca masaüstü uygulaması olarak da mevcuttur. Doğrudan [sürüm sayfasından](https://github.com/Prioritech-Indonesia-Optima/prioricode/releases) veya [prioritech.co.id/download](https://prioritech.co.id/download) adresinden indirebilirsiniz.

| Platform              | İndirme                            |
| --------------------- | ---------------------------------- |
| macOS (Apple Silicon) | `prioricode-desktop-mac-arm64.dmg`   |
| macOS (Intel)         | `prioricode-desktop-mac-x64.dmg`     |
| Windows               | `prioricode-desktop-windows-x64.exe` |
| Linux                 | `.deb`, `.rpm` veya AppImage       |

```bash
# macOS (Homebrew)
brew install --cask prioricode-desktop
# Windows (Scoop)
scoop bucket add extras; scoop install extras/prioricode-desktop
```

#### Kurulum Dizini (Installation Directory)

Kurulum betiği (install script), kurulum yolu (installation path) için aşağıdaki öncelik sırasını takip eder:

1. `$PRIORICODE_INSTALL_DIR` - Özel kurulum dizini
2. `$XDG_BIN_DIR` - XDG Base Directory Specification uyumlu yol
3. `$HOME/bin` - Standart kullanıcı binary dizini (varsa veya oluşturulabiliyorsa)
4. `$HOME/.prioricode/bin` - Varsayılan yedek konum

```bash
# Örnekler
PRIORICODE_INSTALL_DIR=/usr/local/bin curl -fsSL https://prioritech.co.id/install | bash
XDG_BIN_DIR=$HOME/.local/bin curl -fsSL https://prioritech.co.id/install | bash
```

### Ajanlar

PrioriCode, `Tab` tuşuyla aralarında geçiş yapabileceğiniz iki yerleşik (built-in) ajan içerir.

- **build** - Varsayılan, geliştirme çalışmaları için tam erişimli ajan
- **plan** - Analiz ve kod keşfi için salt okunur ajan
  - Varsayılan olarak dosya düzenlemelerini reddeder
  - Bash komutlarını çalıştırmadan önce izin ister
  - Tanımadığınız kod tabanlarını keşfetmek veya değişiklikleri planlamak için ideal

Ayrıca, karmaşık aramalar ve çok adımlı görevler için bir **genel** alt ajan bulunmaktadır.
Bu dahili olarak kullanılır ve mesajlarda `@general` ile çağrılabilir.

[Ajanlar](https://prioritech.co.id/docs/agents) hakkında daha fazla bilgi edinin.

### OpenCode Üzerine Kuruldu

PrioriCode, açık kaynak yapay zekâ kodlama ajanı [OpenCode](https://github.com/anomalyco/opencode) tabanlı bir fork'tur. Bu projenin temeli olan OpenCode ekibine ve katkıda bulunanlara teşekkür ederiz.

### PrioriCode'un OpenCode ile Karşılaştırması

| Özellik | OpenCode | PrioriCode |
| --- | :---: | :---: |
| Açık kaynak yapay zekâ kodlama ajanı (TUI + masaüstü) | ✓ | ✓ |
| Birden fazla LLM sağlayıcısı, eklentiler ve MCP | ✓ | ✓ |
| GitHub Actions entegrasyonu | ✓ | ✓ |
| Ayarlanabilir bağlam sıkıştırma | ✓ | ✓ |
| Oturumlar arası koordinasyon (`sessions` aracı) | — | ✓ |

**Oturumlar arası koordinasyon.** Aynı projede eşzamanlı çalışan birden çok PrioriCode oturumu, yerleşik `sessions` aracıyla koordine olabilir: kardeş oturumları keşfetme, düzenleme çakışmalarını önlemek için dosyaları talep etme, mesaj gönderme ve sınırlı beklemeyle soru sorma. Notlar kalıcıdır ve otomatik olarak teslim edilir — arka plan izleyicisi, bir oturumu uyandırır ki bir akranın notunu polling olmadan okusun.

**Ayarlanabilir bağlam sıkıştırma.** Dolu bir bağlam penceresinin nasıl işlendiğini `compaction` yapılandırmasıyla kontrol edin: token tamponu ayırın, otomatik sıkıştırmayı etkinleştirin veya devre dışı bırakın ve sıkıştırma sonrası kelimesi kelimesine korunacak son turların veya token sayısını ayarlayın.

### Dokümantasyon

PrioriCode'u nasıl yapılandıracağınız hakkında daha fazla bilgi için [**dokümantasyonumuza göz atın**](https://prioritech.co.id/docs).

### Katkıda Bulunma

PrioriCode'a katkıda bulunmak istiyorsanız, lütfen bir pull request göndermeden önce [katkıda bulunma dokümanlarımızı](./CONTRIBUTING.md) okuyun.

### PrioriCode Üzerine Geliştirme

PrioriCode ile ilgili bir proje üzerinde çalışıyorsanız ve projenizin adının bir parçası olarak "prioricode" kullanıyorsanız (örneğin, "prioricode-dashboard" veya "prioricode-mobile"), lütfen README dosyanıza projenin PrioriCode ekibi tarafından geliştirilmediğini ve bizimle hiçbir şekilde bağlantılı olmadığını belirten bir not ekleyin.

---

