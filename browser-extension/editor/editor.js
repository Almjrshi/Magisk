// SnapShield - Editor Controller
'use strict';

// ========== الحالة ==========
const state = {
  tool:       'select',
  color:      '#ff3b30',
  brushSize:  3,
  drawing:    false,
  startX:     0,
  startY:     0,
  history:    [],  // stack of ImageData for undo
  future:     [],  // stack for redo
  imageData:  null,
  meta:       {},
  zoom:       1,
  pendingText: null, // موقع النص المعلق
  cropRect:   null,
};

// ========== Canvas Setup ==========
const canvasBase   = document.getElementById('canvas-base');
const canvasDraw   = document.getElementById('canvas-draw');
const canvasEvents = document.getElementById('canvas-events');
const ctxBase      = canvasBase.getContext('2d');
const ctxDraw      = canvasDraw.getContext('2d', { willReadFrequently: true });
const ctxEvt       = canvasEvents.getContext('2d');

// ========== تهيئة ==========
document.addEventListener('DOMContentLoaded', async () => {
  await loadImage();
  bindEvents();
});

async function loadImage() {
  const params   = new URLSearchParams(location.search);
  const tempId   = params.get('id');
  const histId   = params.get('historyId');

  let capture = null;

  if (tempId) {
    const stored = await chrome.storage.local.get(tempId);
    capture = stored[tempId];
    // حذف المؤقت بعد القراءة
    chrome.storage.local.remove(tempId);
  } else if (histId) {
    const stored = await chrome.storage.local.get('screenshot_history');
    const history = stored.screenshot_history || [];
    capture = history.find(h => h.id === histId);
  }

  if (!capture?.data) {
    setStatus('❌ فشل تحميل الصورة');
    return;
  }

  // البيانات الوصفية تُقرأ من كائن meta المخزون (بعد الإصلاح الجديد)
  const storedMeta = capture.meta || {};
  state.meta = {
    url:       storedMeta.url      || capture.url   || '',
    title:     storedMeta.title    || capture.title || 'لقطة شاشة',
    timestamp: capture.timestamp   || Date.now(),
    format:    storedMeta.format   || 'png',
    quality:   storedMeta.quality  || 0.95,
    template:  storedMeta.template || 'snapshield_%date_%time',
  };

  state.imageData = capture.data;

  // رسم الصورة على الـ canvas
  const img = new Image();
  img.onerror = () => {
    setStatus('❌ فشل تحميل الصورة: بيانات تالفة أو تنسيق غير مدعوم');
  };
  img.onload = () => {
    const W = img.naturalWidth;
    const H = img.naturalHeight;

    [canvasBase, canvasDraw, canvasEvents].forEach(c => {
      c.width  = W;
      c.height = H;
    });

    ctxBase.drawImage(img, 0, 0);

    // تحديث معلومات القص
    document.getElementById('crop-w').value = W;
    document.getElementById('crop-h').value = H;

    updateMeta(W, H);
    saveToUndoStack();
    setStatus('✅ تم تحميل اللقطة');
  };
  img.src = capture.data;

  // إعداد التنسيق
  const fmtSelect = document.getElementById('export-format');
  if (fmtSelect) fmtSelect.value = state.meta.format;
}

function updateMeta(w, h) {
  const m = state.meta;
  document.getElementById('page-title').textContent = m.title;
  document.getElementById('info-url').textContent   = m.url || '—';
  document.getElementById('info-date').textContent  = (() => {
    try { return new Date(m.timestamp).toLocaleString('ar-SA'); }
    catch (_) { return new Date(m.timestamp).toLocaleString('en-US'); }
  })();
  document.getElementById('info-size').textContent  = `${w} × ${h} px`;
}

