// SnapShield - Background Service Worker
// معالجة محلية 100% - صفر اتصال بالإنترنت

'use strict';

// ========== الإعدادات العامة ==========
const DEFAULT_SETTINGS = {
  maskSensitiveData: true,
  exportFormat: 'png',
  jpegQuality: 0.95,
  captureDelay: 0,
  filenameTemplate: 'snapshield_%date_%time',
  maxHistory: 50,
  darkMode: false,
  printMode: false,
};

// ========== الاستماع للأوامر ==========
chrome.commands.onCommand.addListener(async (command) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;

  switch (command) {
    case 'capture-fullpage':
      await startCapture(tab, 'fullpage');
      break;
    case 'capture-visible':
      await startCapture(tab, 'visible');
      break;
    case 'capture-region':
      await startRegionSelect(tab);
      break;
  }
});

// ========== الاستماع للرسائل ==========
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender, sendResponse)
    .catch(err => sendResponse({ error: err.message }));
  return true; // async
});

async function handleMessage(message, sender, sendResponse) {
  try {
    switch (message.action) {
      case 'capture-fullpage':
        sendResponse(await captureFullPage(message.tabId, message.settings));
        break;

      case 'capture-visible':
        sendResponse(await captureVisibleArea(message.tabId, message.settings));
        break;

      case 'capture-region-result': {
        // استخدم sender.tab.id لأن content script يُرسل tabId: null
        const regionTabId = message.tabId || sender?.tab?.id;
        if (!regionTabId) { sendResponse({ error: 'No tab ID available' }); break; }
        const regionResult = await processRegionCapture(regionTabId, message.region, message.settings);
        if (regionResult.success) {
          const regionTab = await chrome.tabs.get(regionTabId).catch(() => null);
          await openEditor(regionResult, regionTab || { title: '', url: '' }, 'region');
        }
        sendResponse({ success: regionResult.success });
        break;
      }

      case 'save-screenshot':
        sendResponse(await saveScreenshot(message.data));
        break;

      case 'get-history':
        sendResponse(await getHistory());
        break;

      case 'delete-history-item':
        sendResponse(await deleteHistoryItem(message.id));
        break;

      case 'clear-history':
        sendResponse(await clearHistory());
        break;

      case 'get-settings':
        sendResponse(await getSettings());
        break;

      case 'save-settings':
        sendResponse(await saveSettings(message.settings));
        break;

      case 'download-file':
        sendResponse(await downloadFile(message.dataUrl, message.filename));
        break;

      default:
        sendResponse({ error: 'Unknown action' });
    }
  } catch (err) {
    console.error('[SnapShield] Error:', err);
    sendResponse({ error: err.message });
  }
}

// ========== CDP - التقاط عبر Chrome DevTools Protocol ==========
async function captureFullPage(tabId, settings = {}) {
  const debuggee = { tabId };

  try {
    // إرفاق المصحح
    await chrome.debugger.attach(debuggee, '1.3');

    // إعداد الصفحة للالتقاط (إزالة الحماية + تحميل كامل)
    await chrome.scripting.executeScript({
      target: { tabId },
      func: preparePageScript,
      args: [settings.maskSensitiveData ?? true]
    });

    // انتظار التأخير إن وُجد
    if (settings.captureDelay > 0) {
      await sleep(settings.captureDelay * 1000);
    }

    // الحصول على أبعاد الصفحة الكاملة
    const { contentSize, visualViewport } = await chrome.debugger.sendCommand(
      debuggee,
      'Page.getLayoutMetrics'
    );

    const width  = Math.ceil(contentSize.width);
    const height = Math.ceil(contentSize.height);
    const dpr    = visualViewport.clientWidth > 0
      ? Math.round(contentSize.width / visualViewport.clientWidth)
      : 2;

    // ضبط viewport للصفحة كاملة
    await chrome.debugger.sendCommand(debuggee, 'Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: Math.max(dpr, 2), // جودة عالية (2x على الأقل)
      mobile: false,
    });

    // تمرير الصفحة لتحميل المحتوى الكسول
    await scrollToLoadLazyContent(debuggee, height);

    // التقاط الصورة
    const result = await chrome.debugger.sendCommand(debuggee, 'Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true,
      clip: {
        x: 0, y: 0,
        width,
        height,
        scale: 1
      }
    });

    // إعادة الصفحة لحالتها
    await chrome.scripting.executeScript({
      target: { tabId },
      func: restorePageScript
    });

    return {
      success: true,
      data: `data:image/png;base64,${result.data}`,
      width,
      height,
      timestamp: Date.now()
    };

  } catch (err) {
    throw new Error(`CDP capture failed: ${err.message}`);
  } finally {
    try { await chrome.debugger.detach(debuggee); } catch (_) {}
  }
}

