import { isValidCode, getSession, saveSession, getJob, deleteJob } from './_lib/blob-store.js';

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
    const { code, jobId } = req.body || {};

    if (!isValidCode(code)) {
      return res.status(400).json({ error: 'Invalid 4-digit kiosk code' });
    }

    if (!jobId || typeof jobId !== 'string') {
      return res.status(400).json({ error: 'Missing or invalid jobId' });
    }

    // Check if kiosk session exists
    const sessionWrap = await getSession(code);
    if (!sessionWrap) {
      return res.status(404).json({ error: 'Kiosk session not found or expired. Please verify the code on the screen.' });
    }

    // Check if pre-upload job exists
    const jobWrap = await getJob(jobId);
    if (!jobWrap || (!jobWrap.job?.files?.length && !jobWrap.job?.file)) {
      return res.status(404).json({ error: 'Pre-uploaded file not found or expired. Please upload again.' });
    }

    const jobFiles = Array.isArray(jobWrap.job.files) && jobWrap.job.files.length > 0
      ? jobWrap.job.files
      : jobWrap.job.file ? [jobWrap.job.file] : [];

    const existingSessionFiles = Array.isArray(sessionWrap.session.files)
      ? sessionWrap.session.files
      : sessionWrap.session.file ? [sessionWrap.session.file] : [];

    // Merge without duplicates
    const mergedFiles = [...existingSessionFiles];
    for (const jf of jobFiles) {
      if (!mergedFiles.some(m => m.url === jf.url || (m.pathname && m.pathname === jf.pathname))) {
        mergedFiles.push(jf);
      }
    }

    const now = Date.now();
    const updatedSession = {
      ...sessionWrap.session,
      status: 'uploaded',
      updatedAt: now,
      files: mergedFiles,
      file: mergedFiles[0] || null,
    };

    // Save linked session
    await saveSession(code, updatedSession);

    // Clean up temporary job metadata record (keep files in Blob)
    await deleteJob(jobId, false);

    return res.status(200).json({
      success: true,
      message: 'Job successfully linked to kiosk session',
      code,
      files: updatedSession.files,
      file: updatedSession.file,
    });
  } catch (error) {
    console.error('[api/bind] Error binding job to session:', error);
    return res.status(500).json({ error: 'Failed to bind upload to kiosk', message: error.message });
  }
}
