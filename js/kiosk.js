import { createClient } from '/js/vendor/supabase.min.js';

// Constants
const SESSION_STORAGE_KEY = 'kiosk_station_session_v5';
const TOTAL_IDLE_SECONDS = 180; // 3 minutes

// Global state
let currentCode = null;
let currentFiles = [];
let stagedOutboundFiles = [];
let currentState = 'receive'; // 'receive' | 'received' | 'sending'
let supabaseClient = null;
let realtimeChannel = null;
let pollInterval = null;
let idleTimer = null;
let idleTimeRemaining = TOTAL_IDLE_SECONDS;

// DOM Elements
const displayCode = document.getElementById('display-code');
const qrCanvasReceive = document.getElementById('qr-canvas-receive');
const qrCanvasSend = document.getElementById('qr-canvas-send');
const statusDot = document.getElementById('status-dot');
const statusLabel = document.getElementById('status-label');

const tabReceive = document.getElementById('tab-receive');
const tabSend = document.getElementById('tab-send');
const tabReset = document.getElementById('tab-reset');

const viewReceive = document.getElementById('view-receive');
const viewReceived = document.getElementById('view-received');
const viewSending = document.getElementById('view-sending');

const btnTriggerSendMode = document.getElementById('btn-trigger-send-mode');

const receivedFilesList = document.getElementById('received-files-list');
const receivedThumbnailGrid = document.getElementById('received-thumbnail-grid');
const btnPrintAll = document.getElementById('btn-print-all');
const btnDownloadAll = document.getElementById('btn-download-all');
const btnResetReceived = document.getElementById('btn-reset-received');

const desktopFileInput = document.getElementById('desktop-file-input');
const desktopDropzone = document.getElementById('desktop-dropzone');
const outboundAttachmentsContainer = document.getElementById('outbound-attachments-container');
const outboundFilesList = document.getElementById('outbound-files-list');
const outboundThumbnailGrid = document.getElementById('outbound-thumbnail-grid');
const outboundQrContainer = document.getElementById('outbound-qr-container');

const dragOverlay = document.getElementById('drag-overlay');
const idleTimeoutLabel = document.getElementById('idle-timeout-label');
const printIframe = document.getElementById('print-iframe');

/**
 * Fetch public config and instantiate Supabase client
 */
async function getSupabaseClient() {
  if (supabaseClient) return supabaseClient;
  try {
    const res = await fetch('/api/config');
    if (res.ok) {
      const { supabaseUrl, supabaseAnonKey } = await res.json();
      if (supabaseUrl && supabaseAnonKey) {
        supabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
          auth: { persistSession: false },
        });
      }
    }
  } catch (err) {
    console.warn('[kiosk] Could not fetch Supabase config:', err);
  }
  return supabaseClient;
}

/**
 * Persist active session across browser refreshes.
 */