async function captureVisibleArea(tabId, settings = {}) {
  const debuggee = { tabId };

  try {
    await chrome.debugger.attach(debuggee, '1.3');

    await chrome.scripting.executeScript({
      target: { tabId },
      func: preparePageScript,
      args: [settings.maskSensitiveData ?? true]
    });

    if (settings.captureDelay > 0) {
      await sleep(settings.captureDelay * 1000);
    }

    const result = await chrome.debugger.sendCommand(debuggee, 'Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: false
    });

    await chrome.scripting.executeScript({
      target: { tabId },
      func: restorePageScript
    });

    return {
      success: true,
      data: `data:image/png;base64,${result.data}`,
      timestamp: Date.now()
    };

  } catch (err) {
    throw new Error(`Visible area capture failed: ${err.message}`);
  } finally {
    try { await chrome.debugger.detach(debuggee); } catch (_) {}
  }
}

async function processRegionCapture(tabId, region, settings = {}) {
  const debuggee = { tabId };

  try {
    await chrome.debugger.attach(debuggee, '1.3');

    await chrome.scripting.executeScript({
      target: { tabId },
      func: preparePageScript,
      args: [settings.maskSensitiveData ?? true]
    });

    const result = await chrome.debugger.sendCommand(debuggee, 'Page.captureScreenshot', {
      format: 'png',
      clip: {
        x:      region.x,
        y:      region.y,
        width:  region.width,
        height: region.height,
        scale:  region.dpr || 2  // إصلاح: لا يوجد window في service worker
      },
      captureBeyondViewport: true
    });

    await chrome.scripting.executeScript({
      target: { tabId },
      func: restorePageScript
    });

    return {
      success: true,
      data: `data:image/png;base64,${result.data}`,
      timestamp: Date.now()
    };

  } catch (err) {
    throw new Error(`Region capture failed: ${err.message}`);
  } finally {
    try { await chrome.debugger.detach(debuggee); } catch (_) {}
  }
}

// ========== تمرير لتحميل المحتوى الكسول ==========
async function scrollToLoadLazyContent(debuggee, totalHeight) {
  const viewportHeight = 800;
  let current = 0;

  while (current < totalHeight) {
    await chrome.debugger.sendCommand(debuggee, 'Runtime.evaluate', {
      expression: `window.scrollTo(0, ${current})`
    });
    await sleep(150);
    current += viewportHeight;
  }

  // العودة للأعلى
  await chrome.debugger.sendCommand(debuggee, 'Runtime.evaluate', {
    expression: 'window.scrollTo(0, 0)'
  });
  await sleep(300);
}

// ========== التقاط عبر startCapture (للأوامر المختصرة) ==========
async function startCapture(tab, mode) {
  const settings = await getSettings();

  try {
    let result;
    if (mode === 'fullpage') {
      result = await captureFullPage(tab.id, settings);
    } else {
      result = await captureVisibleArea(tab.id, settings);
    }

    if (result.success) {
      await openEditor(result, tab, mode);
    }
  } catch (err) {
    console.error('[SnapShield] Capture error:', err);
  }
}

async function startRegionSelect(tab) {
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => {
      window.postMessage({ type: 'SNAPSHIELD_START_REGION' }, '*');
    }
  });
}

// ========== فتح المحرر ==========
async function openEditor(captureResult, tab, mode) {
  const tempId = `temp_${Date.now()}`;
  // نخزن البيانات + metadata معاً لتجنب URLs طويلة
  await chrome.storage.local.set({
    [tempId]: {
      ...captureResult,
      meta: {
        title:    tab?.title  || '',
        url:      tab?.url    || '',
        mode,
      }
    }
  });

  chrome.tabs.create({
    url: chrome.runtime.getURL(`editor/editor.html?id=${tempId}`),
    active: true
  });
}

