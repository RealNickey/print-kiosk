import { getSession, saveSession, getJob, saveJob, sanitizeFileName, isValidCode } from './_lib/blob-store.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { code, jobId, file, files, mode } = req.body || {};

    const incomingFiles = Array.isArray(files) && files.length > 0
      ? files
      : file ? [file] : [];

    if (incomingFiles.length === 0) {
      return res.status(400).json({ error: 'Missing uploaded file details' });
    }

    const now = Date.now();
    const formattedFiles = incomingFiles.map((f) => ({
      url: f.url,
      pathname: f.pathname || '',
      name: sanitizeFileName(f.name || 'upload'),
      size: typeof f.size === 'number' ? f.size : 0,
      contentType: f.contentType || 'application/octet-stream',
      uploadedAt: now,
    }));

    if (code) {
      if (!isValidCode(code)) {
        return res.status(400).json({ error: 'Invalid 4-digit code' });
      }

      const existing = await getSession(code);
      const sessionData = existing?.session || {
        code,
        mode: mode || 'receive',
        createdAt: now,
        files: [],
      };

      const currentFiles = Array.isArray(sessionData.files)
        ? sessionData.files
        : sessionData.file ? [sessionData.file] : [];

      // Merge new files
      const merged = [...currentFiles];
      for (const newFile of formattedFiles) {
        if (!merged.some(m => m.url === newFile.url || (m.pathname && m.pathname === newFile.pathname))) {
          merged.push(newFile);
        }
      }

      const updated = {
        ...sessionData,
        status: 'uploaded',
        updatedAt: now,
        files: merged,
        file: merged[0] || null,
      };

      await saveSession(code, updated);
      return res.status(200).json({
        success: true,
        code,
        status: 'uploaded',
        files: merged,
        file: merged[0] || null,
      });
    }

    if (jobId) {
      const cleanId = String(jobId).trim().replace(/[^a-zA-Z0-9_-]/g, '');
      const existing = await getJob(cleanId);
      const jobData = existing?.job || {
        jobId: cleanId,
        createdAt: now,
        files: [],
      };

      const currentFiles = Array.isArray(jobData.files)
        ? jobData.files
        : jobData.file ? [jobData.file] : [];

      const merged = [...currentFiles];
      for (const newFile of formattedFiles) {
        if (!merged.some(m => m.url === newFile.url || (m.pathname && m.pathname === newFile.pathname))) {
          merged.push(newFile);
        }
      }

      const updatedJob = {
        ...jobData,
        status: 'uploaded',
        updatedAt: now,
        files: merged,
        file: merged[0] || null,
      };

      await saveJob(cleanId, updatedJob);
      return res.status(200).json({
        success: true,
        jobId: cleanId,
        status: 'uploaded',
        files: merged,
        file: merged[0] || null,
      });
    }

    return res.status(400).json({ error: 'Neither code nor jobId provided' });
  } catch (error) {
    console.error('[api/upload-complete] Error updating status:', error);
    return res.status(500).json({ error: 'Failed to record upload completion', message: error.message });
  }
}