function getStoredSession() {
  try {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (Date.now() >= data.expiresAt) {
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

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = String(str);
  return div.innerHTML;
}

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function getFileIcon(filename = '') {
  const ext = filename.split('.').pop().toLowerCase();
  if (['pdf'].includes(ext)) return '📎';
  if (['ppt', 'pptx', 'key'].includes(ext)) return '📊';
  if (['doc', 'docx', 'odt', 'txt', 'rtf'].includes(ext)) return '📄';
  if (['xls', 'xlsx', 'csv'].includes(ext)) return '📈';
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return '🗜️';
  if (['mp3', 'wav', 'm4a', 'aac'].includes(ext)) return '🎙️';
  return '📎';
}

function isImageFile(filename = '') {
  const ext = filename.split('.').pop().toLowerCase();
  return ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'heic', 'svg'].includes(ext);
}

function setHeaderStatus(type, text) {
  if (!statusDot || !statusLabel) return;
  statusDot.className = 'status-dot ' + type;
  statusLabel.textContent = text;
}

function updateTabs(activeState) {
  tabReceive.classList.toggle('active', activeState === 'receive' || activeState === 'received');
  tabReceive.setAttribute('aria-selected', activeState === 'receive' || activeState === 'received');

  tabSend.classList.toggle('active', activeState === 'sending');
  tabSend.setAttribute('aria-selected', activeState === 'sending');

  tabReset.classList.remove('active');
  tabReset.setAttribute('aria-selected', 'false');
}

function setViewState(state) {
  currentState = state;
  viewReceive.classList.remove('active');
  viewReceived.classList.remove('active');
  viewSending.classList.remove('active');

  updateTabs(state);

  if (state === 'receive') {
    viewReceive.classList.add('active');
    setHeaderStatus('online', 'Ready for Files');
    startIdleTimer();
  } else if (state === 'received') {
    viewReceived.classList.add('active');
    setHeaderStatus('online', 'Files Ready');
    startIdleTimer();
  } else if (state === 'sending') {
    viewSending.classList.add('active');
    setHeaderStatus('online', 'Send Mode');
    startIdleTimer();
  }
}

function renderQrCode(canvas, text) {
  if (!canvas || !text) return;
  if (window.QRCode && typeof window.QRCode.toCanvas === 'function') {
    try {
      window.QRCode.toCanvas(canvas, text, {
        width: 160,
        margin: 1,
        color: { dark: '#0f172a', light: '#ffffff' },
      }, (err) => {
        if (err) console.error('QR rendering error:', err);
      });
    } catch (e) {
      console.error('Failed to draw QR code:', e);
    }
  } else {
    setTimeout(() => renderQrCode(canvas, text), 150);
  }
}

/**
 * Real-Time Supabase WebSocket Listener
 */
async function setupRealtimeListener(code) {
  if (realtimeChannel) {
    try { realtimeChannel.unsubscribe(); } catch (e) {}
    realtimeChannel = null;
  }

  const client = await getSupabaseClient();
  if (!client) {
    console.log('[kiosk] Supabase client initializing; gentle poll active');
    return;
  }

  try {
    realtimeChannel = client
      .channel(`session:${code}`)
      .on('broadcast', { event: 'files_uploaded' }, (payload) => {
        const files = payload?.payload?.files;
        if (Array.isArray(files) && files.length > 0) {
          currentFiles = files;
          onFilesReceived(currentFiles);
        }
      })
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'sessions',
        filter: `code=eq.${code}`
      }, (payload) => {
        const session = payload.new;
        if (session && session.status === 'uploaded' && Array.isArray(session.files) && session.files.length > 0) {
          currentFiles = session.files;
          onFilesReceived(session.files);
        }
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          setHeaderStatus('online', 'Synchronized');
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          setHeaderStatus('warning', 'Connecting...');
        }
      });
  } catch (e) {
    console.warn('[kiosk] Realtime subscribe error:', e);
  }
}

/**
 * Gentle 4-second Polling Fallback (Costs 0 storage operations)
 */
function startPollingFallback() {
  stopPollingFallback();
  pollInterval = setInterval(async () => {
    if (!currentCode) return;
    try {
      const res = await fetch(`/api/status?code=${currentCode}&t=${Date.now()}`);
      if (!res.ok) return;
      const data = await res.json();
      const files = Array.isArray(data.files) && data.files.length > 0
        ? data.files
        : data.file ? [data.file] : [];

      if (data.status === 'uploaded' && files.length > 0) {
        if (JSON.stringify(files) !== JSON.stringify(currentFiles)) {
          currentFiles = files;
          onFilesReceived(files);
        }
      }
    } catch (e) {
      setHeaderStatus('warning', 'Reconnecting...');
    }
  }, 4000);
}

function stopPollingFallback() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
}

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

      setupRealtimeListener(currentCode);
      startPollingFallback();

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
            return;
          }
        }
      } catch (e) {}

      setViewState('receive');
      return;
    }
  }

  try {
    setHeaderStatus('warning', 'Connecting...');
    const res = await fetch('/api/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'receive' }),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    currentCode = data.code;
    displayCode.textContent = currentCode;
    saveStoredSession(currentCode, TOTAL_IDLE_SECONDS);

    const mobileUrl = `${window.location.origin}/mobile?code=${currentCode}`;
    renderQrCode(qrCanvasReceive, mobileUrl);

    setupRealtimeListener(currentCode);
    startPollingFallback();
    setViewState('receive');
    setHeaderStatus('online', 'Ready');
  } catch (err) {
    console.error('Failed to initialize session:', err);
    setHeaderStatus('error', 'Connection Error');
    setTimeout(() => initSession(true), 3000);
  }
}

/**
 * EXACT REFERENCE IMAGE 2 RENDERING FOR RECEIVED FILES
 */
