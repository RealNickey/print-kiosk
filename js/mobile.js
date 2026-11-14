import { createClient } from '/js/vendor/supabase.min.js';

// Session storage keys
const MOBILE_CODE_KEY = 'kiosk_mobile_code';
const MOBILE_JOB_KEY = 'kiosk_mobile_job';

// State variables
let currentCode = null;
let currentJobId = null;
let stagedFilesStandard = [];
let stagedFilesPreupload = [];
let html5QrCodeScanner = null;
let supabaseClient = null;

// DOM Elements
const badgeKioskCode = document.getElementById('badge-kiosk-code');

// Flow A
const cardStandard = document.getElementById('card-standard');
const fileInputStandard = document.getElementById('file-input-standard');
const dropzoneStandard = document.getElementById('dropzone-standard');
const attachmentContainerStandard = document.getElementById('attachment-container-standard');
const attachmentListStandard = document.getElementById('attachment-list-standard');
const thumbnailGridStandard = document.getElementById('thumbnail-grid-standard');
const progressStandard = document.getElementById('progress-standard');
const progressFillStandard = document.getElementById('progress-fill-standard');
const progressTextStandard = document.getElementById('progress-text-standard');
const btnSendStandard = document.getElementById('btn-send-standard');

// Flow B
const cardPreupload = document.getElementById('card-preupload');
const preuploadStepFile = document.getElementById('preupload-step-file');
const preuploadStepBind = document.getElementById('preupload-step-bind');
const fileInputPreupload = document.getElementById('file-input-preupload');
const dropzonePreupload = document.getElementById('dropzone-preupload');
const attachmentContainerPreupload = document.getElementById('attachment-container-preupload');
const attachmentListPreupload = document.getElementById('attachment-list-preupload');
const thumbnailGridPreupload = document.getElementById('thumbnail-grid-preupload');
const progressPreupload = document.getElementById('progress-preupload');
const progressFillPreupload = document.getElementById('progress-fill-preupload');
const progressTextPreupload = document.getElementById('progress-text-preupload');
const btnPreuploadFile = document.getElementById('btn-preupload-file');
const btnScanQr = document.getElementById('btn-scan-qr');
const manualCodeInput = document.getElementById('manual-code-input');
const btnBindCode = document.getElementById('btn-bind-code');

// Flow C
const cardDownload = document.getElementById('card-download');
const downloadFilesList = document.getElementById('download-files-list');
const btnDownloadAllMobile = document.getElementById('btn-download-all-mobile');

// Flow D
const cardSuccess = document.getElementById('card-success');
const btnSendAnother = document.getElementById('btn-send-another');

// Scanner Modal
const qrScannerModal = document.getElementById('qr-scanner-modal');
const btnCancelScanner = document.getElementById('btn-cancel-scanner');

// Dangerous extensions
const DANGEROUS_EXTS = /\.(exe|bat|cmd|sh|js|mjs|cjs|vbs|ps1|scr|msi|jar|apk|com|pif|hta|html|htm|php|cgi)$/i;

/**
 * Fetch public config and instantiate Supabase client
 */
async function getSupabaseClient() {
  if (supabaseClient) return supabaseClient;
  try {
    const res = await fetch('/api/config');
    if (!res.ok) return null;
    const config = await res.json();
    if (config.supabaseUrl && config.supabaseAnonKey) {
      supabaseClient = createClient(config.supabaseUrl, config.supabaseAnonKey);
      return supabaseClient;
    }
  } catch (e) {
    console.warn('Failed to load Supabase client config:', e);
  }
  return null;
}

/**
 * Resilient Upload Handler: Tries direct Supabase storage upload;
 * if RLS policy blocks it, falls back to server-side relay using service role.
 */
