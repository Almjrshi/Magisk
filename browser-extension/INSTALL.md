# SnapShield - تعليمات التثبيت

## الاستخدام الشخصي فقط

---

## 1. تثبيت jsPDF (لتصدير PDF)

```bash
# تنزيل مباشر (الأسهل)
curl -L "https://github.com/parallax/jsPDF/releases/download/v2.5.1/jspdf.umd.min.js" \
     -o browser-extension/libs/jspdf.umd.min.js

# أو عبر npm
npm install jspdf
cp node_modules/jspdf/dist/jspdf.umd.min.js browser-extension/libs/
```

> بدون jsPDF: PNG و JPEG يعملان بشكل كامل. PDF فقط يحتاج المكتبة.

---

## 2. تحميل الإضافة في Chrome / Brave / Edge

1. افتح: `chrome://extensions`
2. فعّل **وضع المطور** (Developer Mode) من الزاوية اليمنى العليا
3. اضغط **تحميل غير مضغوط** (Load unpacked)
4. اختر مجلد: `browser-extension/`
5. ستظهر الإضافة في شريط الأدوات 🛡️

---

## 3. تحميل الإضافة في Firefox

1. افتح: `about:debugging`
2. اضغط **This Firefox**
3. اضغط **Load Temporary Add-on...**
4. اختر ملف: `browser-extension/manifest.json`

> **ملاحظة Firefox:** صلاحية `debugger` مدعومة بشكل مختلف. بعض الميزات قد تحتاج تعديلاً.

---

## 4. الاختصارات

| الاختصار | الوظيفة |
|---------|---------|
| `Alt+Shift+F` | صفحة كاملة |
| `Alt+Shift+V` | منطقة مرئية |
| `Alt+Shift+X` | تحديد منطقة |

**في المحرر:**

| الاختصار | الوظيفة |
|---------|---------|
| `Ctrl+Z` | تراجع |
| `Ctrl+Y` | إعادة |
| `Ctrl+S` | تصدير |
| `Ctrl+C` | نسخ للحافظة |
| `V` | أداة التحديد |
| `C` | القص |
| `D` | رسم حر |
| `A` | سهم |
| `R` | مستطيل |
| `T` | نص |
| `B` | تمويه |

---

## 5. هيكل الملفات

```
browser-extension/
├── manifest.json           ← إعدادات الإضافة (MV3)
├── background/
│   └── service-worker.js   ← المعالج الرئيسي + CDP
├── content/
│   └── content-script.js   ← إزالة حماية CSS + تحديد المنطقة
├── popup/
│   ├── popup.html          ← واجهة الإضافة
│   ├── popup.css           ← التصميم
│   └── popup.js            ← المنطق
├── editor/
│   ├── editor.html         ← صفحة المحرر
│   ├── editor.css          ← تصميم المحرر
│   └── editor.js           ← رسم + تصدير + تعليقات
├── libs/
│   └── jspdf.umd.min.js    ← مكتبة PDF (انظر الخطوة 1)
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

---

## 6. الأمان

- **صفر اتصال بالإنترنت** — CSP يمنع `connect-src 'none'`
- **معالجة محلية 100%** — لا يُرسَل شيء لأي خادم
- **تشفير التخزين** — السجل محفوظ في `chrome.storage.local`
- **إخفاء البيانات الحساسة** — يعمل محلياً قبل الالتقاط
