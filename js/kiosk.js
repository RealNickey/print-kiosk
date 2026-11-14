import { upload } from '/js/vendor/blob-client.js';

// Constants
const SESSION_STORAGE_KEY = 'kiosk_station_session_v2';
const TOTAL_IDLE_SECONDS = 180; // 3 minutes

// Global state
let currentCode = null;
let currentFiles = [];
let currentState = 'idle'; // 'idle' | 'received' | 'sending'
let pollInterval = null;
let pingInterval = null;
let idleTimer = null;
let idleTimeRemaining = TOTAL_IDLE_SECONDS;
let consecutive404Count = 0;
let isOffline = false;

// DOM Elements
const body = document.getElementById('kiosk-body');
const displayCode = document.getElementById('display-code');
const qrCanvasReceive = document.getElementById('qr-canvas-receive');
const qrCanvasSend = document.getElementById('qr-canvas-send');
const networkBanner = document.getElementById('network-banner');
const networkBannerText = document.getElementById('network-banner-text');
const statusDot = document.getElementById('status-dot');
const statusLabel = document.getElementById('status-label');

const tabReceive = document.getElementById('tab-receive');
const tabSend = document.getElementById('tab-send');

const viewIdle = document.getElementById('view-idle');
const viewReceived = document.getElementById('view-received');
const viewSending = document.getElementById('view-sending');

const receivedCountChip = document.getElementById('received-count-chip');
const receivedFilesList = document.getElementById('received-files-list');
const receivedThumbnailStrip = document.getElementById('received-thumbnail-strip');
const btnPrintAll = document.getElementById('btn-print-all');
const btnDownloadAll = document.getElementById('btn-download-all');
const btnResetReceived = document.getElementById('btn-reset-received');
const btnManualRefresh = document.getElementById('btn-manual-refresh');

const btnBackToReceive = document.getElementById('btn-back-to-receive');
const desktopFileInput = document.getElementById('desktop-file-input');
const desktopDropzone = document.getElementById('desktop-dropzone');
const outboundQrContainer = document.getElementById('outbound-qr-container');
const outboundCountChip = document.getElementById('outbound-count-chip');
const outboundFilesList = document.getElementById('outbound-files-list');

const dragOverlay = document.getElementById('drag-overlay');
const idleTimeoutFill = document.getElementById('idle-timeout-fill');
const idleTimeoutLabel = document.getElementById('idle-timeout-label');
const timeoutProgress = document.getElementById('timeout-progress');
const timeoutLabel = document.getElementById('timeout-label');
const timeoutWarningBanner = document.getElementById('timeout-warning-banner');
const printIframe = document.getElementById('print-iframe');

/**
 * Persist active session to survive page reloads.
 */
function getStoredSession() {
  try {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    const now = Date.now();
    if (now >= data.expiresAt) {
      localStorage.removeItem(SESSION_STORAGE_KEY);
      return null;
    }
    return data;
  } catch (e) {
    return null;
  }
}

function saveStoredSession(code, remainingSec = TOTAL_IDLE_SECONDS) {
  try {
    const data = {
      code,
      expiresAt: Date.now() + (remainingSec * 1000),
    };
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(data));
  } catch (e) {}
}

function clearStoredSession() {
  try {
    localStorage.removeItem(SESSION_STORAGE_KEY);
  } catch (e) {}
}

/**
 * XSS-safe text escaping
 */
function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = String(str);
  return div.innerHTML;
}

/**
 * Format bytes into human-readable string.
 */
function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

/**
 * Identify file classification for visual badges.
 */