function onFilesReceived(files) {
  receivedFilesList.innerHTML = '';
  receivedThumbnailGrid.innerHTML = '';
  let imageCount = 0;

  files.forEach((file, idx) => {
    const isImg = isImageFile(file.name);
    const safeName = escapeHtml(file.name);

    if (isImg && file.url) {
      imageCount++;
      const thumb = document.createElement('div');
      thumb.className = 'ref-thumb-card';
      thumb.innerHTML = `
        <img src="${file.url}" alt="${safeName}" class="ref-thumb-img" loading="lazy">
        <span class="ref-thumb-size">${formatBytes(file.size)}</span>
      `;
      receivedThumbnailGrid.appendChild(thumb);
    }

    const pill = document.createElement('div');
    pill.className = 'ref-pill-row';
    const icon = getFileIcon(file.name);

    pill.innerHTML = `
      <div class="ref-pill-left">
        <span class="ref-pill-icon">${icon}</span>
        <span class="ref-pill-name" title="${safeName}">${safeName}</span>
      </div>
      <div class="ref-pill-right">
        <span class="ref-pill-size">${formatBytes(file.size)}</span>
        <button class="ref-pill-action btn-print-single" data-index="${idx}" title="Print" type="button">🖨️</button>
        <button class="ref-pill-action btn-download-single" data-index="${idx}" title="Save" type="button">↓</button>
      </div>
    `;

    receivedFilesList.appendChild(pill);
  });

  receivedThumbnailGrid.style.display = imageCount > 0 ? 'flex' : 'none';

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

btnPrintAll.addEventListener('click', () => {
  if (!currentFiles || currentFiles.length === 0) return;
  resetIdleTimer();
  currentFiles.forEach((file, i) => {
    setTimeout(() => printFile(file), i * 900);
  });
});

btnDownloadAll.addEventListener('click', () => {
  if (!currentFiles || currentFiles.length === 0) return;
  resetIdleTimer();
  currentFiles.forEach((file, i) => {
    setTimeout(() => downloadFile(file), i * 400);
  });
});

async function resetSession() {
  stopIdleTimer();
  stopPollingFallback();
  if (realtimeChannel) {
    try { realtimeChannel.unsubscribe(); } catch (e) {}
    realtimeChannel = null;
  }

  const oldCode = currentCode;
  clearStoredSession();
  currentFiles = [];
  stagedOutboundFiles = [];
  currentCode = null;

  receivedFilesList.innerHTML = '';
  receivedThumbnailGrid.innerHTML = '';
  receivedThumbnailGrid.style.display = 'none';

  if (oldCode) {
    try {
      await fetch('/api/cleanup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: oldCode }),
      });
    } catch (e) {}
  }

  initSession(true);
}

btnResetReceived.addEventListener('click', resetSession);

/**
 * Tab Navigation (Reference Image 1)
 */
tabReceive.addEventListener('click', () => {
  setViewState(currentFiles.length > 0 ? 'received' : 'receive');
});

tabSend.addEventListener('click', () => {
  setViewState('sending');
  outboundQrContainer.style.display = stagedOutboundFiles.length > 0 ? 'block' : 'none';
  outboundAttachmentsContainer.style.display = stagedOutboundFiles.length > 0 ? 'block' : 'none';
});

tabReset.addEventListener('click', resetSession);

/**
 * Keyboard Shortcuts matching Reference Image 1: Shift + 1, Shift + 2, Shift + 3
 */
window.addEventListener('keydown', (e) => {
  if (e.shiftKey) {
    if (e.key === '!' || e.key === '1') {
      e.preventDefault();
      setViewState(currentFiles.length > 0 ? 'received' : 'receive');
    } else if (e.key === '@' || e.key === '2') {
      e.preventDefault();
      setViewState('sending');
    } else if (e.key === '#' || e.key === '3') {
      e.preventDefault();
      resetSession();
    }
  }
});

/**
 * Transforming Dropzone Trigger
 */
btnTriggerSendMode.addEventListener('click', () => {
  setViewState('sending');
  desktopFileInput.click();
});

desktopDropzone.addEventListener('click', () => desktopFileInput.click());
desktopFileInput.addEventListener('change', (e) => {
  if (e.target.files && e.target.files.length > 0) {
    handleDesktopFilesUpload(Array.from(e.target.files));
  }
});

