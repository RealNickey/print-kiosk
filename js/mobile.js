import { upload } from '/js/vendor/blob-client.js';

// State variables
let currentCode = null;
let currentJobId = null;
let stagedFilesStandard = [];
let stagedFilesPreupload = [];
let html5QrCodeScanner = null;

// DOM Elements
const badgeKioskCode = document.getElementById('badge-kiosk-code');

// Flow A
const cardStandard = document.getElementById('card-standard');
const fileInputStandard = document.getElementById('file-input-standard');
const dropzoneStandard = document.getElementById('dropzone-standard');
const attachmentContainerStandard = document.getElementById('attachment-container-standard');
const attachmentListStandard = document.getElementById('attachment-list-standard');
const standardCountBadge = document.getElementById('standard-count-badge');
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
const preuploadCountBadge = document.getElementById('preupload-count-badge');
const progressPreupload = document.getElementById('progress-preupload');
const progressFillPreupload = document.getElementById('progress-fill-preupload');
const progressTextPreupload = document.getElementById('progress-text-preupload');
const btnPreuploadFile = document.getElementById('btn-preupload-file');
const btnScanQr = document.getElementById('btn-scan-qr');
const manualCodeInput = document.getElementById('manual-code-input');
const btnBindCode = document.getElementById('btn-bind-code');

// Flow C
const cardDownload = document.getElementById('card-download');
const downloadCountBadge = document.getElementById('download-count-badge');
const downloadFilesList = document.getElementById('download-files-list');
const btnDownloadAllMobile = document.getElementById('btn-download-all-mobile');

// Flow D
const cardSuccess = document.getElementById('card-success');
const btnSendAnother = document.getElementById('btn-send-another');

// Scanner Modal
const qrScannerModal = document.getElementById('qr-scanner-modal');
const btnCancelScanner = document.getElementById('btn-cancel-scanner');

// Dangerous extensions pattern
const DANGEROUS_EXTS = /\.(exe|bat|cmd|sh|js|mjs|cjs|vbs|ps1|scr|msi|jar|apk|com|pif|hta|html|htm|php|cgi)$/i;

/**
 * Format bytes into readable string.
 */
function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

/**
 * Validate selected files.
 */
function validateFiles(fileList) {
  const files = Array.from(fileList);
  if (files.length > 10) {
    alert('Please select a maximum of 10 files at once.');
    return [];
  }

  const valid = [];
  for (const f of files) {
    if (f.size > 50 * 1024 * 1024) {
      alert(`"${f.name}" exceeds the 50MB limit (${formatBytes(f.size)}). It has been excluded.`);
      continue;
    }
    if (DANGEROUS_EXTS.test(f.name)) {
      alert(`"${f.name}" has an unsafe file extension and cannot be uploaded.`);
      continue;
    }
    valid.push(f);
  }
  return valid;
}

/**
 * Render staged files in attachment list.
 */
function renderStagedList(container, listEl, countEl, filesArray, onRemove) {
  if (filesArray.length === 0) {
    container.style.display = 'none';
    listEl.innerHTML = '';
    countEl.textContent = '0 files';
    return;
  }

  container.style.display = 'flex';
  countEl.textContent = `${filesArray.length} ${filesArray.length === 1 ? 'file' : 'files'}`;
  listEl.innerHTML = '';

  filesArray.forEach((file, idx) => {
    const item = document.createElement('div');
    item.className = 'mobile-attachment-item';
    item.innerHTML = `
      <div class="mobile-item-left">
        <span aria-hidden="true">📄</span>
        <span class="mobile-file-name" title="${file.name}">${file.name}</span>
        <span class="mobile-file-size">(${formatBytes(file.size)})</span>
      </div>
      <button class="btn-remove-attachment" data-index="${idx}" type="button" aria-label="Remove ${file.name}">✕</button>
    `;
    listEl.appendChild(item);
  });

  listEl.querySelectorAll('.btn-remove-attachment').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.getAttribute('data-index'), 10);
      onRemove(idx);
    });
  });
}

/**
 * Parse URL parameters and select the appropriate flow.
 */
function init() {
  const urlParams = new URLSearchParams(window.location.search);
  const code = urlParams.get('code');
  const action = urlParams.get('action');

  if (action === 'download' && code) {
    initDownloadFlow(code);
  } else if (code && /^\d{4}$/.test(code.trim())) {
    initStandardFlow(code.trim());
  } else {
    initPreuploadFlow();
  }
}

