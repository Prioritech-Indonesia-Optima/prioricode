<p align="center">
  <a href="https://prioritech.co.id">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="شعار PrioriCode">
    </picture>
  </a>
</p>
<p align="center">وكيل برمجة بالذكاء الاصطناعي مفتوح المصدر.</p>
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

### التثبيت

```bash
# YOLO
curl -fsSL https://prioritech.co.id/install | bash

# مديري الحزم
npm i -g prioricode-ai@latest        # او bun/pnpm/yarn
scoop install prioricode             # Windows
choco install prioricode             # Windows
brew install anomalyco/tap/prioricode # macOS و Linux (موصى به، دائما محدث)
brew install prioricode              # macOS و Linux (صيغة brew الرسمية، تحديث اقل)
sudo pacman -S prioricode            # Arch Linux (Stable)
paru -S prioricode-bin               # Arch Linux (Latest from AUR)
mise use -g prioricode               # اي نظام
nix run nixpkgs#prioricode           # او github:Prioritech-Indonesia-Optima/prioricode لاحدث فرع dev
```

> [!TIP]
> احذف الاصدارات الاقدم من 0.1.x قبل التثبيت.

### تطبيق سطح المكتب (BETA)

يتوفر PrioriCode ايضا كتطبيق سطح مكتب. قم بالتنزيل مباشرة من [صفحة الاصدارات](https://github.com/Prioritech-Indonesia-Optima/prioricode/releases) او من [prioritech.co.id/download](https://prioritech.co.id/download).

| المنصة                | التنزيل                            |
| --------------------- | ---------------------------------- |
| macOS (Apple Silicon) | `prioricode-desktop-mac-arm64.dmg`   |
| macOS (Intel)         | `prioricode-desktop-mac-x64.dmg`     |
| Windows               | `prioricode-desktop-windows-x64.exe` |
| Linux                 | `.deb` او `.rpm` او AppImage       |

```bash
# macOS (Homebrew)
brew install --cask prioricode-desktop
# Windows (Scoop)
scoop bucket add extras; scoop install extras/prioricode-desktop
```

#### مجلد التثبيت

يحترم سكربت التثبيت ترتيب الاولوية التالي لمسار التثبيت:

1. `$PRIORICODE_INSTALL_DIR` - مجلد تثبيت مخصص
2. `$XDG_BIN_DIR` - مسار متوافق مع مواصفات XDG Base Directory
3. `$HOME/bin` - مجلد الثنائيات القياسي للمستخدم (ان وجد او امكن انشاؤه)
4. `$HOME/.prioricode/bin` - المسار الافتراضي الاحتياطي

```bash
# امثلة
PRIORICODE_INSTALL_DIR=/usr/local/bin curl -fsSL https://prioritech.co.id/install | bash
XDG_BIN_DIR=$HOME/.local/bin curl -fsSL https://prioritech.co.id/install | bash
```

### Agents

يتضمن PrioriCode وكيليْن (Agents) مدمجين يمكنك التبديل بينهما باستخدام زر `Tab`.

- **build** - الافتراضي، وكيل بصلاحيات كاملة لاعمال التطوير
- **plan** - وكيل للقراءة فقط للتحليل واستكشاف الكود
  - يرفض تعديل الملفات افتراضيا
  - يطلب الاذن قبل تشغيل اوامر bash
  - مثالي لاستكشاف قواعد كود غير مألوفة او لتخطيط التغييرات

بالاضافة الى ذلك يوجد وكيل فرعي **general** للبحث المعقد والمهام متعددة الخطوات.
يستخدم داخليا ويمكن استدعاؤه بكتابة `@general` في الرسائل.

تعرف على المزيد حول [agents](https://prioritech.co.id/docs/agents).

### مبني على OpenCode

PrioriCode هو فرع من [OpenCode](https://github.com/anomalyco/opencode)، وكيل البرمجة بالذكاء الاصطناعي مفتوح المصدر. نشكر فريق OpenCode ومساهميه على الأساس الذي يُبنى عليه هذا المشروع.

### كيف يقارن PrioriCode مع OpenCode

| القدرة | OpenCode | PrioriCode |
| --- | :---: | :---: |
| وكيل برمجة بالذكاء الاصطناعي مفتوح المصدر (TUI + سطح المكتب) | ✓ | ✓ |
| مزودو LLM متعددون، وإضافات، وMCP | ✓ | ✓ |
| تكامل GitHub Actions | ✓ | ✓ |
| ضغط سياق قابل للضبط | ✓ | ✓ |
| تنسيق بين الجلسات (أداة `sessions`) | — | ✓ |

**التنسيق بين الجلسات.** يمكن لجلسات PrioriCode المتزامنة في نفس المشروع التنسيق عبر أداة `sessions` مدمجة: اكتشاف الجلسات الشقيقة، واحتكار الملفات لتجنب تعارضات التحرير، وإرسال الرسائل، وطرح أسئلة مع انتظار محدود. الملاحظات دائمة وتُسلَّم تلقائيًا — يستيقظ مراقب في الخلفية الجلسة الخاملة لتقرأ ملاحظة نظيرها دون استطلاع.

**ضغط سياق قابل للضبط.** تحكّم في معالجة نافذة السياق الممتلئة عبر إعداد `compaction`: حجز مخزن مؤقت للرموز، وتفعيل أو تعطيل الضغط التلقائي، وضبط عدد الأدوار أو الرموز الأخيرة التي تُحفظ كما هي.

### التوثيق

لمزيد من المعلومات حول كيفية ضبط PrioriCode، [**راجع التوثيق**](https://prioritech.co.id/docs).

### المساهمة

اذا كنت مهتما بالمساهمة في PrioriCode، يرجى قراءة [contributing docs](./CONTRIBUTING.md) قبل ارسال pull request.

### البناء فوق PrioriCode

اذا كنت تعمل على مشروع مرتبط بـ PrioriCode ويستخدم "prioricode" كجزء من اسمه (مثل "prioricode-dashboard" او "prioricode-mobile")، يرجى اضافة ملاحظة في README توضح انه ليس مبنيا بواسطة فريق PrioriCode ولا يرتبط بنا بأي شكل.

---