// ========== ربط الأحداث ==========
function bindEvents() {
  // أدوات
  document.querySelectorAll('.tool-btn[data-tool]').forEach(btn => {
    btn.addEventListener('click', () => selectTool(btn.dataset.tool));
  });

  // اللون — تعيين المعاينة الأولية عبر JS (لتجنب inline style في HTML)
  const colorInput   = document.getElementById('tool-color');
  const colorPreview = document.getElementById('color-preview');
  colorPreview.style.background = state.color; // تطبيق القيمة الأولية
  colorInput.addEventListener('input', () => {
    state.color = colorInput.value;
    colorPreview.style.background = state.color;
  });

  // حجم الفرشاة
  const brushSlider = document.getElementById('brush-size');
  brushSlider.addEventListener('input', () => {
    state.brushSize = parseInt(brushSlider.value);
    document.getElementById('brush-size-val').textContent = state.brushSize + 'px';
  });

  // Undo / Redo
  document.getElementById('btn-undo').addEventListener('click', undo);
  document.getElementById('btn-redo').addEventListener('click', redo);

  // تصدير
  document.getElementById('btn-export').addEventListener('click', exportImage);
  document.getElementById('btn-copy').addEventListener('click', copyToClipboard);
  document.getElementById('btn-save-history').addEventListener('click', saveToHistory);

  // قص
  document.getElementById('btn-apply-crop').addEventListener('click', applyCrop);
  document.getElementById('btn-cancel-crop').addEventListener('click', cancelCrop);

  // نص
  document.getElementById('btn-add-text').addEventListener('click', confirmText);
  document.getElementById('btn-cancel-text').addEventListener('click', cancelText);
  document.getElementById('text-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') confirmText();
    if (e.key === 'Escape') cancelText();
  });

  // أحداث الرسم على Canvas
  canvasEvents.addEventListener('mousedown',  onMouseDown);
  canvasEvents.addEventListener('mousemove',  onMouseMove);
  canvasEvents.addEventListener('mouseup',    onMouseUp);
  canvasEvents.addEventListener('mouseleave', onMouseLeave);

  // اختصارات لوحة المفاتيح
  document.addEventListener('keydown', onKeyDown);
}

// ========== اختيار الأداة ==========
function selectTool(tool) {
  state.tool = tool;
  document.querySelectorAll('.tool-btn[data-tool]').forEach(b => {
    b.classList.toggle('active', b.dataset.tool === tool);
  });

  // إظهار/إخفاء لوحة القص
  const cropPanel = document.getElementById('crop-panel');
  if (tool === 'crop') {
    cropPanel.classList.remove('hidden');
  } else {
    cropPanel.classList.add('hidden');
  }

  // تحديث المؤشر
  const cursors = {
    select: 'default', crop: 'crosshair',
    draw: 'crosshair', arrow: 'crosshair',
    rect: 'crosshair', text: 'text', blur: 'crosshair',
  };
  canvasEvents.style.cursor = cursors[tool] || 'crosshair';
}

// ========== أحداث الرسم ==========
function getCanvasPos(e) {
  const rect  = canvasEvents.getBoundingClientRect();
  const scaleX = canvasBase.width  / rect.width;
  const scaleY = canvasBase.height / rect.height;
  return {
    x: (e.clientX - rect.left)  * scaleX,
    y: (e.clientY - rect.top)   * scaleY
  };
}

function onMouseDown(e) {
  const { x, y } = getCanvasPos(e);
  state.drawing = true;
  state.startX  = x;
  state.startY  = y;

  if (state.tool === 'draw') {
    ctxDraw.beginPath();
    ctxDraw.moveTo(x, y);
  }

  if (state.tool === 'text') {
    state.pendingText = { x, y };
    showTextInput(x, y);
  }
}

function onMouseMove(e) {
  const { x, y } = getCanvasPos(e);

  // تحديث الإحداثيات
  document.getElementById('status-coords').textContent = `${Math.round(x)}, ${Math.round(y)}`;

  if (!state.drawing) return;

  if (state.tool === 'draw') {
    ctxDraw.lineTo(x, y);
    ctxDraw.strokeStyle = state.color;
    ctxDraw.lineWidth   = state.brushSize;
    ctxDraw.lineCap     = 'round';
    ctxDraw.lineJoin    = 'round';
    ctxDraw.stroke();
  }

  if (['arrow', 'rect', 'blur', 'crop'].includes(state.tool)) {
    // رسم preview مؤقت
    ctxEvt.clearRect(0, 0, canvasEvents.width, canvasEvents.height);
    drawPreview(ctxEvt, state.startX, state.startY, x, y);
  }
}