function getFileTypeInfo(filename = '') {
  const ext = filename.split('.').pop().toLowerCase();
  if (['pdf'].includes(ext)) return { type: 'pdf', label: 'PDF' };
  if (['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'heic'].includes(ext)) return { type: 'img', label: 'IMG' };
  if (['doc', 'docx', 'odt'].includes(ext)) return { type: 'doc', label: 'DOC' };
  if (['xls', 'xlsx', 'csv'].includes(ext)) return { type: 'sheet', label: 'SHEET' };
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return { type: 'zip', label: 'ZIP' };
  return { type: 'generic', label: ext ? ext.substring(0, 4).toUpperCase() : 'FILE' };
}

/**
 * Update the header status indicator without re-rendering header.
 */
function setHeaderStatus(type, text) {
  if (!statusDot || !statusLabel) return;
  statusDot.className = 'status-dot ' + type;
  statusLabel.textContent = text;
}

/**
 * Switch view state with smooth in-place CSS animations.
 */
function setViewState(state) {
  currentState = state;
  viewIdle.classList.remove('active');
  viewReceived.classList.remove('active');
  viewSending.classList.remove('active');

  tabReceive.classList.toggle('active', state === 'idle' || state === 'received');
  tabSend.classList.toggle('active', state === 'sending');

  if (state === 'idle') {
    viewIdle.classList.add('active');
    setHeaderStatus('online', 'Ready');
    startIdleTimer();
  } else if (state === 'received') {
    viewReceived.classList.add('active');
    setHeaderStatus('online', 'Files Received');
    startIdleTimer();
  } else if (state === 'sending') {
    viewSending.classList.add('active');
    setHeaderStatus('online', 'Send Mode');
    startIdleTimer();
  }
}

/**
 * Render QR Code using locally bundled QRCode library.
 */
function renderQrCode(canvas, text) {
  if (!canvas || !text) return;
  if (window.QRCode && typeof window.QRCode.toCanvas === 'function') {
    try {
      window.QRCode.toCanvas(canvas, text, {
        width: 220,
        margin: 1,
        color: { dark: '#0f172a', light: '#ffffff' },
      }, (err) => {
        if (err) console.error('QR rendering error:', err);
      });
    } catch (e) {
      console.error('Failed to draw QR code:', e);
    }
  } else {
    setTimeout(() => renderQrCode(canvas, text), 200);
  }
}

/**
 * Initialize or restore a session across page reloads.
 */
async function initSession(forceNew = false) {
  if (!forceNew) {
    const stored = getStoredSession();
    if (stored && stored.code) {
      currentCode = stored.code;
      const remaining = Math.max(10, Math.round((stored.expiresAt - Date.now()) / 1000));
      idleTimeRemaining = remaining;
      displayCode.textContent = currentCode;

      const mobileUrl = `${window.location.origin}/mobile?code=${currentCode}`;
      renderQrCode(qrCanvasReceive, mobileUrl);

      // Verify status with server smoothly
      try {
        const res = await fetch(`/api/status?code=${currentCode}&t=${Date.now()}`);
        if (res.ok) {
          const data = await res.json();
          const files = Array.isArray(data.files) && data.files.length > 0
            ? data.files
            : data.file ? [data.file] : [];

          if (data.status === 'uploaded' && files.length > 0) {
            currentFiles = files;
            onFilesReceived(files);
            startPolling();
            return;
          }
          setViewState('idle');
          startPolling();
          return;
        }
      } catch (e) {
        // network issue, continue with stored code
        setViewState('idle');
        startPolling();
        return;
      }
    }
  }

  // Generate brand new session
  try {
    setHeaderStatus('warning', 'Connecting...');
    const res = await fetch('/api/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'receive' }),
    });

    if (!res.ok) {
      throw new Error(`Session creation failed: HTTP ${res.status}`);
    }

    const data = await res.json();
    currentCode = data.code;
    consecutive404Count = 0;
    currentFiles = [];
    idleTimeRemaining = TOTAL_IDLE_SECONDS;
    saveStoredSession(currentCode, idleTimeRemaining);

    displayCode.textContent = currentCode;

    const mobileUrl = `${window.location.origin}/mobile?code=${currentCode}`;
    renderQrCode(qrCanvasReceive, mobileUrl);

    setViewState('idle');
    startPolling();
  } catch (err) {
    console.error('Failed to init session:', err);
    setHeaderStatus('error', 'Error');
    showNetworkBanner('⚠️ Failed to generate session. Checking connection...');
    setTimeout(() => initSession(true), 4000);
  }
}

/**
 * Polling loop to check for incoming uploads smoothly in-place.
 */
function startPolling() {
  stopPolling();
  pollInterval = setInterval(async () => {
    if (!currentCode || currentState === 'received') return;

    try {
      const res = await fetch(`/api/status?code=${currentCode}&t=${Date.now()}`);

      if (!res.ok) {
        if (res.status === 404) {
          consecutive404Count++;
          if (consecutive404Count > 25) {
            console.warn('Persistent 404. Re-initializing session...');
            initSession(true);
          }
          return;
        }
        throw new Error(`Status check HTTP ${res.status}`);
      }

      consecutive404Count = 0;
      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        handleCaptivePortal();
        return;
      }

      const data = await res.json();
      hideNetworkBanner();

      const files = Array.isArray(data.files) && data.files.length > 0
        ? data.files
        : data.file ? [data.file] : [];

      if (data.status === 'uploaded' && files.length > 0) {
        currentFiles = files;
        onFilesReceived(files);
      }
    } catch (err) {
      console.warn('Polling network drop:', err.message);
      handleNetworkDrop();
    }
  }, 2000);
}

