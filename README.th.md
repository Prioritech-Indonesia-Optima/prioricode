<p align="center">
  <a href="https://prioritech.co.id">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="PrioriCode logo">
    </picture>
  </a>
</p>
<p align="center">เอเจนต์การเขียนโค้ดด้วย AI แบบโอเพนซอร์ส</p>
<p align="center">
  <a href="https://www.npmjs.com/package/prioricode-ai"><img alt="npm" src="https://img.shields.io/npm/v/prioricode-ai?style=flat-square" /></a>
  <a href="https://github.com/Prioritech-Indonesia-Optima/prioricode/actions/workflows/publish.yml"><img alt="สถานะการสร้าง" src="https://img.shields.io/github/actions/workflow/status/Prioritech-Indonesia-Optima/prioricode/publish.yml?style=flat-square&branch=dev" /></a>
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

### การติดตั้ง

```bash
# YOLO
curl -fsSL https://prioritech.co.id/install | bash

# ตัวจัดการแพ็กเกจ
npm i -g prioricode-ai@latest        # หรือ bun/pnpm/yarn
scoop install prioricode             # Windows
choco install prioricode             # Windows
brew install anomalyco/tap/prioricode # macOS และ Linux (แนะนำ อัปเดตเสมอ)
brew install prioricode              # macOS และ Linux (brew formula อย่างเป็นทางการ อัปเดตน้อยกว่า)
sudo pacman -S prioricode            # Arch Linux (Stable)
paru -S prioricode-bin               # Arch Linux (Latest from AUR)
mise use -g prioricode               # ระบบปฏิบัติการใดก็ได้
nix run nixpkgs#prioricode           # หรือ github:Prioritech-Indonesia-Optima/prioricode สำหรับสาขาพัฒนาล่าสุด
```

> [!TIP]
> ลบเวอร์ชันที่เก่ากว่า 0.1.x ก่อนติดตั้ง

### แอปพลิเคชันเดสก์ท็อป (เบต้า)

