// SnapShield - Popup Controller
'use strict';

// ========== الحالة ==========
let currentSettings = {
  maskSensitiveData: true,
  exportFormat: 'png',
  jpegQuality: 0.95,
  captureDelay: 0,
  filenameTemplate: 'snapshield_%date_%time',
  maxHistory: 50,
  darkMode: false,
};

// ========== تهيئة ==========
document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();
  await renderHistory();
  bindEvents();
});

function bindEvents() {
  // أزرار الالتقاط
  document.getElementById('btn-fullpage').addEventListener('click', () => capture('fullpage'));
  document.getElementById('btn-visible').addEventListener('click',  () => capture('visible'));
  document.getElementById('btn-region').addEventListener('click',   () => captureRegion());

  // الإعدادات
  document.getElementById('btn-settings').addEventListener('click', showSettings);
  document.getElementById('btn-back').addEventListener('click', showMain);
  document.getElementById('btn-save-settings').addEventListener('click', saveSettings);
  document.getElementById('btn-clear-all').addEventListener('click', clearAll);

  // مبدل إخفاء البيانات
  document.getElementById('toggle-mask').addEventListener('change', (e) => {
    currentSettings.maskSensitiveData = e.target.checked;
    showStatus(e.target.checked ? '🔒 إخفاء البيانات مفعّل' : '🔓 إخفاء البيانات معطّل');
  });

  // مبدل الوضع الداكن
  document.getElementById('toggle-dark').addEventListener('change', (e) => {
    currentSettings.darkMode = e.target.checked;
  });

  // أزرار التنسيق
  document.querySelectorAll('.fmt-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.fmt-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentSettings.exportFormat = btn.dataset.format;
    });
  });

  // أزرار التأخير
  document.querySelectorAll('.delay-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.delay-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentSettings.captureDelay = parseInt(btn.dataset.delay);
    });
  });

  // مسح السجل
  document.getElementById('btn-clear-history').addEventListener('click', clearHistory);

  // شريط جودة JPEG
  const qualitySlider = document.getElementById('setting-quality');
  qualitySlider?.addEventListener('input', () => {
    document.getElementById('quality-value').textContent = qualitySlider.value + '%';
  });
}

// ========== الالتقاط ==========
async function capture(mode) {
  const tab = await getActiveTab();
  if (!tab) return showStatus('❌ لا يوجد تبويب نشط', 'error');

  // عداد تنازلي إذا كان هناك تأخير
  if (currentSettings.captureDelay > 0) {
    showLoading(`جاري الالتقاط خلال ${currentSettings.captureDelay} ثانية...`);
    await showCountdown(currentSettings.captureDelay);
  } else {
    showLoading('جاري الالتقاط...');
  }

  try {
    const result = await sendMessage({
      action: mode === 'fullpage' ? 'capture-fullpage' : 'capture-visible',
      tabId: tab.id,
      settings: currentSettings,
    });

    if (result?.success) {
      hideLoading();
      await openEditor(result, tab, mode);
    } else {
      throw new Error(result?.error || 'فشل الالتقاط');
    }
  } catch (err) {
    hideLoading();
    showStatus('❌ ' + err.message, 'error');
    console.error('[SnapShield]', err);
  }
}

async function captureRegion() {
  const tab = await getActiveTab();
  if (!tab) return;

  showStatus('ℹ️ اسحب لتحديد المنطقة المطلوبة');
  window.close(); // إغلاق الـ popup

  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => window.postMessage({ type: 'SNAPSHIELD_START_REGION' }, '*')
  });
}

// ========== فتح المحرر ==========
async function openEditor(captureResult, tab, mode) {
  // حفظ مؤقت
  const tempId = `temp_${Date.now()}`;
  await chrome.storage.local.set({ [tempId]: captureResult });

  const params = new URLSearchParams({
    id:       tempId,
    mode,
    format:   currentSettings.exportFormat,
    quality:  currentSettings.jpegQuality,
    template: currentSettings.filenameTemplate,
    tabTitle: tab.title || '',
    tabUrl:   tab.url   || '',
  });

  chrome.tabs.create({
    url: chrome.runtime.getURL(`editor/editor.html?${params.toString()}`),
    active: true
  });

  window.close();
}

