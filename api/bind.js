import { isValidCode, getSession, saveSession, getJob, deleteJob } from './_lib/supabase.js';

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

    const sessionWrap = await getSession(code);
    if (!sessionWrap) {
      return res.status(404).json({ error: 'Kiosk session not found or expired. Please verify the code on the screen.' });
    }

    const jobWrap = await getJob(jobId);
    if (!jobWrap || !jobWrap.job?.files?.length) {
      return res.status(404).json({ error: 'Pre-uploaded file not found or expired. Please upload again.' });
    }

    const jobFiles = Array.isArray(jobWrap.job.files) ? jobWrap.job.files : [];
    const existingSessionFiles = Array.isArray(sessionWrap.session.files) ? sessionWrap.session.files : [];

    const mergedFiles = [...existingSessionFiles];
    for (const jf of jobFiles) {
      if (!mergedFiles.some(m => m.url === jf.url || (m.storagePath && m.storagePath === jf.storagePath))) {
        mergedFiles.push(jf);
      }
    }

    const updatedSession = await saveSession(code, {
      ...sessionWrap.session,
      status: 'uploaded',
      files: mergedFiles,
    });

    await deleteJob(jobId);

    return res.status(200).json({
      success: true,
      code,
      status: 'uploaded',
      files: mergedFiles,
      saved: Boolean(updatedSession),
    });
  } catch (error) {
    console.error('[api/bind] Error binding pre-uploaded files:', error);
    return res.status(500).json({ error: 'Internal server error while linking files to kiosk' });
  }
}