function stopPolling() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
}

/**
 * In-place non-refresh DOM update when files arrive.
 */
function onFilesReceived(files) {
  receivedCountChip.textContent = `${files.length} ${files.length === 1 ? 'file' : 'files'}`;
  receivedFilesList.innerHTML = '';
  receivedThumbnailStrip.innerHTML = '';
  let hasImages = false;

  files.forEach((file, idx) => {
    const fileInfo = getFileTypeInfo(file.name);
    const item = document.createElement('div');
    item.className = 'attachment-item';

    const isImage = fileInfo.type === 'img';
    const isPrintable = isImage || fileInfo.type === 'pdf';
    const safeName = escapeHtml(file.name);

    item.innerHTML = `
      <div class="attachment-left">
        <div class="file-type-icon ${fileInfo.type}">${escapeHtml(fileInfo.label)}</div>
        <div class="attachment-name-meta">
          <span class="attachment-name" title="${safeName}">${safeName}</span>
          <span class="attachment-size">${formatBytes(file.size)}</span>
        </div>
      </div>
      <div class="attachment-actions">
        ${isPrintable ? `<button class="btn-icon-action btn-print-single" data-index="${idx}" type="button">🖨️ Print</button>` : ''}
        <button class="btn-icon-action btn-download-single" data-index="${idx}" type="button">💾 Save</button>
      </div>
    `;

    receivedFilesList.appendChild(item);

    if (isImage && file.url) {
      hasImages = true;
      const thumb = document.createElement('div');
      thumb.className = 'thumbnail-card';
      const img = document.createElement('img');
      img.src = file.url;
      img.alt = file.name;
      img.loading = 'lazy';
      const badge = document.createElement('span');
      badge.className = 'thumbnail-badge';
      badge.textContent = formatBytes(file.size);
      thumb.appendChild(img);
      thumb.appendChild(badge);
      receivedThumbnailStrip.appendChild(thumb);
    }
  });

  receivedThumbnailStrip.style.display = hasImages ? 'flex' : 'none';

  receivedFilesList.querySelectorAll('.btn-print-single').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.getAttribute('data-index'), 10);
      printFile(currentFiles[idx]);
    });
  });

  receivedFilesList.querySelectorAll('.btn-download-single').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.getAttribute('data-index'), 10);
      downloadFile(currentFiles[idx]);
    });
  });

  setViewState('received');
}

/**
 * Print a single file.
 */
function printFile(file) {
  if (!file || !file.url) return;
  resetIdleTimer();

  const isPdfOrImage = /\.(pdf|jpg|jpeg|png|webp)$/i.test(file.name) ||
                       (file.contentType && (file.contentType.includes('pdf') || file.contentType.includes('image')));

  if (isPdfOrImage) {
    printIframe.src = file.url;
    printIframe.onload = () => {
      try {
        printIframe.contentWindow.focus();
        printIframe.contentWindow.print();
      } catch (e) {
        const win = window.open(file.url, '_blank');
        if (win) win.onload = () => win.print();
      }
    };
  } else {
    window.open(file.url, '_blank');
  }
}

/**
 * Download a single file natively via ObjectURL.
 */
async function downloadFile(file) {
  if (!file || !file.url) return;
  resetIdleTimer();

  try {
    const res = await fetch(file.url);
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = file.name || 'document';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  } catch (e) {
    window.open(file.url, '_blank');
  }
}

/**
 * Print All Files sequentially.
 */
btnPrintAll.addEventListener('click', () => {
  if (!currentFiles || currentFiles.length === 0) return;
  resetIdleTimer();
  currentFiles.forEach((file, i) => {
    setTimeout(() => printFile(file), i * 900);
  });
});

/**
 * Download All Files.
 */
btnDownloadAll.addEventListener('click', () => {
  if (!currentFiles || currentFiles.length === 0) return;
  resetIdleTimer();
  currentFiles.forEach((file, i) => {
    setTimeout(() => downloadFile(file), i * 400);
  });
});

/**
 * Reset / Finish session in-place without page reload.
 */