async function uploadFileSmart(file, code) {
  const client = await getSupabaseClient();
  const cleanName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const storagePath = `${code}/${Date.now()}_${cleanName}`;

  if (client) {
    try {
      const { data, error } = await client.storage
        .from('documents')
        .upload(storagePath, file, { cacheControl: '3600', upsert: true });

      if (!error && data) {
        const { data: publicData } = client.storage
          .from('documents')
          .getPublicUrl(storagePath);

        return {
          url: publicData.publicUrl,
          storagePath,
          name: file.name,
          size: file.size,
          contentType: file.type || 'application/octet-stream',
        };
      }
      console.warn('[upload] Direct upload encountered an issue, trying server relay:', error?.message);
    } catch (e) {
      console.warn('[upload] Direct upload exception, trying server relay:', e.message);
    }
  }

  // Fallback: upload via serverless endpoint with service role (bypasses RLS)
  const res = await fetch(`/api/upload-file?code=${encodeURIComponent(code)}&name=${encodeURIComponent(file.name)}`, {
    method: 'POST',
    headers: {
      'Content-Type': file.type || 'application/octet-stream',
      'X-Kiosk-Code': code,
      'X-File-Name': encodeURIComponent(file.name),
    },
    body: file,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Upload failed (HTTP ${res.status})`);
  }

  return await res.json();
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
  if (['ppt', 'pptx'].includes(ext)) return '📊';
  if (['doc', 'docx', 'txt'].includes(ext)) return '📄';
  if (['xls', 'xlsx', 'csv'].includes(ext)) return '📈';
  if (['zip', 'rar', '7z'].includes(ext)) return '🗜️';
  return '📎';
}

function isImageFile(filename = '') {
  const ext = filename.split('.').pop().toLowerCase();
  return ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'heic', 'svg'].includes(ext);
}

function validateFiles(fileList) {
  const files = Array.from(fileList);
  if (files.length > 10) {
    alert('Please select a maximum of 10 files at once.');
    return [];
  }

  const valid = [];
  for (const f of files) {
    if (f.size > 50 * 1024 * 1024) {
      alert(`"${f.name}" exceeds 50MB limit.`);
      continue;
    }
    if (DANGEROUS_EXTS.test(f.name)) {
      alert(`"${f.name}" has an unsafe file extension.`);
      continue;
    }
    valid.push(f);
  }
  return valid;
}

/**
 * EXACT REFERENCE IMAGE 2 RENDERING ON MOBILE
 */
function renderStagedList(container, listEl, gridEl, filesArray, onRemove, onAdd) {
  if (filesArray.length === 0) {
    container.style.display = 'none';
    listEl.innerHTML = '';
    if (gridEl) gridEl.innerHTML = '';
    return;
  }

  container.style.display = 'flex';
  listEl.innerHTML = '';
  if (gridEl) gridEl.innerHTML = '';
  let imageCount = 0;

  filesArray.forEach((file, idx) => {
    const isImg = isImageFile(file.name);
    const safeName = escapeHtml(file.name);

    if (isImg && gridEl) {
      imageCount++;
      const thumb = document.createElement('div');
      thumb.className = 'ref-thumb-card';
      const imgUrl = file instanceof File ? URL.createObjectURL(file) : (file.url || '');
      thumb.innerHTML = `
        <img src="${imgUrl}" alt="${safeName}" class="ref-thumb-img">
        <button class="ref-thumb-close" data-index="${idx}">✕</button>
        <span class="ref-thumb-size">${formatBytes(file.size)}</span>
      `;
      gridEl.appendChild(thumb);
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
        <button class="ref-pill-remove" data-index="${idx}">✕</button>
      </div>
    `;
    listEl.appendChild(pill);
  });

  if (gridEl) {
    // Append '+' card matching Reference Image 2
    const addCard = document.createElement('div');
    addCard.className = 'ref-add-card';
    addCard.innerHTML = '+';
    addCard.title = 'Add more files';
    addCard.addEventListener('click', onAdd);
    gridEl.appendChild(addCard);
    gridEl.style.display = 'flex';
  }

  listEl.querySelectorAll('.ref-pill-remove').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.getAttribute('data-index'), 10);
      onRemove(idx);
    });
  });

  if (gridEl) {
    gridEl.querySelectorAll('.ref-thumb-close').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.getAttribute('data-index'), 10);
        onRemove(idx);
      });
    });
  }
}

/**
 * Initialize companion app
 */
function init() {
  const urlParams = new URLSearchParams(window.location.search);
  let code = urlParams.get('code');
  const action = urlParams.get('action');

  if (!code) {
    code = sessionStorage.getItem(MOBILE_CODE_KEY);
  } else {
    sessionStorage.setItem(MOBILE_CODE_KEY, code.trim());
  }

  if (action === 'download' && code) {
    initDownloadFlow(code.trim());
  } else if (code && /^\d{4}$/.test(code.trim())) {
    initStandardFlow(code.trim());
  } else {
    initPreuploadFlow();
  }
}

