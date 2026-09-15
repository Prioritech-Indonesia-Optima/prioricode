<p align="center">
  <a href="https://prioritech.co.id">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="PrioriCode logo">
    </picture>
  </a>
</p>
<p align="center">ওপেন সোর্স এআই কোডিং এজেন্ট।</p>
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

### ইনস্টলেশন (Installation)

```bash
# YOLO
curl -fsSL https://prioritech.co.id/install | bash

# Package managers
npm i -g prioricode-ai@latest        # or bun/pnpm/yarn
scoop install prioricode             # Windows
choco install prioricode             # Windows
brew install anomalyco/tap/prioricode # macOS and Linux (recommended, always up to date)
brew install prioricode              # macOS and Linux (official brew formula, updated less)
sudo pacman -S prioricode            # Arch Linux (Stable)
paru -S prioricode-bin               # Arch Linux (Latest from AUR)
mise use -g prioricode               # Any OS
nix run nixpkgs#prioricode           # or github:Prioritech-Indonesia-Optima/prioricode for latest dev branch
```

> [!TIP]
> ইনস্টল করার আগে ০.১.x এর চেয়ে পুরোনো ভার্সনগুলো মুছে ফেলুন।

### ডেস্কটপ অ্যাপ (BETA)

PrioriCode ডেস্কটপ অ্যাপ্লিকেশন হিসেবেও উপলব্ধ। সরাসরি [রিলিজ পেজ](https://github.com/Prioritech-Indonesia-Optima/prioricode/releases) অথবা [prioritech.co.id/download](https://prioritech.co.id/download) থেকে ডাউনলোড করুন।

| প্ল্যাটফর্ম           | ডাউনলোড                            |
| --------------------- | ---------------------------------- |
| macOS (Apple Silicon) | `prioricode-desktop-mac-arm64.dmg`   |
| macOS (Intel)         | `prioricode-desktop-mac-x64.dmg`     |
| Windows               | `prioricode-desktop-windows-x64.exe` |
| Linux                 | `.deb`, `.rpm`, or `.AppImage`     |

```bash
# macOS (Homebrew)
brew install --cask prioricode-desktop
# Windows (Scoop)
scoop bucket add extras; scoop install extras/prioricode-desktop
```

#### ইনস্টলেশন ডিরেক্টরি (Installation Directory)

ইনস্টল স্ক্রিপ্টটি ইনস্টলেশন পাতের জন্য নিম্নলিখিত অগ্রাধিকার ক্রম মেনে চলে:

1. `$PRIORICODE_INSTALL_DIR` - কাস্টম ইনস্টলেশন ডিরেক্টরি
2. `$XDG_BIN_DIR` - XDG বেস ডিরেক্টরি স্পেসিফিকেশন সমর্থিত পাথ
3. `$HOME/bin` - সাধারণ ব্যবহারকারী বাইনারি ডিরেক্টরি (যদি বিদ্যমান থাকে বা তৈরি করা যায়)
4. `$HOME/.prioricode/bin` - ডিফল্ট ফলব্যাক

```bash
# উদাহরণ
PRIORICODE_INSTALL_DIR=/usr/local/bin curl -fsSL https://prioritech.co.id/install | bash
XDG_BIN_DIR=$HOME/.local/bin curl -fsSL https://prioritech.co.id/install | bash
```

### এজেন্টস (Agents)

PrioriCode এ দুটি বিল্ট-ইন এজেন্ট রয়েছে যা আপনি `Tab` কি(key) দিয়ে পরিবর্তন করতে পারবেন।

- **build** - ডিফল্ট, ডেভেলপমেন্টের কাজের জন্য সম্পূর্ণ অ্যাক্সেসযুক্ত এজেন্ট
- **plan** - বিশ্লেষণ এবং কোড এক্সপ্লোরেশনের জন্য রিড-ওনলি এজেন্ট
  - ডিফল্টভাবে ফাইল এডিট করতে দেয় না
  - ব্যাশ কমান্ড চালানোর আগে অনুমতি চায়
  - অপরিচিত কোডবেস এক্সপ্লোর করা বা পরিবর্তনের পরিকল্পনা করার জন্য আদর্শ

এছাড়াও জটিল অনুসন্ধান এবং মাল্টিস্টেপ টাস্কের জন্য একটি **general** সাবএজেন্ট অন্তর্ভুক্ত রয়েছে।
এটি অভ্যন্তরীণভাবে ব্যবহৃত হয় এবং মেসেজে `@general` লিখে ব্যবহার করা যেতে পারে।

এজেন্টদের সম্পর্কে আরও জানুন: [docs](https://prioritech.co.id/docs/agents)।

### OpenCode এর উপর নির্মিত

PrioriCode হলো [OpenCode](https://github.com/anomalyco/opencode)-এর একটি ফর্ক, যা একটি ওপেন সোর্স AI কোডিং এজেন্ট। এই প্রজেক্টের ভিত্তি তৈরি করার জন্য আমরা OpenCode টিম এবং তাদের অবদানকারীদের ধন্যবাদ জানাই।

### OpenCode-এর সাথে PrioriCode-এর তুলনা

| ক্ষমতা | OpenCode | PrioriCode |
| --- | :---: | :---: |
| ওপেন সোর্স AI কোডিং এজেন্ট (TUI + ডেস্কটপ) | ✓ | ✓ |
| একাধিক LLM প্রোভাইডার, প্লাগইন এবং MCP | ✓ | ✓ |
| GitHub Actions ইন্টিগ্রেশন | ✓ | ✓ |
| সামঞ্জস্যযোগ্য কনটেক্সট কম্প্যাকশন | ✓ | ✓ |
| ক্রস-সেশন সমন্বয় (`sessions` টুল) | — | ✓ |

**ক্রস-সেশন সমন্বয়.** একই প্রজেক্টে একসাথে চলা একাধিক PrioriCode সেশন একটি বিল্ট-ইন `sessions` টুলের মাধ্যমে সমন্বয় করতে পারে: ভাই-বোন সেশন আবিষ্কার, সম্পাদনা সংঘাত এড়াতে ফাইল দাবি করা, বার্তা পাঠানো এবং সীমিত অপেক্ষার সাথে প্রশ্ন করা। নোটগুলো স্থায়ী এবং স্বয়ংক্রিয়ভাবে ডেলিভার করা হয় — একটি ব্যাকগ্রাউন্ড ওয়াচার একটি অবসরপ্রাপ্ত সেশনকে জাগিয়ে তোলে যাতে তা polling ছাড়াই একজন সহপাঠীর নোট পড়ে।

**সামঞ্জস্যযোগ্য কনটেক্সট কম্প্যাকশন.** `compaction` কনফিগারেশনের মাধ্যমে পূর্ণ কনটেক্সট উইন্ডো কীভাবে পরিচালনা করা হয় তা নিয়ন্ত্রণ করুন: একটি টোকেন বাফার সংরক্ষণ করুন, স্বয়ংক্রিয় কম্প্যাকশন চালু বা বন্ধ করুন, এবং কম্প্যাকশনের পরে কতগুলো সাম্প্রতিক টার্ন বা টোকেন হুবহু সংরক্ষণ করা হবে তা সামঞ্জস্য করুন।

### ডকুমেন্টেশন (Documentation)

কিভাবে PrioriCode কনফিগার করবেন সে সম্পর্কে আরও তথ্যের জন্য, [**আমাদের ডকস দেখুন**](https://prioritech.co.id/docs)।

### অবদান (Contributing)

আপনি যদি PrioriCode এ অবদান রাখতে চান, অনুগ্রহ করে একটি পুল রিকোয়েস্ট সাবমিট করার আগে আমাদের [কন্ট্রিবিউটিং ডকস](./CONTRIBUTING.md) পড়ে নিন।

### PrioriCode এর উপর বিল্ডিং (Building on PrioriCode)

আপনি যদি এমন প্রজেক্টে কাজ করেন যা PrioriCode এর সাথে সম্পর্কিত এবং প্রজেক্টের নামের অংশ হিসেবে "prioricode" ব্যবহার করেন, উদাহরণস্বরূপ "prioricode-dashboard" বা "prioricode-mobile", তবে দয়া করে আপনার README তে একটি নোট যোগ করে স্পষ্ট করুন যে এই প্রজেক্টটি PrioriCode দল দ্বারা তৈরি হয়নি এবং আমাদের সাথে এর কোনো সরাসরি সম্পর্ক নেই।

---

