import { handleUpload } from '@vercel/blob/client';
import { getSession, saveSession, getJob, saveJob, sanitizeFileName, isValidCode } from './_lib/blob-store.js';

// Blocked dangerous extensions
const DANGEROUS_EXTENSIONS = /\.(exe|bat|cmd|sh|js|mjs|cjs|vbs|ps1|scr|msi|jar|apk|com|pif|hta|html|htm|php|cgi)$/i;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-vercel-signature');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;

    const jsonResponse = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        let payload = {};
        try {
          payload = typeof clientPayload === 'string' ? JSON.parse(clientPayload) : clientPayload || {};
        } catch (e) {
          payload = {};
        }

        const { code, jobId, fileName } = payload;
        if (!code && !jobId) {
          throw new Error('Either a 4-digit code or a jobId must be provided in clientPayload');
        }

        if (code && !isValidCode(code)) {
          throw new Error('Invalid 4-digit session code');
        }

        // Security check on file extension
        const checkName = fileName || pathname || '';
        if (DANGEROUS_EXTENSIONS.test(checkName)) {
          throw new Error('File type not allowed for security reasons.');
        }

        return {
          allowedContentTypes: [
            'application/pdf',
            'image/jpeg',
            'image/png',
            'image/webp',
            'image/gif',
            'image/heic',
            'image/bmp',
            'image/svg+xml',
            'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/vnd.ms-excel',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'application/vnd.ms-powerpoint',
            'application/vnd.openxmlformats-officedocument.presentationml.presentation',
            'text/plain',
            'text/csv',
            'application/zip',
            'application/x-zip-compressed',
            'application/octet-stream'
          ],
          maximumSizeInBytes: 50 * 1024 * 1024, // 50 MB max per file
          tokenPayload: JSON.stringify(payload),
        };
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        let payload = {};
        try {
          payload = typeof tokenPayload === 'string' ? JSON.parse(tokenPayload) : tokenPayload || {};
        } catch (e) {
          payload = {};
        }

        const { code, jobId, fileName } = payload;
        const now = Date.now();
        const safeName = sanitizeFileName(fileName || blob.pathname.split('/').pop() || 'upload');

        const fileMetadata = {
          url: blob.url,
          pathname: blob.pathname,
          name: safeName,
          size: blob.size,
          contentType: blob.contentType,
          uploadedAt: now,
        };

        if (code) {
          const sessionWrap = await getSession(code);
          const currentSession = sessionWrap?.session || {
            code,
            mode: 'receive',
            createdAt: now,
            files: [],
          };

          const existingFiles = Array.isArray(currentSession.files)
            ? currentSession.files
            : currentSession.file ? [currentSession.file] : [];

          const alreadyAdded = existingFiles.some(f => f.pathname === fileMetadata.pathname || f.url === fileMetadata.url);
          const updatedFiles = alreadyAdded ? existingFiles : [...existingFiles, fileMetadata];

          const updated = {
            ...currentSession,
            status: 'uploaded',
            updatedAt: now,
            files: updatedFiles,
            file: updatedFiles[0] || fileMetadata,
          };

          await saveSession(code, updated);
          console.log(`[api/upload] Session ${code} added file: ${fileMetadata.name} (total ${updatedFiles.length})`);
        } else if (jobId) {
          const jobWrap = await getJob(jobId);
          const currentJob = jobWrap?.job || {
            jobId,
            createdAt: now,
            files: [],
          };

          const existingFiles = Array.isArray(currentJob.files)
            ? currentJob.files
            : currentJob.file ? [currentJob.file] : [];

          const alreadyAdded = existingFiles.some(f => f.pathname === fileMetadata.pathname || f.url === fileMetadata.url);
          const updatedFiles = alreadyAdded ? existingFiles : [...existingFiles, fileMetadata];

          const updatedJob = {
            ...currentJob,
            status: 'uploaded',
            updatedAt: now,
            files: updatedFiles,
            file: updatedFiles[0] || fileMetadata,
          };

          await saveJob(jobId, updatedJob);
          console.log(`[api/upload] Job ${jobId} added file: ${fileMetadata.name} (total ${updatedFiles.length})`);
        }
      },
    });

    return res.status(200).json(jsonResponse);
  } catch (error) {
    console.error('[api/upload] Error processing upload:', error);
    return res.status(400).json({
      error: 'Upload failed',
      message: error.message,
    });
  }
}