/**
 * FLOW A: Standard QR Scan Flow
 */
function initStandardFlow(code) {
  currentCode = code;
  badgeKioskCode.textContent = `KIOSK #${currentCode}`;
  cardStandard.classList.add('active');

  dropzoneStandard.addEventListener('click', () => fileInputStandard.click());

  fileInputStandard.addEventListener('change', (e) => {
    if (e.target.files && e.target.files.length > 0) {
      const valid = validateFiles(e.target.files);
      stagedFilesStandard = [...stagedFilesStandard, ...valid].slice(0, 10);
      updateStandardList();
    }
  });

  function updateStandardList() {
    renderStagedList(
      attachmentContainerStandard,
      attachmentListStandard,
      thumbnailGridStandard,
      stagedFilesStandard,
      (idx) => {
        stagedFilesStandard.splice(idx, 1);
        updateStandardList();
      },
      () => fileInputStandard.click()
    );
    btnSendStandard.disabled = stagedFilesStandard.length === 0;
    btnSendStandard.textContent = stagedFilesStandard.length > 0
      ? `📤 Send to Kiosk (${stagedFilesStandard.length})`
      : '📤 Send to Kiosk';
  }

  btnSendStandard.addEventListener('click', async () => {
    if (stagedFilesStandard.length === 0) return;

    btnSendStandard.disabled = true;
    progressStandard.style.display = 'block';
    progressFillStandard.style.width = '10%';
    progressTextStandard.textContent = `Connecting to storage...`;

    const client = await getSupabaseClient();
    if (!client) {
      alert('Supabase is not configured yet. Please verify server settings.');
      btnSendStandard.disabled = false;
      progressStandard.style.display = 'none';
      return;
    }

    const uploaded = [];

    try {
      // Notify kiosk that upload is in progress (switches to transferring state & mascot)
      try {
        const notifyChannel = client.channel(`session:${currentCode}`);
        await notifyChannel.subscribe();
        notifyChannel.send({
          type: 'broadcast',
          event: 'transfer_started',
          payload: { code: currentCode },
        });
      } catch (e) {
        console.warn('Realtime notify warning:', e);
      }

      for (let i = 0; i < stagedFilesStandard.length; i++) {
        const file = stagedFilesStandard[i];
        progressTextStandard.textContent = `Uploading ${i + 1} of ${stagedFilesStandard.length}: ${file.name}...`;

        const fileRecord = await uploadFileSmart(file, currentCode);
        uploaded.push(fileRecord);

        const percent = Math.round(((i + 1) / stagedFilesStandard.length) * 85);
        progressFillStandard.style.width = `${percent}%`;
      }

      progressTextStandard.textContent = 'Registering with kiosk...';

      // 1. Complete upload via API
      await fetch('/api/upload-complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: currentCode,
          files: uploaded,
          mode: 'receive',
        }),
      });

      // 2. Broadcast push update to kiosk screen over Realtime WebSocket
      try {
        const channel = client.channel(`session:${currentCode}`);
        await channel.subscribe();
        channel.send({
          type: 'broadcast',
          event: 'files_uploaded',
          payload: { code: currentCode, files: uploaded },
        });
      } catch (e) {
        console.warn('Realtime broadcast warning:', e);
      }

      progressFillStandard.style.width = '100%';
      progressTextStandard.textContent = 'Upload Complete!';

      setTimeout(() => {
        cardStandard.classList.remove('active');
        cardSuccess.classList.add('active');
      }, 400);
    } catch (err) {
      alert(`Upload failed: ${err.message}`);
      btnSendStandard.disabled = false;
      progressStandard.style.display = 'none';
    }
  });
}

/**
 * FLOW B: Pre-Upload Flow
 */
