# Print Kiosk & Mobile Two-Way File Transfer

A lightweight, resilient two-way file transfer web application built for desktop print kiosks and mobile devices, deployed on Vercel Serverless Functions with Vercel Blob storage.

---

## Architecture Overview

* **Frontend:** Vanilla HTML5, CSS3, and modern JavaScript (ES Modules). No heavyweight frameworks.
* **Backend:** Vercel Serverless Functions (`api/`).
* **Storage & Metadata:** Vercel Blob (`@vercel/blob`) using `BLOB_READ_WRITE_TOKEN`.
  * Session records stored as `sessions/{code}.json` in Vercel Blob.
  * Direct client-to-Blob uploads via `@vercel/blob/client` bypassing Vercel's 4.5 MB serverless function payload limit (supports files up to 50 MB).
* **PIN Format:** 4-digit numeric code (e.g., `4829`) with automatic mobile numeric keyboard popup (`inputmode="numeric"`).
* **Auto-Purge & Privacy:** Immediate file deletion upon session completion, manual reset, or 120-second idle timeout.

---

## Project Structure

```
├── api/
│   ├── _lib/
│   │   └── blob-store.js       # Vercel Blob session & job persistence layer
│   ├── session.js              # POST: Generates random 4-digit code & initializes session
│   ├── upload.js               # POST: Handles @vercel/blob/client tokens & webhook callbacks
│   ├── upload-complete.js      # POST: Immediate client notification of completed uploads
│   ├── bind.js                 # POST: Binds pre-uploaded mobile jobId to kiosk session code
│   ├── status.js               # GET: Lightweight status endpoint for 2-second desktop polling
│   ├── cleanup.js              # DELETE/POST: Immediately purges files & sessions from Blob
│   └── ping.js                 # GET: Ultra-lightweight network & captive portal check
├── css/
│   ├── kiosk.css               # Desktop kiosk styles & state transition themes
│   └── mobile.css              # Mobile-first responsive UI & QR scanner modal
├── js/
│   ├── kiosk.js                # Kiosk polling loop, print/download, drag & drop, bad-Wi-Fi monitor
│   └── mobile.js               # Mobile standard upload, pre-upload flow, and QR camera scanner
├── index.html                  # Desktop Kiosk web app
├── mobile.html                 # Mobile companion web app (PWA ready)
├── manifest.json               # Web App Manifest for mobile installation
├── package.json
├── vercel.json                 # Vercel routing and cache control configuration
└── .env.example
```

---

## Core Flows

### 1. Phone $\rightarrow$ Desktop (Primary Receiving Flow)
1. **Idle State:** Kiosk displays a large 4-digit numeric code and a QR code pointing to `https://<domain>/mobile.html?code=XXXX`.
2. **Scan & Upload:** User scans QR code with mobile camera (pre-filling the code), selects a file, and taps **Send to Kiosk**. The file uploads directly to Vercel Blob.
3. **Visual State Change:** Kiosk detects the upload via its 2-second polling loop and shifts background to an emerald green theme.
4. **Print / Download:**
   - **Print** (Primary): Triggers the browser print dialog directly via a hidden iframe (supports PDFs and images).
   - **Download** (Secondary): Saves the file to the local kiosk drive.
5. **Auto-Purge / Reset:**
   - User taps **Finish & Clear**, or
   - 120-second idle timer expires (with a 15-second visual countdown warning).
   - Immediately calls `/api/cleanup` to permanently delete the file and session from Vercel Blob.

### 2. Pre-Upload Flow (Returning PWA Users)
1. User opens `/mobile.html` directly without scanning first.
2. User selects and pre-uploads their file, receiving a temporary `jobId`.
3. User then connects to the kiosk via:
   - **Scan Kiosk QR Code:** Opens the built-in camera QR scanner, OR
   - **4-Digit Code Input:** Types the 4-digit code using the mobile numeric keypad.
4. Calling `/api/bind` immediately links the uploaded file to the kiosk session, triggering the **File Received** state on the kiosk.

### 3. Desktop $\rightarrow$ Phone (Secondary Outbound Flow)
1. User clicks **Send File to Phone** or drags and drops a file anywhere on the kiosk screen.
2. File uploads to Vercel Blob and generates an outbound QR code pointing to `https://<domain>/mobile.html?action=download&code=XXXX`.
3. Mobile user scans the QR code and taps **Download to Phone**.
4. Kiosk resets and purges file when done.

### 4. Bad Wi-Fi & Captive Portal Resilience
- Desktop runs a 2-second polling loop to `/api/status?code=XXXX`.
- If Wi-Fi drops or packets are lost: A non-intrusive banner appears (`⚠️ Reconnecting... Polling paused`) and automatically resumes once the connection is restored.
- If a captive portal intercepts traffic (returns HTML instead of JSON): A banner prompts `⚠️ Wi-Fi Login Required. Kiosk is blocked by a captive portal.`

---

## Deployment & Setup via Vercel CLI

### Prerequisites
1. [Node.js](https://nodejs.org/) (v18+)
2. Vercel CLI: `npm i -g vercel` (or installed locally)
3. A Vercel Blob store created in your Vercel Dashboard (under Storage $\rightarrow$ Blob).

### Configuration
1. Copy `.env.example` to `.env.local`:
   ```bash
   cp .env.example .env.local
   ```
2. Set your `BLOB_READ_WRITE_TOKEN`:
   ```env
   BLOB_READ_WRITE_TOKEN=vercel_blob_rw_xxxxxxxxxxxxxxxxxxxxxxxxxxxx
   ```

### Running Locally with Vercel CLI
```bash
# Start local development server with serverless functions
vercel dev
```
Open `http://localhost:3000` for the Desktop Kiosk, and `http://localhost:3000/mobile.html` for the Mobile Companion.

### Deploying to Production
```bash
# Link project to Vercel
vercel link

# Deploy to production
vercel --prod
```
Ensure `BLOB_READ_WRITE_TOKEN` is added to your Vercel Project Environment Variables via the dashboard or CLI:
```bash
vercel env add BLOB_READ_WRITE_TOKEN
```