async function resetSession() {
  stopIdleTimer();
  stopPolling();

  const oldCode = currentCode;
  clearStoredSession();
  currentFiles = [];
  currentCode = null;

  // Clear in-place DOM
  receivedFilesList.innerHTML = '';
  receivedThumbnailStrip.innerHTML = '';
  receivedThumbnailStrip.style.display = 'none';

  if (oldCode) {
    try {
      await fetch(`/api/cleanup?code=${oldCode}`, { method: 'DELETE' });
    } catch (e) {
      console.warn('Error during blob cleanup:', e);
    }
  }

  // Smoothly initialize new session in-place
  initSession(true);
}

btnResetReceived.addEventListener('click', resetSession);
btnManualRefresh.addEventListener('click', resetSession);

/**
 * Tab switching (Reference Image 1).
 */
tabReceive.addEventListener('click', () => {
  setViewState(currentFiles.length > 0 ? 'received' : 'idle');
});

tabSend.addEventListener('click', () => {
  setViewState('sending');
  desktopDropzone.style.display = 'block';
  outboundQrContainer.style.display = 'none';
});

btnBackToReceive.addEventListener('click', () => {
  setViewState(currentFiles.length > 0 ? 'received' : 'idle');
});

// Keyboard shortcuts (1: Receive, 2: Send)
window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  if (e.key === '1') tabReceive.click();
  if (e.key === '2') tabSend.click();
});

/**
 * Outbound Mode (Desktop -> Phone).
 */
desktopDropzone.addEventListener('click', () => desktopFileInput.click());
desktopDropzone.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') desktopFileInput.click();
});

desktopFileInput.addEventListener('change', (e) => {
  if (e.target.files && e.target.files.length > 0) {
    handleDesktopFilesUpload(Array.from(e.target.files));
  }
});

async function handleDesktopFilesUpload(files) {
  if (!files || files.length === 0) return;

  if (files.length > 10) {
    alert('Please select a maximum of 10 files at once.');
    return;
  }

  for (const f of files) {
    if (f.size > 50 * 1024 * 1024) {
      alert(`File "${f.name}" exceeds the 50MB limit (${formatBytes(f.size)}). Please choose smaller files.`);
      return;
    }
  }

  desktopDropzone.innerHTML = `<div class="dropzone-title">⏳ Uploading ${files.length} ${files.length === 1 ? 'file' : 'files'}...</div>`;
  setHeaderStatus('warning', 'Uploading...');

  const uploadedFiles = [];

  try {
    for (const file of files) {
      const newBlob = await upload(file.name, file, {
        access: 'public',
        handleUploadUrl: '/api/upload',
        clientPayload: JSON.stringify({
          code: currentCode,
          fileName: file.name,
          mode: 'send',
        }),
      });

      uploadedFiles.push({
        url: newBlob.url,
        pathname: newBlob.pathname,
        name: file.name,
        size: file.size,
        contentType: file.type,
      });
    }

    await fetch('/api/upload-complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: currentCode,
        files: uploadedFiles,
        mode: 'send',
      }),
    });

    desktopDropzone.style.display = 'none';
    outboundQrContainer.style.display = 'block';
    outboundCountChip.textContent = `${uploadedFiles.length} files`;
    outboundFilesList.innerHTML = '';

    uploadedFiles.forEach(f => {
      const info = getFileTypeInfo(f.name);
      const row = document.createElement('div');
      row.className = 'attachment-item';
      row.innerHTML = `
        <div class="attachment-left">
          <div class="file-type-icon ${info.type}">${escapeHtml(info.label)}</div>
          <div class="attachment-name-meta">
            <span class="attachment-name">${escapeHtml(f.name)}</span>
            <span class="attachment-size">${formatBytes(f.size)}</span>
          </div>
        </div>
      `;
      outboundFilesList.appendChild(row);
    });

    const downloadUrl = `${window.location.origin}/mobile?action=download&code=${currentCode}`;
    renderQrCode(qrCanvasSend, downloadUrl);

    setHeaderStatus('online', 'Ready for Phone Download');
    startIdleTimer();
  } catch (err) {
    console.error('Desktop upload failed:', err);
    desktopDropzone.innerHTML = `<div class="dropzone-title" style="color: #e11d48;">❌ Upload failed: ${escapeHtml(err.message)}. Click to retry.</div>`;
    setHeaderStatus('error', 'Upload Error');
  }
}

/**
 * Drag and drop anywhere on screen.
 */
let dragCounter = 0;

window.addEventListener('dragenter', (e) => {
  e.preventDefault();
  dragCounter++;
  dragOverlay.classList.add('active');
});

