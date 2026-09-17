<p align="center">
  <a href="https://prioritech.co.id">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="PrioriCode logo">
    </picture>
  </a>
</p>
<p align="center">Trợ lý lập trình AI mã nguồn mở.</p>
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

### Cài đặt

```bash
# YOLO
curl -fsSL https://prioritech.co.id/install | bash

# Các trình quản lý gói (Package managers)
npm i -g prioricode-ai@latest        # hoặc bun/pnpm/yarn
scoop install prioricode             # Windows
choco install prioricode             # Windows
brew install anomalyco/tap/prioricode # macOS và Linux (khuyên dùng, luôn cập nhật)
brew install prioricode              # macOS và Linux (công thức brew chính thức, ít cập nhật hơn)
sudo pacman -S prioricode            # Arch Linux (Bản ổn định)
paru -S prioricode-bin               # Arch Linux (Bản mới nhất từ AUR)
mise use -g prioricode               # Mọi hệ điều hành
nix run nixpkgs#prioricode           # hoặc github:Prioritech-Indonesia-Optima/prioricode cho nhánh dev mới nhất
```

> [!TIP]
> Hãy xóa các phiên bản cũ hơn 0.1.x trước khi cài đặt.

### Ứng dụng Desktop (BETA)

PrioriCode cũng có sẵn dưới dạng ứng dụng desktop. Tải trực tiếp từ [trang releases](https://github.com/Prioritech-Indonesia-Optima/prioricode/releases) hoặc [prioritech.co.id/download](https://prioritech.co.id/download).

| Nền tảng              | Tải xuống                          |
| --------------------- | ---------------------------------- |
| macOS (Apple Silicon) | `prioricode-desktop-mac-arm64.dmg`   |
| macOS (Intel)         | `prioricode-desktop-mac-x64.dmg`     |
| Windows               | `prioricode-desktop-windows-x64.exe` |
| Linux                 | `.deb`, `.rpm`, hoặc AppImage      |

```bash
# macOS (Homebrew)
brew install --cask prioricode-desktop
# Windows (Scoop)
scoop bucket add extras; scoop install extras/prioricode-desktop
```

#### Thư mục cài đặt

Tập lệnh cài đặt tuân theo thứ tự ưu tiên sau cho đường dẫn cài đặt:

1. `$PRIORICODE_INSTALL_DIR` - Thư mục cài đặt tùy chỉnh
2. `$XDG_BIN_DIR` - Đường dẫn tuân thủ XDG Base Directory Specification
3. `$HOME/bin` - Thư mục nhị phân tiêu chuẩn của người dùng (nếu tồn tại hoặc có thể tạo)
4. `$HOME/.prioricode/bin` - Mặc định dự phòng

```bash
# Ví dụ
curl -fsSL https://prioritech.co.id/install | PRIORICODE_INSTALL_DIR=/usr/local/bin bash
curl -fsSL https://prioritech.co.id/install | XDG_BIN_DIR=$HOME/.local/bin bash
```

### Agents (Đại diện)

PrioriCode bao gồm hai agent được tích hợp sẵn mà bạn có thể chuyển đổi bằng phím `Tab`.

- **build** - Agent mặc định, có toàn quyền truy cập cho công việc lập trình
- **plan** - Agent chỉ đọc dùng để phân tích và khám phá mã nguồn
  - Mặc định từ chối việc chỉnh sửa tệp
  - Hỏi quyền trước khi chạy các lệnh bash
  - Lý tưởng để khám phá các codebase lạ hoặc lên kế hoạch thay đổi

Ngoài ra còn có một subagent **general** dùng cho các tìm kiếm phức tạp và tác vụ nhiều bước.
Agent này được sử dụng nội bộ và có thể gọi bằng cách dùng `@general` trong tin nhắn.

Tìm hiểu thêm về [agents](https://prioritech.co.id/docs/agents).

### Xây dựng trên OpenCode

PrioriCode là một fork của [OpenCode](https://github.com/anomalyco/opencode), tác nhân lập trình AI mã nguồn mở. Chúng tôi cảm ơn đội ngũ OpenCode và các đóng góp viên vì nền tảng mà dự án này xây dựng trên đó.

### So sánh PrioriCode với OpenCode

| Tính năng | OpenCode | PrioriCode |
| --- | :---: | :---: |
| Tác nhân lập trình AI mã nguồn mở (TUI + desktop) | ✓ | ✓ |
| Nhiều nhà cung cấp LLM, plugin và MCP | ✓ | ✓ |
| Tích hợp GitHub Actions | ✓ | ✓ |
| Nén ngữ cảnh có thể điều chỉnh | ✓ | ✓ |
| Phối hợp giữa các phiên (công cụ `sessions`) | — | ✓ |

**Phối hợp giữa các phiên.** Các phiên PrioriCode chạy đồng thời trên cùng một dự án có thể phối hợp thông qua công cụ `sessions` tích hợp: khám phá các phiên anh chị em, yêu cầu các tệp để tránh xung đột chỉnh sửa, gửi tin nhắn và đặt câu hỏi với thời gian chờ có giới hạn. Ghi chú là bền vững và được chuyển tự động — một watcher nền đánh thức một phiên nhàn rỗi để nó đọc ghi chú của một phiên khác mà không cần poll.

**Nén ngữ cảnh có thể điều chỉnh.** Kiểm soát cách xử lý một cửa sổ ngữ cảnh đầy bằng cấu hình `compaction`: dự phòng một buffer token, bật hoặc tắt nén tự động và điều chỉnh số lượt hoặc token gần đây được giữ nguyên văn.

### Tài liệu

Để biết thêm thông tin về cách cấu hình PrioriCode, [**hãy truy cập tài liệu của chúng tôi**](https://prioritech.co.id/docs).

### Đóng góp

Nếu bạn muốn đóng góp cho PrioriCode, vui lòng đọc [tài liệu hướng dẫn đóng góp](./CONTRIBUTING.md) trước khi gửi pull request.

### Xây dựng trên nền tảng PrioriCode

Nếu bạn đang làm việc trên một dự án liên quan đến PrioriCode và sử dụng "prioricode" như một phần của tên dự án, ví dụ "prioricode-dashboard" hoặc "prioricode-mobile", vui lòng thêm một ghi chú vào README của bạn để làm rõ rằng dự án đó không được xây dựng bởi đội ngũ PrioriCode và không liên kết với chúng tôi dưới bất kỳ hình thức nào.

---