// ========== السجل ==========
async function renderHistory() {
  const result = await sendMessage({ action: 'get-history' });
  const list   = document.getElementById('history-list');
  const items  = result || [];

  if (!items.length) {
    list.innerHTML = '<div class="history-empty">لا توجد لقطات بعد</div>';
    return;
  }

  list.innerHTML = '';
  items.forEach(item => {
    const el = document.createElement('div');
    el.className = 'history-item';
    el.innerHTML = `
      <img class="history-thumb" src="${item.thumbnail || ''}" alt="لقطة">
      <div class="history-meta">
        <div class="history-meta-title">${escapeHtml(item.title || 'بدون عنوان')}</div>
        <div class="history-meta-time">${formatTime(item.timestamp)}</div>
      </div>
      <button class="history-del" title="حذف">✕</button>
    `;

    // فتح في المحرر
    el.addEventListener('click', (e) => {
      if (e.target.classList.contains('history-del')) return;
      chrome.tabs.create({
        url: chrome.runtime.getURL(`editor/editor.html?historyId=${item.id}`)
      });
      window.close();
    });

    // حذف
    el.querySelector('.history-del').addEventListener('click', async (e) => {
      e.stopPropagation();
      await sendMessage({ action: 'delete-history-item', id: item.id });
      await renderHistory();
    });

    list.appendChild(el);
  });
}

async function clearHistory() {
  if (!confirm('هل تريد مسح جميع اللقطات المحفوظة؟')) return;
  await sendMessage({ action: 'clear-history' });
  await renderHistory();
  showStatus('✅ تم مسح السجل');
}

// ========== الإعدادات ==========
async function loadSettings() {
  const result = await sendMessage({ action: 'get-settings' });
  if (result) {
    currentSettings = { ...currentSettings, ...result };
    applySettingsToUI();
  }
}

function applySettingsToUI() {
  // مبدل الإخفاء
  document.getElementById('toggle-mask').checked = currentSettings.maskSensitiveData;

  // التنسيق
  document.querySelectorAll('.fmt-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.format === currentSettings.exportFormat);
  });

  // التأخير
  document.querySelectorAll('.delay-btn').forEach(b => {
    b.classList.toggle('active', parseInt(b.dataset.delay) === currentSettings.captureDelay);
  });

  // قالب الاسم
  const fnInput = document.getElementById('setting-filename');
  if (fnInput) fnInput.value = currentSettings.filenameTemplate;

  // الجودة
  const qualSlider = document.getElementById('setting-quality');
  if (qualSlider) {
    qualSlider.value = Math.round(currentSettings.jpegQuality * 100);
    document.getElementById('quality-value').textContent =
      Math.round(currentSettings.jpegQuality * 100) + '%';
  }
}

async function saveSettings() {
  const fnInput    = document.getElementById('setting-filename');
  const qualSlider = document.getElementById('setting-quality');
  const histLimit  = document.getElementById('setting-history-limit');

  currentSettings.filenameTemplate = fnInput?.value || 'snapshield_%date_%time';
  currentSettings.jpegQuality      = (parseInt(qualSlider?.value) || 95) / 100;
  currentSettings.maxHistory       = parseInt(histLimit?.value) || 50;

  await sendMessage({ action: 'save-settings', settings: currentSettings });
  showStatus('✅ تم حفظ الإعدادات');
  showMain();
}

async function clearAll() {
  if (!confirm('سيتم حذف جميع اللقطات والإعدادات. هل أنت متأكد؟')) return;
  await chrome.storage.local.clear();
  showStatus('✅ تم حذف جميع البيانات');
  await renderHistory();
  showMain();
}

// ========== التنقل بين الأقسام ==========
function showSettings() {
  document.getElementById('view-main').classList.add('hidden');
  document.getElementById('view-settings').classList.remove('hidden');
}

function showMain() {
  document.getElementById('view-settings').classList.add('hidden');
  document.getElementById('view-main').classList.remove('hidden');
}

// ========== مؤشر التحميل ==========
function showLoading(text = 'جاري الالتقاط...') {
  document.getElementById('loading-text').textContent = text;
  document.getElementById('loading').classList.remove('hidden');
}

function hideLoading() {
  document.getElementById('loading').classList.add('hidden');
}

// ========== شريط الحالة ==========
let statusTimer;
function showStatus(msg, type = '') {
  const bar = document.getElementById('status-bar');
  bar.textContent  = msg;
  bar.className    = 'status-bar ' + type;
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => {
    bar.textContent = '';
    bar.className   = 'status-bar';
  }, 3000);
}

// ========== عداد تنازلي ==========
function showCountdown(seconds) {
  return new Promise(resolve => {
    let remaining = seconds;
    const tick = () => {
      if (remaining <= 0) { resolve(); return; }
      showLoading(`الالتقاط خلال ${remaining} ثانية...`);
      remaining--;
      setTimeout(tick, 1000);
    };
    tick();
  });
}

// ========== مساعدات ==========
async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function sendMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        console.warn('[SnapShield]', chrome.runtime.lastError.message);
        resolve(null);
      } else {
        resolve(response);
      }
    });
  });
}

function formatTime(timestamp) {
  if (!timestamp) return '';
  return new Date(timestamp).toLocaleString('ar-SA', {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