function onMouseUp(e) {
  if (!state.drawing) return;
  state.drawing = false;

  const { x, y } = getCanvasPos(e);
  ctxEvt.clearRect(0, 0, canvasEvents.width, canvasEvents.height);

  switch (state.tool) {
    case 'draw':
      saveToUndoStack();
      break;
    case 'arrow':
      drawArrow(ctxDraw, state.startX, state.startY, x, y);
      saveToUndoStack();
      break;
    case 'rect':
      drawRect(ctxDraw, state.startX, state.startY, x, y);
      saveToUndoStack();
      break;
    case 'blur':
      applyBlur(state.startX, state.startY, x, y);
      saveToUndoStack();
      break;
    case 'crop':
      state.cropRect = normalizeRect(state.startX, state.startY, x, y);
      document.getElementById('crop-x').value = Math.round(state.cropRect.x);
      document.getElementById('crop-y').value = Math.round(state.cropRect.y);
      document.getElementById('crop-w').value = Math.round(state.cropRect.w);
      document.getElementById('crop-h').value = Math.round(state.cropRect.h);
      break;
  }
}

function onMouseLeave() {
  if (state.drawing && state.tool === 'draw') {
    saveToUndoStack();
  }
  state.drawing = false;
  ctxEvt.clearRect(0, 0, canvasEvents.width, canvasEvents.height);
}

// ========== رسم العناصر ==========
function drawPreview(ctx, x1, y1, x2, y2) {
  ctx.save();
  ctx.strokeStyle = state.color;
  ctx.lineWidth   = state.brushSize;
  ctx.setLineDash([5, 3]);

  if (state.tool === 'arrow') {
    // السهم: رسم خط
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  } else if (state.tool === 'rect' || state.tool === 'blur' || state.tool === 'crop') {
    // مستطيل لأدوات rect وblur وcrop
    const { x, y, w, h } = normalizeRect(x1, y1, x2, y2);
    ctx.strokeRect(x, y, w, h);
    if (state.tool === 'blur') {
      ctx.fillStyle = 'rgba(0,0,0,0.2)';
      ctx.fillRect(x, y, w, h);
    }
    if (state.tool === 'crop') {
      // تظليل مناطق الحذف
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(0, 0, canvasEvents.width, y);
      ctx.fillRect(0, y + h, canvasEvents.width, canvasEvents.height);
      ctx.fillRect(0, y, x, h);
      ctx.fillRect(x + w, y, canvasEvents.width, h);
    }
  }
  ctx.restore();
}