// ========== حفظ واسترجاع السجل ==========
async function saveScreenshot(data) {
  const history = await getHistory();

  const entry = {
    id:        `ss_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    thumbnail: data.thumbnail,
    data:      data.imageData,
    format:    data.format,
    url:       data.url,
    title:     data.title,
    timestamp: Date.now(),
    size:      data.size
  };

  history.unshift(entry);
  if (history.length > 50) history.pop();

  await chrome.storage.local.set({ screenshot_history: history });
  return { success: true, id: entry.id };
}

async function getHistory() {
  const result = await chrome.storage.local.get('screenshot_history');
  return result.screenshot_history || [];
}

async function deleteHistoryItem(id) {
  const history = await getHistory();
  const filtered = history.filter(h => h.id !== id);
  await chrome.storage.local.set({ screenshot_history: filtered });
  return { success: true };
}

async function clearHistory() {
  await chrome.storage.local.remove('screenshot_history');
  return { success: true };
}

async function saveSettings(settings) {
  await chrome.storage.local.set({ settings });
  return { success: true };
}

// ========== التحميل ==========
async function downloadFile(dataUrl, filename) {
  return new Promise((resolve, reject) => {
    chrome.downloads.download({ url: dataUrl, filename, saveAs: true }, (downloadId) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve({ success: true, downloadId });
      }
    });
  });
}

// ========== الإعدادات ==========
async function getSettings() {
  try {
    const result = await chrome.storage.local.get('settings');
    return { ...DEFAULT_SETTINGS, ...(result?.settings || {}) };
  } catch (err) {
    console.error('[SnapShield] Failed to load settings:', err);
    return { ...DEFAULT_SETTINGS };
  }
}

// ========== سكريبتات تُحقن في الصفحة ==========

// يُحقن في الصفحة: إزالة حمايات CSS
function preparePageScript(maskEnabled) {
  // حفظ الأنماط الأصلية
  window.__snapshield_backup__ = [];

  // إزالة mix-blend-mode الضارة
  document.querySelectorAll('*').forEach(el => {
    const cs = window.getComputedStyle(el);
    if (cs.mixBlendMode && cs.mixBlendMode !== 'normal') {
      window.__snapshield_backup__.push({ el, prop: 'mix-blend-mode', val: el.style.mixBlendMode });
      el.style.setProperty('mix-blend-mode', 'normal', 'important');
    }
  });

  // إزالة الطبقات الشفافة الضارة (overlays)
  document.querySelectorAll('*').forEach(el => {
    const cs = window.getComputedStyle(el);
    const zi = parseInt(cs.zIndex) || 0;
    const op = parseFloat(cs.opacity);
    const pos = cs.position;

    const isBlockingOverlay =
      (pos === 'fixed' || pos === 'absolute') &&
      zi > 900 &&
      op < 0.15 &&
      el.offsetWidth > window.innerWidth * 0.5;

    if (isBlockingOverlay) {
      window.__snapshield_backup__.push({ el, prop: 'display', val: el.style.display });
      el.style.setProperty('display', 'none', 'important');
    }
  });

  // حقن CSS عام
  const style = document.createElement('style');
  style.id = '__snapshield_override__';
  style.textContent = `
    * {
      mix-blend-mode: normal !important;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    video { visibility: hidden !important; }
  `;
  document.head.appendChild(style);

  // إخفاء البيانات الحساسة
  if (maskEnabled) {
    maskSensitiveData();
  }

  function maskSensitiveData() {
    const patterns = {
      creditCard: /\b(?:\d[ -]?){13,19}\b/g,
      email:      /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g,
      phone:      /(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g,
      jwt:        /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
      apiKey:     /(?:api[_\-]?key|token|secret)[\s:='"]+([A-Za-z0-9_\-]{20,})/gi,
    };

    // إخفاء حقول كلمة المرور
    document.querySelectorAll('input[type="password"]').forEach(el => {
      window.__snapshield_backup__.push({ el, prop: '--pw-blur', val: '' });
      el.style.setProperty('filter', 'blur(8px)', 'important');
      el.style.setProperty('-webkit-filter', 'blur(8px)', 'important');
    });

    // إخفاء النصوص الحساسة
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const nodes = [];
    let node;
    while ((node = walker.nextNode())) nodes.push(node);

    nodes.forEach(textNode => {
      let text = textNode.textContent;
      let masked = false;

      for (const [, pattern] of Object.entries(patterns)) {
        if (pattern.test(text)) {
          masked = true;
          text = text.replace(pattern, (match) => '█'.repeat(match.length));
          pattern.lastIndex = 0;
        }
      }

      if (masked) {
        window.__snapshield_backup__.push({ el: textNode, prop: 'text', val: textNode.textContent });
        textNode.textContent = text;
      }
    });
  }
}

// يُحقن في الصفحة: استعادة الحالة الأصلية
function restorePageScript() {
  // استعادة الأنماط
  (window.__snapshield_backup__ || []).forEach(({ el, prop, val }) => {
    if (prop === 'text') {
      el.textContent = val;
    } else {
      el.style.setProperty(prop, val);
    }
  });

  // إزالة CSS المحقون
  document.getElementById('__snapshield_override__')?.remove();

  // تنظيف
  delete window.__snapshield_backup__;
}

// ========== مساعدات ==========
function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}