function initPreuploadFlow() {
  cardPreupload.classList.add('active');

  const storedJob = sessionStorage.getItem(MOBILE_JOB_KEY);
  if (storedJob) {
    currentJobId = storedJob;
    preuploadStepFile.style.display = 'none';
    btnPreuploadFile.style.display = 'none';
    preuploadStepBind.style.display = 'flex';
    btnBindCode.style.display = 'flex';
  }

  dropzonePreupload.addEventListener('click', () => fileInputPreupload.click());

  fileInputPreupload.addEventListener('change', (e) => {
    if (e.target.files && e.target.files.length > 0) {
      const valid = validateFiles(e.target.files);
      stagedFilesPreupload = [...stagedFilesPreupload, ...valid].slice(0, 10);
      updatePreuploadList();
    }
  });

  function updatePreuploadList() {
    renderStagedList(
      attachmentContainerPreupload,
      attachmentListPreupload,
      thumbnailGridPreupload,
      stagedFilesPreupload,
      (idx) => {
        stagedFilesPreupload.splice(idx, 1);
        updatePreuploadList();
      },
      () => fileInputPreupload.click()
    );
    btnPreuploadFile.disabled = stagedFilesPreupload.length === 0;
    btnPreuploadFile.textContent = stagedFilesPreupload.length > 0
      ? `Upload ${stagedFilesPreupload.length} Files`
      : 'Upload Files';
  }

  btnPreuploadFile.addEventListener('click', async () => {
    if (stagedFilesPreupload.length === 0) return;

    btnPreuploadFile.disabled = true;
    progressPreupload.style.display = 'block';
    progressFillPreupload.style.width = '10%';
    currentJobId = 'job_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
    sessionStorage.setItem(MOBILE_JOB_KEY, currentJobId);

    const client = await getSupabaseClient();
    if (!client) {
      alert('Supabase is not configured yet.');
      btnPreuploadFile.disabled = false;
      progressPreupload.style.display = 'none';
      return;
    }

    const uploaded = [];

    try {
      for (let i = 0; i < stagedFilesPreupload.length; i++) {
        const file = stagedFilesPreupload[i];
        progressTextPreupload.textContent = `Uploading ${i + 1} of ${stagedFilesPreupload.length}: ${file.name}...`;

        const fileRecord = await uploadFileSmart(file, 'job_' + currentJobId);
        uploaded.push(fileRecord);

        const percent = Math.round(((i + 1) / stagedFilesPreupload.length) * 85);
        progressFillPreupload.style.width = `${percent}%`;
      }

      await fetch('/api/upload-complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobId: currentJobId,
          files: uploaded,
        }),
      });

      progressFillPreupload.style.width = '100%';
      progressTextPreupload.textContent = 'Files ready!';

      setTimeout(() => {
        preuploadStepFile.style.display = 'none';
        btnPreuploadFile.style.display = 'none';
        preuploadStepBind.style.display = 'flex';
        btnBindCode.style.display = 'flex';
        manualCodeInput.focus();
      }, 350);
    } catch (err) {
      alert(`Upload failed: ${err.message}`);
      btnPreuploadFile.disabled = false;
      progressPreupload.style.display = 'none';
    }
  });

  manualCodeInput.addEventListener('input', (e) => {
    e.target.value = e.target.value.replace(/\D/g, '').slice(0, 4);
    btnBindCode.disabled = e.target.value.length !== 4;
    if (e.target.value.length === 4) {
      bindJobToKiosk(e.target.value.trim());
    }
  });

  btnBindCode.addEventListener('click', () => {
    const code = manualCodeInput.value.trim();
    if (code.length === 4) bindJobToKiosk(code);
  });

  btnScanQr.addEventListener('click', startCameraScanner);
  btnCancelScanner.addEventListener('click', stopCameraScanner);
}

/**
 * Camera Scanner
 */
async function startCameraScanner() {
  qrScannerModal.classList.add('active');

  if (window.Html5Qrcode) {
    html5QrCodeScanner = new window.Html5Qrcode('qr-reader');
    try {
      await html5QrCodeScanner.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 220, height: 220 } },
        (decodedText) => {
          let extractedCode = null;
          try {
            const url = new URL(decodedText);
            const c = url.searchParams.get('code');
            if (c && /^\d{4}$/.test(c)) extractedCode = c;
          } catch (e) {
            if (/^\d{4}$/.test(decodedText.trim())) {
              extractedCode = decodedText.trim();
            }
          }

          if (extractedCode) {
            stopCameraScanner();
            bindJobToKiosk(extractedCode);
          }
        },
        () => {}
      );
    } catch (err) {
      alert('Unable to access camera.');
      stopCameraScanner();
    }
  } else {
    alert('QR scanner library unavailable.');
    stopCameraScanner();
  }
}