window.addEventListener('dragleave', (e) => {
  e.preventDefault();
  dragCounter--;
  if (dragCounter <= 0) {
    dragOverlay.classList.remove('active');
    dragCounter = 0;
  }
});

window.addEventListener('dragover', (e) => e.preventDefault());

window.addEventListener('drop', (e) => {
  e.preventDefault();
  dragCounter = 0;
  dragOverlay.classList.remove('active');

  if (e.dataTransfer && e.dataTransfer.files.length > 0) {
    tabSend.click();
    handleDesktopFilesUpload(Array.from(e.dataTransfer.files));
  }
});

/**
 * 3-Minute (180s) Inactivity Timer.
 */
function startIdleTimer() {
  stopIdleTimer();
  updateIdleDisplay();

  idleTimer = setInterval(() => {
    idleTimeRemaining--;
    if (currentCode) saveStoredSession(currentCode, idleTimeRemaining);
    updateIdleDisplay();

    if (idleTimeRemaining <= 0) {
      console.log('3-minute inactivity reached: resetting session.');
      resetSession();
    }
  }, 1000);
}

function stopIdleTimer() {
  if (idleTimer) {
    clearInterval(idleTimer);
    idleTimer = null;
  }
  if (timeoutWarningBanner) timeoutWarningBanner.classList.remove('active');
}

function resetIdleTimer() {
  idleTimeRemaining = TOTAL_IDLE_SECONDS;
  if (currentCode) saveStoredSession(currentCode, idleTimeRemaining);
  updateIdleDisplay();
}

function updateIdleDisplay() {
  const percentage = (idleTimeRemaining / TOTAL_IDLE_SECONDS) * 100;
  
  if (idleTimeoutFill) {
    idleTimeoutFill.style.width = `${percentage}%`;
    idleTimeoutLabel.textContent = `Session active (${idleTimeRemaining}s inactivity reset)`;
  }

  if (timeoutProgress) {
    timeoutProgress.style.width = `${percentage}%`;
    timeoutProgress.className = idleTimeRemaining <= 15 ? 'timeout-bar-fill warning' : 'timeout-bar-fill';
    timeoutLabel.textContent = `Session resets in ${idleTimeRemaining}s of inactivity`;
  }

  if (timeoutWarningBanner) {
    if (idleTimeRemaining <= 15 && (currentState === 'received' || currentState === 'sending')) {
      timeoutWarningBanner.classList.add('active');
    } else {
      timeoutWarningBanner.classList.remove('active');
    }
  }
}

// User interactions reset the 180s countdown
window.addEventListener('click', resetIdleTimer);
window.addEventListener('touchstart', resetIdleTimer);
window.addEventListener('mousemove', resetIdleTimer);

/**
 * Network Connectivity & Captive Portal Monitoring.
 */
function showNetworkBanner(message, isError = false) {
  networkBannerText.textContent = message;
  networkBanner.className = isError ? 'active error' : 'active';
  setHeaderStatus(isError ? 'error' : 'warning', 'Offline / Reconnecting');
}

function hideNetworkBanner() {
  if (networkBanner.classList.contains('active')) {
    networkBanner.classList.remove('active');
    if (currentState === 'idle') setHeaderStatus('online', 'Ready');
    else if (currentState === 'received') setHeaderStatus('online', 'Files Received');
    else if (currentState === 'sending') setHeaderStatus('online', 'Send Mode');
  }
}

function handleNetworkDrop() {
  isOffline = true;
  showNetworkBanner('⚠️ Wi-Fi Disconnected / Packet Loss. Attempting to reconnect...');
}

function handleCaptivePortal() {
  showNetworkBanner('⚠️ Wi-Fi Login Required (Captive Portal detected). Please log in to the network.', true);
}

window.addEventListener('offline', handleNetworkDrop);
window.addEventListener('online', () => {
  isOffline = false;
  hideNetworkBanner();
  if (currentCode) {
    fetch(`/api/status?code=${currentCode}`).then(() => hideNetworkBanner()).catch(() => {});
  }
});

// Periodic ping to verify connectivity
pingInterval = setInterval(async () => {
  try {
    const res = await fetch('/api/ping');
    if (!res.ok) {
      handleCaptivePortal();
      return;
    }
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('application/json')) {
      handleCaptivePortal();
      return;
    }
    if (isOffline) {
      isOffline = false;
      hideNetworkBanner();
    }
  } catch (e) {
    // Network drop caught in fetch
  }
}, 10000);

// Initialize or resume on page load
initSession(false);