function drawArrow(ctx, x1, y1, x2, y2) {
  const headLen = Math.max(12, state.brushSize * 4);
  const angle   = Math.atan2(y2 - y1, x2 - x1);

  ctx.save();
  ctx.strokeStyle = state.color;
  ctx.fillStyle   = state.color;
  ctx.lineWidth   = state.brushSize;
  ctx.lineCap     = 'round';

  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();

  // رأس السهم
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(
    x2 - headLen * Math.cos(angle - Math.PI / 6),
    y2 - headLen * Math.sin(angle - Math.PI / 6)
  );
  ctx.lineTo(
    x2 - headLen * Math.cos(angle + Math.PI / 6),
    y2 - headLen * Math.sin(angle + Math.PI / 6)
  );
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawRect(ctx, x1, y1, x2, y2) {
  const { x, y, w, h } = normalizeRect(x1, y1, x2, y2);
  ctx.save();
  ctx.strokeStyle = state.color;
  ctx.lineWidth   = state.brushSize;
  ctx.strokeRect(x, y, w, h);
  ctx.restore();
}

function applyBlur(x1, y1, x2, y2) {
  const { x, y, w, h } = normalizeRect(x1, y1, x2, y2);
  if (w < 2 || h < 2) return;

  // قراءة البكسلات من الصورة المدمجة (base + draw)
  const merged    = getMergedCanvas();
  const mCtx      = merged.getContext('2d');
  const imageData = mCtx.getImageData(x, y, w, h);
  const data      = imageData.data;

  // تمويه Box Blur (5 مرات)
  for (let pass = 0; pass < 5; pass++) {
    boxBlurPass(data, w, h);
  }

  // نضع النتيجة على canvasBase ونمسح canvasDraw لتجنب التضاعف البصري
  ctxBase.putImageData(imageData, x, y);
  ctxDraw.clearRect(x, y, w, h);
}

function boxBlurPass(data, w, h) {
  const radius = 4;
  const tmp    = new Uint8ClampedArray(data.length);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0, a = 0, count = 0;
      for (let ky = -radius; ky <= radius; ky++) {
        for (let kx = -radius; kx <= radius; kx++) {
          const nx = x + kx, ny = y + ky;
          if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
            const idx = (ny * w + nx) * 4;
            r += data[idx]; g += data[idx+1]; b += data[idx+2]; a += data[idx+3];
            count++;
          }
        }
      }
      const i = (y * w + x) * 4;
      tmp[i]   = r / count;
      tmp[i+1] = g / count;
      tmp[i+2] = b / count;
      tmp[i+3] = a / count;  // إصلاح: تمويه alpha أيضاً
    }
  }
  data.set(tmp);
}

// ========== النص ==========
function showTextInput(x, y) {
  const overlay = document.getElementById('text-input-overlay');
  overlay.classList.remove('hidden');
  document.getElementById('text-input').value = '';
  document.getElementById('text-input').focus();
}

function confirmText() {
  const text    = document.getElementById('text-input').value.trim();
  const overlay = document.getElementById('text-input-overlay');
  overlay.classList.add('hidden');
  state.drawing = false;

  if (!text || !state.pendingText) return;

  const { x, y } = state.pendingText;
  const fontSize = Math.max(14, state.brushSize * 4);

  ctxDraw.save();
  ctxDraw.font         = `bold ${fontSize}px 'Segoe UI', system-ui, sans-serif`;
  ctxDraw.fillStyle    = state.color;
  ctxDraw.strokeStyle  = 'rgba(0,0,0,0.6)';
  ctxDraw.lineWidth    = 2;
  ctxDraw.strokeText(text, x, y);
  ctxDraw.fillText(text, x, y);
  ctxDraw.restore();

  state.pendingText = null;
  saveToUndoStack();
}

function cancelText() {
  document.getElementById('text-input-overlay').classList.add('hidden');
  state.pendingText = null;
  state.drawing = false;
}

// ========== القص ==========
function applyCrop() {
  const maxW = canvasBase.width;
  const maxH = canvasBase.height;
  let x = Math.max(0, parseInt(document.getElementById('crop-x').value) || 0);
  let y = Math.max(0, parseInt(document.getElementById('crop-y').value) || 0);
  let w = parseInt(document.getElementById('crop-w').value) || maxW;
  let h = parseInt(document.getElementById('crop-h').value) || maxH;

  // تقييد الحدود لمنع القص خارج حدود الـ canvas
  x = Math.min(x, maxW - 1);
  y = Math.min(y, maxH - 1);
  w = Math.min(w, maxW - x);
  h = Math.min(h, maxH - y);

  if (w < 1 || h < 1) return;

  // دمج الطبقات
  const merged = getMergedCanvas();

  // قص الصورة
  const tmp    = document.createElement('canvas');
  tmp.width    = w; tmp.height = h;
  const tCtx   = tmp.getContext('2d');
  tCtx.drawImage(merged, x, y, w, h, 0, 0, w, h);

  // إعادة الرسم على الـ canvas الأساسي
  [canvasBase, canvasDraw, canvasEvents].forEach(c => {
    c.width  = w; c.height = h;
  });
  ctxDraw.clearRect(0, 0, w, h);
  ctxBase.drawImage(tmp, 0, 0);

  // تحديث بيانات القص
  document.getElementById('crop-w').value = w;
  document.getElementById('crop-h').value = h;
  document.getElementById('crop-x').value = 0;
  document.getElementById('crop-y').value = 0;

  document.getElementById('info-size').textContent = `${w} × ${h} px`;
  state.cropRect = null;
  saveToUndoStack();
  setStatus('✅ تم تطبيق القص');
}

