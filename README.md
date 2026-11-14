# Print Kiosk & Mobile Two-Way File Transfer

A modern, tactile, and resilient two-way file transfer web application built for desktop print kiosks and mobile devices, deployed on Vercel Serverless Functions with Vercel Blob storage.

---

## Architecture & Polish Highlights

* **Design Engineering & Visual Taste:** Built following Emil Kowalski's craft sensibility and Vercel Web Interface Guidelines. Features tactile button press feedback (`scale(0.97)`), smooth custom easings (`cubic-bezier(0.23, 1, 0.32, 1)`), entering animations from `scale(0.96)`, and attachment cards matching modern editorial design.
* **100% Offline-Resilient QR Generation:** Uses locally bundled QR Code (`js/vendor/qrcode.min.js`) and camera scanner (`js/vendor/html5-qrcode.min.js`) scripts without external CDN dependencies.
* **Multi-File Batch Transfer:** Supports drag-and-drop and multiple file selection (up to 10 files per batch, max 50MB per file) for both mobile upload and kiosk outbound transfer.
* **Session Persistence:** Active 4-digit session codes survive page reloads and browser refreshes across the 3-minute inactivity window.
* **No-Scroll Mobile Experience:** Mobile companion (`mobile.html`) strictly fits within `100dvh` without unwanted page scrolling.
* **In-Place UI Updates:** Smooth transitions and state changes without full-page reloads.
* **Zero Mobile Redirection on Root:** Opening the main site on mobile does not redirect to `mobile.html`, preserving adaptive responsive behavior.
* **Security & Validation:**
  - File extension allowlist & blacklist (blocks `.exe`, `.bat`, `.cmd`, `.sh`, `.js`, etc.)
  - File name sanitization against path traversal and XSS
  - Vercel Blob token-level 50MB max file size limits
  - Security headers (`X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy`, `CSP`)
  - Auto-purge of uploaded files upon manual reset, session clear, or 3-minute idle timeout.

---

## File Structure

```
├── api/
│   ├── _lib/
│   │   └── blob-store.js       # Vercel Blob multi-file session & job persistence layer
│   ├── session.js              # POST: Generates random 4-digit code & initializes session
│   ├── upload.js               # POST: Handles @vercel/blob/client tokens & validation
│   ├── upload-complete.js      # POST: Multi-file completion registration
│   ├── bind.js                 # POST: Binds pre-uploaded mobile jobId to kiosk session code
│   ├── status.js               # GET: Polling status endpoint with multi-file support
│   ├── cleanup.js              # DELETE/POST: Permanently deletes files & sessions from Blob
│   └── ping.js                 # GET: Ultra-lightweight captive portal check
├── css/
│   ├── kiosk.css               # Modern tactile desktop kiosk styles & attachment cards
│   └── mobile.css              # No-scroll single page 100dvh mobile companion styles
├── js/
│   ├── kiosk.js                # Kiosk polling, multi-file print/download, session persistence
│   ├── mobile.js               # Mobile multi-file upload, camera scanner, in-place UI
│   └── vendor/                 # Locally hosted libraries (zero external CDN reliance)
│       ├── blob-client.js
│       ├── html5-qrcode.min.js
│       └── qrcode.min.js
├── index.html                  # Desktop Kiosk web app
├── mobile.html                 # Mobile companion web app (PWA ready)
├── manifest.json               # Web App Manifest
├── package.json
└── vercel.json                 # Vercel serverless routing, headers & cache control
```

---

## Deployment

Deploy directly using Vercel CLI:
```bash
vercel --prod
```
Ensure `BLOB_READ_WRITE_TOKEN` is configured in your Vercel project environment variables.