async function stopCameraScanner() {
  if (html5QrCodeScanner) {
    try { await html5QrCodeScanner.stop(); } catch (e) {}
    html5QrCodeScanner = null;
  }
  qrScannerModal.classList.remove('active');
}

async function bindJobToKiosk(code) {
  if (!currentJobId) return;

  btnBindCode.disabled = true;
  btnBindCode.textContent = 'Linking...';

  try {
    const res = await fetch('/api/bind', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: code.trim(),
        jobId: currentJobId,
      }),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || `Failed HTTP ${res.status}`);
    }

    sessionStorage.removeItem(MOBILE_JOB_KEY);
    cardPreupload.classList.remove('active');
    cardSuccess.classList.add('active');
  } catch (err) {
    alert(`Could not link to kiosk: ${err.message}`);
    btnBindCode.disabled = false;
    btnBindCode.textContent = 'Link to Kiosk Screen';
  }
}

async function downloadBlobDirectly(url, filename) {
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    const objUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objUrl;
    a.download = filename || 'document';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(objUrl), 1000);
  } catch (e) {
    window.open(url, '_blank');
  }
}

/**
 * FLOW C: Download Flow (Kiosk -> Phone) matching Reference Image 2
 */
async function initDownloadFlow(code) {
  currentCode = code;
  badgeKioskCode.textContent = `KIOSK #${currentCode}`;
  cardDownload.classList.add('active');

  try {
    const res = await fetch(`/api/status?code=${code}`);
    if (!res.ok) throw new Error('Session not found or expired.');

    const data = await res.json();
    const files = Array.isArray(data.files) && data.files.length > 0
      ? data.files
      : data.file ? [data.file] : [];

    downloadFilesList.innerHTML = '';

    if (files.length === 0) {
      downloadFilesList.innerHTML = '<div style="padding:12px; color:var(--text-muted); text-align:center;">No files available to download.</div>';
      btnDownloadAllMobile.style.display = 'none';
      return;
    }

    files.forEach((file) => {
      const safeName = escapeHtml(file.name);
      const row = document.createElement('div');
      row.className = 'ref-pill-row';
      const icon = getFileIcon(file.name);

      row.innerHTML = `
        <div class="ref-pill-left">
          <span class="ref-pill-icon">${icon}</span>
          <span class="ref-pill-name">${safeName}</span>
        </div>
        <div class="ref-pill-right">
          <span class="ref-pill-size">${formatBytes(file.size)}</span>
          <button class="ref-pill-action btn-save-mobile" data-url="${file.url}" data-name="${safeName}" type="button" title="Save">↓</button>
        </div>
      `;
      downloadFilesList.appendChild(row);
    });

    downloadFilesList.querySelectorAll('.btn-save-mobile').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        downloadBlobDirectly(btn.getAttribute('data-url'), btn.getAttribute('data-name'));
      });
    });

    btnDownloadAllMobile.addEventListener('click', () => {
      files.forEach((file, i) => {
        setTimeout(() => downloadBlobDirectly(file.url, file.name), i * 350);
      });
    });
  } catch (err) {
    downloadFilesList.innerHTML = `<div style="padding:12px; color:#e11d48; text-align:center;">${escapeHtml(err.message)}</div>`;
    btnDownloadAllMobile.style.display = 'none';
  }
}

/**
 * In-place reset (NO page reload)
 */
btnSendAnother.addEventListener('click', () => {
  cardSuccess.classList.remove('active');
  stagedFilesStandard = [];
  stagedFilesPreupload = [];
  progressStandard.style.display = 'none';
  progressPreupload.style.display = 'none';
  fileInputStandard.value = '';
  fileInputPreupload.value = '';
  attachmentContainerStandard.style.display = 'none';
  attachmentContainerPreupload.style.display = 'none';
  attachmentListStandard.innerHTML = '';
  attachmentListPreupload.innerHTML = '';

  if (currentCode) {
    btnSendStandard.disabled = true;
    btnSendStandard.textContent = '📤 Send to Kiosk';
    cardStandard.classList.add('active');
  } else {
    preuploadStepFile.style.display = 'flex';
    btnPreuploadFile.style.display = 'flex';
    preuploadStepBind.style.display = 'none';
    btnBindCode.style.display = 'none';
    btnPreuploadFile.disabled = true;
    cardPreupload.classList.add('active');
  }
});

// Run
init();