async function handleDesktopFilesUpload(files) {
  if (!files || files.length === 0) return;

  for (const f of files) {
    if (f.size > 50 * 1024 * 1024) {
      alert(`"${f.name}" exceeds the 50MB limit.`);
      return;
    }
  }

  setHeaderStatus('warning', 'Uploading...');
  const client = await getSupabaseClient();
  if (!client) {
    alert('Connecting to Supabase storage...');
    return;
  }

  const uploadedFiles = [];

  try {
    for (const file of files) {
      const cleanName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const storagePath = `${currentCode}/${Date.now()}_${cleanName}`;

      const { data, error } = await client.storage
        .from('documents')
        .upload(storagePath, file, { cacheControl: '3600', upsert: true });

      if (error) throw error;

      const { data: publicData } = client.storage
        .from('documents')
        .getPublicUrl(storagePath);

      uploadedFiles.push({
        url: publicData.publicUrl,
        storagePath: storagePath,
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

    if (realtimeChannel) {
      try {
        realtimeChannel.send({
          type: 'broadcast',
          event: 'files_uploaded',
          payload: { code: currentCode, files: uploadedFiles },
        });
      } catch (e) {}
    }

    stagedOutboundFiles = [...stagedOutboundFiles, ...uploadedFiles];
    renderOutboundAttachments();

    outboundQrContainer.style.display = 'block';
    const downloadUrl = `${window.location.origin}/mobile?action=download&code=${currentCode}`;
    renderQrCode(qrCanvasSend, downloadUrl);

    setHeaderStatus('online', 'Ready for Mobile Download');
    startIdleTimer();
  } catch (err) {
    alert(`Upload failed: ${err.message}`);
    setHeaderStatus('error', 'Upload Error');
  }
}

/**
 * EXACT REFERENCE IMAGE 2 RENDERING FOR OUTBOUND STAGED FILES
 */
function renderOutboundAttachments() {
  if (stagedOutboundFiles.length === 0) {
    outboundAttachmentsContainer.style.display = 'none';
    return;
  }

  outboundAttachmentsContainer.style.display = 'block';
  outboundFilesList.innerHTML = '';
  outboundThumbnailGrid.innerHTML = '';
  let imageCount = 0;

  stagedOutboundFiles.forEach((file, idx) => {
    const isImg = isImageFile(file.name);
    const safeName = escapeHtml(file.name);

    if (isImg && file.url) {
      imageCount++;
      const thumb = document.createElement('div');
      thumb.className = 'ref-thumb-card';
      thumb.innerHTML = `
        <img src="${file.url}" alt="${safeName}" class="ref-thumb-img">
        <button class="ref-thumb-close" data-index="${idx}" title="Remove">✕</button>
        <span class="ref-thumb-size">${formatBytes(file.size)}</span>
      `;
      outboundThumbnailGrid.appendChild(thumb);
    }

    const pill = document.createElement('div');
    pill.className = 'ref-pill-row';
    const icon = getFileIcon(file.name);

    pill.innerHTML = `
      <div class="ref-pill-left">
        <span class="ref-pill-icon">${icon}</span>
        <span class="ref-pill-name" title="${safeName}">${safeName}</span>
      </div>
      <div class="ref-pill-right">
        <span class="ref-pill-size">${formatBytes(file.size)}</span>
        <button class="ref-pill-remove" data-index="${idx}" title="Remove" type="button">✕</button>
      </div>
    `;

    outboundFilesList.appendChild(pill);
  });

  const addCard = document.createElement('div');
  addCard.className = 'ref-add-card';
  addCard.innerHTML = '+';
  addCard.title = 'Add more files';
  addCard.addEventListener('click', () => desktopFileInput.click());
  outboundThumbnailGrid.appendChild(addCard);

  outboundThumbnailGrid.style.display = 'flex';

  outboundFilesList.querySelectorAll('.ref-pill-remove').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.getAttribute('data-index'), 10);
      stagedOutboundFiles.splice(idx, 1);
      renderOutboundAttachments();
    });
  });

  outboundThumbnailGrid.querySelectorAll('.ref-thumb-close').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.getAttribute('data-index'), 10);
      stagedOutboundFiles.splice(idx, 1);
      renderOutboundAttachments();
    });
  });
}

/**
 * Drag & drop anywhere transforms to Send mode
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
    setViewState('sending');
    handleDesktopFilesUpload(Array.from(e.dataTransfer.files));
  }
});

/**
 * Inactivity Timer
 */
function startIdleTimer() {
  stopIdleTimer();
  updateIdleDisplay();

  idleTimer = setInterval(() => {
    idleTimeRemaining--;
    if (currentCode) saveStoredSession(currentCode, idleTimeRemaining);
    updateIdleDisplay();

    if (idleTimeRemaining <= 0) {
      resetSession();
    }
  }, 1000);
}

function stopIdleTimer() {
  if (idleTimer) {
    clearInterval(idleTimer);
    idleTimer = null;
  }
}

function resetIdleTimer() {
  idleTimeRemaining = TOTAL_IDLE_SECONDS;
  if (currentCode) saveStoredSession(currentCode, idleTimeRemaining);
  updateIdleDisplay();
}

function updateIdleDisplay() {
  if (idleTimeoutLabel) {
    idleTimeoutLabel.textContent = `${idleTimeRemaining}s`;
  }
}

window.addEventListener('click', resetIdleTimer);
window.addEventListener('touchstart', resetIdleTimer);
window.addEventListener('mousemove', resetIdleTimer);

window.addEventListener('offline', () => setHeaderStatus('warning', 'Reconnecting...'));
window.addEventListener('online', () => {
  if (currentCode) setupRealtimeListener(currentCode);
});

// Initialize on page load
initSession(false);