function cancelCrop() {
  state.cropRect = null;
  ctxEvt.clearRect(0, 0, canvasEvents.width, canvasEvents.height);
  selectTool('select');
}

// ========== Undo / Redo ==========
function saveToUndoStack() {
  const merged = getMergedCanvas();
  const ctx    = merged.getContext('2d');
  state.history.push(ctx.getImageData(0, 0, merged.width, merged.height));
  state.future = []; // مسح المستقبل

  // حد 15 خطوة (لتوفير الذاكرة — كل خطوة قد تكون عدة ميغابايت)
  if (state.history.length > 15) state.history.shift();

  updateUndoButtons();
}

function undo() {
  if (state.history.length <= 1) return;
  state.future.push(state.history.pop());
  const snap = state.history[state.history.length - 1];
  restoreSnapshot(snap);
  updateUndoButtons();
}

function redo() {
  if (!state.future.length) return;
  const snap = state.future.pop();
  state.history.push(snap);
  restoreSnapshot(snap);
  updateUndoButtons();
}

function restoreSnapshot(imageData) {
  canvasBase.width  = imageData.width;
  canvasBase.height = imageData.height;
  canvasDraw.width  = imageData.width;
  canvasDraw.height = imageData.height;
  canvasEvents.width  = imageData.width;
  canvasEvents.height = imageData.height;
  ctxDraw.clearRect(0, 0, imageData.width, imageData.height);
  ctxEvt.clearRect(0, 0, imageData.width, imageData.height);
  ctxBase.putImageData(imageData, 0, 0);
}

function updateUndoButtons() {
  document.getElementById('btn-undo').disabled = state.history.length <= 1;
  document.getElementById('btn-redo').disabled = state.future.length === 0;
}

// ========== التصدير ==========
async function exportImage() {
  const format   = document.getElementById('export-format').value;
  const merged   = getMergedCanvas();
  const filename = generateFilename(format);

  setStatus('⏳ جاري التصدير...');

  try {
    if (format === 'pdf') {
      await exportAsPDF(merged, filename);
    } else {
      const quality  = format === 'jpeg' ? state.meta.quality || 0.95 : 1;
      const mimeType = format === 'jpeg' ? 'image/jpeg' : 'image/png';
      const dataUrl  = merged.toDataURL(mimeType, quality);
      await downloadDataUrl(dataUrl, filename);
    }
    setStatus('✅ تم التصدير: ' + filename);
  } catch (err) {
    setStatus('❌ فشل التصدير: ' + err.message);
  }
}

async function exportAsPDF(canvas, filename) {
  if (typeof jspdf === 'undefined' && typeof window.jspdf === 'undefined') {
    throw new Error('مكتبة jsPDF غير محملة');
  }

  const { jsPDF } = window.jspdf || jspdf;
  const imgData   = canvas.toDataURL('image/jpeg', 0.92);
  const W         = canvas.width;
  const H         = canvas.height;

  // تحديد اتجاه الصفحة
  const orientation = W >= H ? 'l' : 'p';
  const pdf = new jsPDF({
    orientation,
    unit: 'px',
    format: [W, H],
    hotfixes: ['px_scaling']
  });

  pdf.addImage(imgData, 'JPEG', 0, 0, W, H);
  pdf.save(filename);
}

