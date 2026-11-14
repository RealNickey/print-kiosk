import { upload } from '/js/vendor/blob-client.js';

// Global state
let currentCode = null;
let currentFiles = [];
let currentState = 'idle'; // 'idle' | 'received' | 'sending'
let pollInterval = null;
let pingInterval = null;
let idleTimer = null;
let idleTimeRemaining = 180; // 3 minutes as requested
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
 * Update the header status indicator.
 */
function setHeaderStatus(type, text) {
  if (!statusDot || !statusLabel) return;
  statusDot.className = 'status-dot ' + type;
  statusLabel.textContent = text;
}

/**
 * Switch view state.
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
    console.warn('QRCode library not ready yet, retrying in 200ms...');
    setTimeout(() => renderQrCode(canvas, text), 200);
  }
}

/**
 * Initialize a new session from the server.
 */
async function initSession() {
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
    displayCode.textContent = currentCode;

    // Mobile URL pointing directly to the companion page with pre-bound code
    const mobileUrl = `${window.location.origin}/mobile.html?code=${currentCode}`;
    renderQrCode(qrCanvasReceive, mobileUrl);

    setViewState('idle');
    startPolling();
  } catch (err) {
    console.error('Failed to init session:', err);
    setHeaderStatus('error', 'Error');
    showNetworkBanner('⚠️ Failed to generate session. Checking connection...');
    setTimeout(initSession, 4000);
  }
}

/**
 * Polling loop to check for incoming uploads.
 * Only resets on 180s timeout, print/download completion, or manual trigger.
 * Temporary 404s are NOT allowed to destroy the session.
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
          // Only re-init if 404 persists continuously for > 40 seconds (20 polls)
          if (consecutive404Count > 20) {
            console.warn('Persistent 404. Re-initializing session...');
            initSession();
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
 * Render received files (Reference Image 2 layout).
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

    item.innerHTML = `
      <div class="attachment-left">
        <div class="file-type-icon ${fileInfo.type}">${fileInfo.label}</div>
        <div class="attachment-name-meta">
          <span class="attachment-name" title="${file.name}">${file.name}</span>
          <span class="attachment-size">${formatBytes(file.size)}</span>
        </div>
      </div>
      <div class="attachment-actions">
        ${isPrintable ? `<button class="btn-icon-action btn-print-single" data-index="${idx}" type="button">🖨️ Print</button>` : ''}
        <button class="btn-icon-action btn-download-single" data-index="${idx}" type="button">💾 Save</button>
      </div>
    `;

    receivedFilesList.appendChild(item);

    // If image, add to thumbnail strip
    if (isImage && file.url) {
      hasImages = true;
      const thumb = document.createElement('div');
      thumb.className = 'thumbnail-card';
      thumb.innerHTML = `
        <img src="${file.url}" alt="${file.name}" loading="lazy">
        <span class="thumbnail-badge">${formatBytes(file.size)}</span>
      `;
      receivedThumbnailStrip.appendChild(thumb);
    }
  });

  receivedThumbnailStrip.style.display = hasImages ? 'flex' : 'none';

  // Attach individual button listeners
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
 * Download a single file.
 */
function downloadFile(file) {
  if (!file || !file.url) return;
  resetIdleTimer();
  const a = document.createElement('a');
  a.href = file.url;
  a.download = file.name || 'download';
  a.target = '_blank';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

/**
 * Print All Files.
 */
btnPrintAll.addEventListener('click', () => {
  if (!currentFiles || currentFiles.length === 0) return;
  resetIdleTimer();
  currentFiles.forEach((file, i) => {
    setTimeout(() => printFile(file), i * 800);
  });
});

/**
 * Download All Files.
 */
btnDownloadAll.addEventListener('click', () => {
  if (!currentFiles || currentFiles.length === 0) return;
  resetIdleTimer();
  currentFiles.forEach((file, i) => {
    setTimeout(() => downloadFile(file), i * 300);
  });
});

/**
 * Reset / Finish session and purge files from Blob.
 */
async function resetSession() {
  stopIdleTimer();
  stopPolling();

  if (currentCode) {
    try {
      await fetch(`/api/cleanup?code=${currentCode}`, { method: 'DELETE' });
    } catch (e) {
      console.warn('Error during blob cleanup:', e);
    }
  }

  currentFiles = [];
  currentCode = null;
  initSession();
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

// Keyboard shortcuts (Shift+1, Shift+2, or 1/2)
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

  // Validation: Max 50MB per file
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

    // Complete batch
    await fetch('/api/upload-complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: currentCode,
        files: uploadedFiles,
        mode: 'send',
      }),
    });

    // Show outbound QR code
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
          <div class="file-type-icon ${info.type}">${info.label}</div>
          <div class="attachment-name-meta">
            <span class="attachment-name">${f.name}</span>
            <span class="attachment-size">${formatBytes(f.size)}</span>
          </div>
        </div>
      `;
      outboundFilesList.appendChild(row);
    });

    const downloadUrl = `${window.location.origin}/mobile.html?action=download&code=${currentCode}`;
    renderQrCode(qrCanvasSend, downloadUrl);

    setHeaderStatus('online', 'Ready for Phone Download');
    startIdleTimer();
  } catch (err) {
    console.error('Desktop upload failed:', err);
    desktopDropzone.innerHTML = `<div class="dropzone-title" style="color: #e11d48;">❌ Upload failed: ${err.message}. Click to retry.</div>`;
    setHeaderStatus('error', 'Upload Error');
  }
}

/**
 * Drag and drop anywhere on the screen.
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
  idleTimeRemaining = 180;
  updateIdleDisplay();

  idleTimer = setInterval(() => {
    idleTimeRemaining--;
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
  idleTimeRemaining = 180;
  updateIdleDisplay();
}

function updateIdleDisplay() {
  const percentage = (idleTimeRemaining / 180) * 100;
  
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

// User interactions reset the 180s inactivity countdown
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

// Initialize on page load
initSession();
