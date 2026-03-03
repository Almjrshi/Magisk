// SnapShield - Content Script
// يعمل في سياق الصفحة: تحديد المنطقة + الاستجابة للأوامر

'use strict';

let regionSelector = null;

// ========== الاستماع للرسائل ==========
window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  if (!event.data?.type?.startsWith('SNAPSHIELD_')) return;

  switch (event.data.type) {
    case 'SNAPSHIELD_START_REGION':
      startRegionSelection();
      break;
  }
});

chrome.runtime.onMessage.addListener((message, _, sendResponse) => {
  if (message.action === 'start-region-select') {
    startRegionSelection();
    sendResponse({ success: true });
  }
  return true;
});

// ========== تحديد المنطقة ==========
function startRegionSelection() {
  if (regionSelector) return; // منع التكرار

  regionSelector = new RegionSelector();
  regionSelector.start((region) => {
    // إرسال المنطقة للـ background
    chrome.runtime.sendMessage({
      action: 'capture-region-result',
      tabId: null, // يُحدد في الـ background
      region,
      settings: {}
    }, (result) => {
      if (result?.success) {
        chrome.runtime.sendMessage({
          action: 'open-editor',
          captureResult: result,
          mode: 'region'
        });
      }
    });

    regionSelector = null;
  });
}

// ========== أداة تحديد المنطقة ==========
class RegionSelector {
  constructor() {
    this.overlay    = null;
    this.selection  = null;
    this.startX     = 0;
    this.startY     = 0;
    this.isDrawing  = false;
    this.onComplete = null;
  }

  start(callback) {
    this.onComplete = callback;
    this._buildUI();
    this._bindEvents();
  }

  _buildUI() {
    // خلفية شبه شفافة
    this.overlay = document.createElement('div');
    Object.assign(this.overlay.style, {
      position:        'fixed',
      top:             '0',
      left:            '0',
      width:           '100vw',
      height:          '100vh',
      background:      'rgba(0,0,0,0.4)',
      zIndex:          '2147483647',
      cursor:          'crosshair',
      userSelect:      'none',
    });

    // مستطيل التحديد
    this.selection = document.createElement('div');
    Object.assign(this.selection.style, {
      position:   'absolute',
      border:     '2px solid #4f9eff',
      background: 'rgba(79,158,255,0.08)',
      display:    'none',
      boxSizing:  'border-box',
    });

    // تلميح
    const hint = document.createElement('div');
    Object.assign(hint.style, {
      position:   'fixed',
      top:        '16px',
      left:       '50%',
      transform:  'translateX(-50%)',
      background: 'rgba(0,0,0,0.75)',
      color:      '#fff',
      padding:    '8px 18px',
      borderRadius: '8px',
      fontSize:   '14px',
      fontFamily: 'system-ui, sans-serif',
      zIndex:     '2147483647',
      pointerEvents: 'none',
    });
    hint.textContent = 'اسحب لتحديد المنطقة — Esc للإلغاء';

    // معلومات الأبعاد
    this.sizeLabel = document.createElement('div');
    Object.assign(this.sizeLabel.style, {
      position:   'absolute',
      background: 'rgba(0,0,0,0.7)',
      color:      '#fff',
      padding:    '3px 8px',
      borderRadius: '4px',
      fontSize:   '12px',
      fontFamily: 'monospace',
      display:    'none',
      pointerEvents: 'none',
    });

    this.overlay.appendChild(this.selection);
    this.overlay.appendChild(this.sizeLabel);
    document.body.appendChild(this.overlay);
    document.body.appendChild(hint);
    this._hint = hint;
  }

  _bindEvents() {
    this._onMouseDown = this._mouseDown.bind(this);
    this._onMouseMove = this._mouseMove.bind(this);
    this._onMouseUp   = this._mouseUp.bind(this);
    this._onKeyDown   = this._keyDown.bind(this);

    this.overlay.addEventListener('mousedown', this._onMouseDown);
    window.addEventListener('mousemove',  this._onMouseMove);
    window.addEventListener('mouseup',    this._onMouseUp);
    window.addEventListener('keydown',    this._onKeyDown);
  }

  _mouseDown(e) {
    this.isDrawing = true;
    this.startX    = e.clientX;
    this.startY    = e.clientY;
    this.selection.style.display = 'block';
    this.sizeLabel.style.display = 'block';
  }

  _mouseMove(e) {
    if (!this.isDrawing) return;

    const x = Math.min(e.clientX, this.startX);
    const y = Math.min(e.clientY, this.startY);
    const w = Math.abs(e.clientX - this.startX);
    const h = Math.abs(e.clientY - this.startY);

    Object.assign(this.selection.style, {
      left:   x + 'px',
      top:    y + 'px',
      width:  w + 'px',
      height: h + 'px',
    });

    // تحديث معلومات الأبعاد
    this.sizeLabel.textContent = `${Math.round(w)} × ${Math.round(h)}`;
    Object.assign(this.sizeLabel.style, {
      left: (x + w + 6) + 'px',
      top:  (y + h + 6) + 'px',
    });
  }

  _mouseUp(e) {
    if (!this.isDrawing) return;
    this.isDrawing = false;

    const w = Math.abs(e.clientX - this.startX);
    const h = Math.abs(e.clientY - this.startY);

    if (w < 10 || h < 10) {
      this._cleanup();
      return;
    }

    const dpr = window.devicePixelRatio || 1;
    const region = {
      x:      Math.min(e.clientX, this.startX) + window.scrollX,
      y:      Math.min(e.clientY, this.startY) + window.scrollY,
      width:  w,
      height: h,
      dpr
    };

    this._cleanup();
    this.onComplete?.(region);
  }

  _keyDown(e) {
    if (e.key === 'Escape') {
      this._cleanup();
      regionSelector = null;
    }
  }

  _cleanup() {
    this.overlay?.remove();
    this._hint?.remove();
    window.removeEventListener('mousemove', this._onMouseMove);
    window.removeEventListener('mouseup',   this._onMouseUp);
    window.removeEventListener('keydown',   this._onKeyDown);
  }
}