async function copyToClipboard() {
  const merged = getMergedCanvas();
  merged.toBlob(async (blob) => {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': blob })
      ]);
      setStatus('✅ تم النسخ للحافظة');
    } catch (err) {
      setStatus('❌ فشل النسخ: ' + err.message);
    }
  }, 'image/png');
}

async function saveToHistory() {
  const merged    = getMergedCanvas();
  const imageData = merged.toDataURL('image/png');

  // صورة مصغرة
  const thumbCanvas = document.createElement('canvas');
  const scale = Math.min(1, 120 / merged.width);
  thumbCanvas.width  = merged.width  * scale;
  thumbCanvas.height = merged.height * scale;
  thumbCanvas.getContext('2d').drawImage(merged, 0, 0, thumbCanvas.width, thumbCanvas.height);
  const thumbnail = thumbCanvas.toDataURL('image/jpeg', 0.7);

  const result = await sendMessage({
    action: 'save-screenshot',
    data: {
      imageData,
      thumbnail,
      format: 'png',
      url:    state.meta.url,
      title:  state.meta.title,
      size:   `${merged.width}×${merged.height}`,
    }
  });

  setStatus(result?.success ? '✅ تم الحفظ في السجل' : '❌ فشل الحفظ');
}

// ========== اختصارات لوحة المفاتيح ==========
function onKeyDown(e) {
  // لا تتدخل عند الكتابة في حقول النص
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

  const ctrl = e.ctrlKey || e.metaKey;

  if (ctrl && e.key === 'z') { e.preventDefault(); undo(); return; }
  if (ctrl && e.key === 'y') { e.preventDefault(); redo(); return; }
  if (ctrl && e.key === 's') { e.preventDefault(); exportImage(); return; }
  if (ctrl && e.key === 'c') { e.preventDefault(); copyToClipboard(); return; }

  // اختصارات الأدوات — منع السلوك الافتراضي للمتصفح
  const tools = { v: 'select', c: 'crop', d: 'draw', a: 'arrow', r: 'rect', t: 'text', b: 'blur' };
  if (!ctrl && tools[e.key.toLowerCase()]) {
    e.preventDefault();
    selectTool(tools[e.key.toLowerCase()]);
  }
}

// ========== مساعدات ==========
function getMergedCanvas() {
  const merged = document.createElement('canvas');
  merged.width  = canvasBase.width;
  merged.height = canvasBase.height;
  const mCtx   = merged.getContext('2d');
  mCtx.drawImage(canvasBase, 0, 0);
  mCtx.drawImage(canvasDraw, 0, 0);
  return merged;
}

function normalizeRect(x1, y1, x2, y2) {
  return {
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    w: Math.abs(x2 - x1),
    h: Math.abs(y2 - y1),
  };
}

function generateFilename(format) {
  const template = state.meta.template || 'snapshield_%date_%time';
  const now      = new Date();
  const date     = now.toLocaleDateString('en-CA').replace(/\//g, '-');
  const time     = now.toTimeString().slice(0, 8).replace(/:/g, '-');
  const title    = (state.meta.title || 'capture').replace(/[<>:"/\\|?*]/g, '').slice(0, 40);
  const url      = (state.meta.url   || '').replace(/https?:\/\//, '').split('/')[0].replace(/[<>:"/\\|?*]/g, '').slice(0, 30);

  const name = template
    .replace('%date',   date)
    .replace('%time',   time)
    .replace('%title',  title)
    .replace('%url',    url)
    .replace('%random', Math.random().toString(36).slice(2, 7));

  const ext = format === 'pdf' ? 'pdf' : format === 'jpeg' ? 'jpg' : 'png';
  return `${name}.${ext}`;
}

async function downloadDataUrl(dataUrl, filename) {
  const a       = document.createElement('a');
  a.href        = dataUrl;
  a.download    = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function sendMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        resolve(null);
      } else {
        resolve(response);
      }
    });
  });
}

function setStatus(msg) {
  document.getElementById('status-msg').textContent = msg;
}