PrioriCode มีให้ใช้งานเป็นแอปพลิเคชันเดสก์ท็อป ดาวน์โหลดโดยตรงจาก [หน้ารุ่น](https://github.com/Prioritech-Indonesia-Optima/prioricode/releases) หรือ [prioritech.co.id/download](https://prioritech.co.id/download)

| แพลตฟอร์ม             | ดาวน์โหลด                          |
| --------------------- | ---------------------------------- |
| macOS (Apple Silicon) | `prioricode-desktop-mac-arm64.dmg`   |
| macOS (Intel)         | `prioricode-desktop-mac-x64.dmg`     |
| Windows               | `prioricode-desktop-windows-x64.exe` |
| Linux                 | `.deb`, `.rpm`, หรือ AppImage      |

```bash
# macOS (Homebrew)
brew install --cask prioricode-desktop
# Windows (Scoop)
scoop bucket add extras; scoop install extras/prioricode-desktop
```

#### ไดเรกทอรีการติดตั้ง

สคริปต์การติดตั้งจะใช้ลำดับความสำคัญตามเส้นทางการติดตั้ง:

1. `$PRIORICODE_INSTALL_DIR` - ไดเรกทอรีการติดตั้งที่กำหนดเอง
2. `$XDG_BIN_DIR` - เส้นทางที่สอดคล้องกับ XDG Base Directory Specification
3. `$HOME/bin` - ไดเรกทอรีไบนารีผู้ใช้มาตรฐาน (หากมีอยู่หรือสามารถสร้างได้)
4. `$HOME/.prioricode/bin` - ค่าสำรองเริ่มต้น

```bash
# ตัวอย่าง
curl -fsSL https://prioritech.co.id/install | PRIORICODE_INSTALL_DIR=/usr/local/bin bash
curl -fsSL https://prioritech.co.id/install | XDG_BIN_DIR=$HOME/.local/bin bash
```

### เอเจนต์

PrioriCode รวมเอเจนต์ในตัวสองตัวที่คุณสามารถสลับได้ด้วยปุ่ม `Tab`

- **build** - เอเจนต์เริ่มต้น มีสิทธิ์เข้าถึงแบบเต็มสำหรับงานพัฒนา
- **plan** - เอเจนต์อ่านอย่างเดียวสำหรับการวิเคราะห์และการสำรวจโค้ด
  - ปฏิเสธการแก้ไขไฟล์โดยค่าเริ่มต้น
  - ขอสิทธิ์ก่อนเรียกใช้คำสั่ง bash
  - เหมาะสำหรับสำรวจโค้ดเบสที่ไม่คุ้นเคยหรือวางแผนการเปลี่ยนแปลง

นอกจากนี้ยังมีเอเจนต์ย่อย **general** สำหรับการค้นหาที่ซับซ้อนและงานหลายขั้นตอน
ใช้ภายในและสามารถเรียกใช้ได้โดยใช้ `@general` ในข้อความ

เรียนรู้เพิ่มเติมเกี่ยวกับ [เอเจนต์](https://prioritech.co.id/docs/agents)

### สร้างบน OpenCode

PrioriCode เป็น fork ของ [OpenCode](https://github.com/anomalyco/opencode) ซึ่งเป็น AI coding agent แบบ open source เราขอขอบคุณทีม OpenCode และผู้มีส่วนร่วมเป็นพื้นฐานที่โปรเจกต์นี้สร้างขึ้น

### เปรียบเทียบ PrioriCode กับ OpenCode

| ความสามารถ | OpenCode | PrioriCode |
| --- | :---: | :---: |
| AI coding agent แบบ open source (TUI + desktop) | ✓ | ✓ |
| LLM providers หลายเจ้า, plugins และ MCP | ✓ | ✓ |
| การบูรณาการ GitHub Actions | ✓ | ✓ |
| การย่อ context ที่ปรับได้ | ✓ | ✓ |
| การประสานงานข้าม session (เครื่องมือ `sessions`) | — | ✓ |

**การประสานงานข้าม session.** PrioriCode sessions ที่ทำงานพร้อมกันในโปรเจกต์เดียวกันสามารถประสานงานผ่านเครื่องมือ `sessions` ที่ฝังอยู่: ค้นพบ session พี่น้อง, อ้างสิทธิ์ไฟล์เพื่อเลี่ยงการชนกันของแก้ไข, ส่งข้อความ, และตั้งคำถามด้วยการรอที่จำกัด บันทึกนั้นถาวรและจัดส่งอัตโนมัติ — watcher ในพื้นหลังจะปลุก session ที่ว่างเพื่อให้อ่านบันทึกจากเพื่อนร่วมโดยไม่ต้อง poll

**การย่อ context ที่ปรับได้.** ควบคุมวิธีจัดการเมื่อ context window เต็มผ่านค่า `compaction`: สำรอง buffer ของ token, เปิดหรือปิดการย่ออัตโนมัติ, และปรับจำนวนรอบหรือ token ล่าสุดที่จะเก็บไว้ตามตัวอักษร

### เอกสารประกอบ

สำหรับข้อมูลเพิ่มเติมเกี่ยวกับวิธีกำหนดค่า PrioriCode [**ไปที่เอกสารของเรา**](https://prioritech.co.id/docs)

### การมีส่วนร่วม

หากคุณสนใจที่จะมีส่วนร่วมใน PrioriCode โปรดอ่าน [เอกสารการมีส่วนร่วม](./CONTRIBUTING.md) ก่อนส่ง Pull Request

### การสร้างบน PrioriCode

หากคุณทำงานในโปรเจกต์ที่เกี่ยวข้องกับ PrioriCode และใช้ "prioricode" เป็นส่วนหนึ่งของชื่อ เช่น "prioricode-dashboard" หรือ "prioricode-mobile" โปรดเพิ่มหมายเหตุใน README ของคุณเพื่อชี้แจงว่าไม่ได้สร้างโดยทีม PrioriCode และไม่ได้เกี่ยวข้องกับเราในทางใด

---