/**
 * FLOW A: Standard QR Scan Flow (Code known)
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
      standardCountBadge,
      stagedFilesStandard,
      (idx) => {
        stagedFilesStandard.splice(idx, 1);
        updateStandardList();
      }
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
    progressTextStandard.textContent = `Uploading 1 of ${stagedFilesStandard.length}...`;

    const uploaded = [];

    try {
      for (let i = 0; i < stagedFilesStandard.length; i++) {
        const file = stagedFilesStandard[i];
        progressTextStandard.textContent = `Uploading ${i + 1} of ${stagedFilesStandard.length}: ${file.name}...`;

        const blob = await upload(file.name, file, {
          access: 'public',
          handleUploadUrl: '/api/upload',
          clientPayload: JSON.stringify({
            code: currentCode,
            fileName: file.name,
            mode: 'receive',
          }),
        });

        uploaded.push({
          url: blob.url,
          pathname: blob.pathname,
          name: file.name,
          size: file.size,
          contentType: file.type,
        });

        const percent = Math.round(((i + 1) / stagedFilesStandard.length) * 85);
        progressFillStandard.style.width = `${percent}%`;
      }

      progressTextStandard.textContent = 'Registering with kiosk screen...';

      await fetch('/api/upload-complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: currentCode,
          files: uploaded,
          mode: 'receive',
        }),
      });

      progressFillStandard.style.width = '100%';
      progressTextStandard.textContent = 'Upload Complete!';

      setTimeout(() => {
        cardStandard.classList.remove('active');
        cardSuccess.classList.add('active');
      }, 400);
    } catch (err) {
      console.error('Upload failed:', err);
      alert(`Upload failed: ${err.message}. Please try again.`);
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
      preuploadCountBadge,
      stagedFilesPreupload,
      (idx) => {
        stagedFilesPreupload.splice(idx, 1);
        updatePreuploadList();
      }
    );
    btnPreuploadFile.disabled = stagedFilesPreupload.length === 0;
    btnPreuploadFile.textContent = stagedFilesPreupload.length > 0
      ? `Upload ${stagedFilesPreupload.length} ${stagedFilesPreupload.length === 1 ? 'File' : 'Files'}`
      : 'Upload Files';
  }

  btnPreuploadFile.addEventListener('click', async () => {
    if (stagedFilesPreupload.length === 0) return;

    btnPreuploadFile.disabled = true;
    progressPreupload.style.display = 'block';
    progressFillPreupload.style.width = '10%';
    currentJobId = 'job_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);

    const uploaded = [];

    try {
      for (let i = 0; i < stagedFilesPreupload.length; i++) {
        const file = stagedFilesPreupload[i];
        progressTextPreupload.textContent = `Uploading ${i + 1} of ${stagedFilesPreupload.length}: ${file.name}...`;

        const blob = await upload(file.name, file, {
          access: 'public',
          handleUploadUrl: '/api/upload',
          clientPayload: JSON.stringify({
            jobId: currentJobId,
            fileName: file.name,
          }),
        });

        uploaded.push({
          url: blob.url,
          pathname: blob.pathname,
          name: file.name,
          size: file.size,
          contentType: file.type,
        });

        const percent = Math.round(((i + 1) / stagedFilesPreupload.length) * 85);
        progressFillPreupload.style.width = `${percent}%`;
      }

      progressTextPreupload.textContent = 'Saving upload record...';

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
      console.error('Pre-upload failed:', err);
      alert(`Upload failed: ${err.message}. Please try again.`);
      btnPreuploadFile.disabled = false;
      progressPreupload.style.display = 'none';
    }
  });

  // Manual 4-digit numeric code input
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

  // Camera QR Code Scanner
  btnScanQr.addEventListener('click', startCameraScanner);
  btnCancelScanner.addEventListener('click', stopCameraScanner);
}

/**
 * Camera QR Scanner via local html5-qrcode
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
        () => {} // frame scan ignore
      );
    } catch (err) {
      console.error('Camera scanner error:', err);
      alert('Unable to access camera. Please enter the 4-digit code manually.');
      stopCameraScanner();
    }
  } else {
    alert('QR scanner library unavailable. Please enter the 4-digit code manually.');
    stopCameraScanner();
  }
}

async function stopCameraScanner() {
  if (html5QrCodeScanner) {
    try {
      await html5QrCodeScanner.stop();
    } catch (e) {}
    html5QrCodeScanner = null;
  }
  qrScannerModal.classList.remove('active');
}

/**
 * Bind pre-uploaded job to kiosk 4-digit session code.
 */
async function bindJobToKiosk(code) {
  if (!currentJobId) return;

  btnBindCode.disabled = true;
  btnBindCode.textContent = 'Linking to screen...';

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
      throw new Error(err.error || `Failed to link: HTTP ${res.status}`);
    }

    cardPreupload.classList.remove('active');
    cardSuccess.classList.add('active');
  } catch (err) {
    console.error('Binding error:', err);
    alert(`Could not link to kiosk: ${err.message}`);
    btnBindCode.disabled = false;
    btnBindCode.textContent = 'Link to Kiosk Screen';
  }
}

/**
 * FLOW C: Download Flow (Kiosk -> Mobile)
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

    downloadCountBadge.textContent = `${files.length} files`;
    downloadFilesList.innerHTML = '';

    if (files.length === 0) {
      downloadFilesList.innerHTML = '<div style="padding:12px; color:var(--text-muted); text-align:center;">No files available to download.</div>';
      btnDownloadAllMobile.style.display = 'none';
      return;
    }

    files.forEach((file) => {
      const row = document.createElement('div');
      row.className = 'mobile-attachment-item';
      row.innerHTML = `
        <div class="mobile-item-left">
          <span aria-hidden="true">📥</span>
          <span class="mobile-file-name">${file.name}</span>
          <span class="mobile-file-size">(${formatBytes(file.size)})</span>
        </div>
        <a href="${file.url}" download="${file.name}" target="_blank" class="btn-remove-attachment" style="text-decoration:none; color:var(--accent-blue); font-size:0.8rem; font-weight:700;">Save</a>
      `;
      downloadFilesList.appendChild(row);
    });

    btnDownloadAllMobile.addEventListener('click', () => {
      files.forEach((file, i) => {
        setTimeout(() => {
          const a = document.createElement('a');
          a.href = file.url;
          a.download = file.name || 'document';
          a.target = '_blank';
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
        }, i * 350);
      });
    });
  } catch (err) {
    console.error('Error fetching files for download:', err);
    downloadFilesList.innerHTML = `<div style="padding:12px; color:#e11d48; text-align:center;">${err.message}</div>`;
    btnDownloadAllMobile.style.display = 'none';
  }
}

/**
 * Reset companion flow
 */
btnSendAnother.addEventListener('click', () => {
  window.location.href = currentCode ? `/mobile.html?code=${currentCode}` : '/mobile.html';
});

// Run
init();
