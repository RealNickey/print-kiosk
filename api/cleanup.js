import { isValidCode, deleteSession, deleteJob } from './_lib/blob-store.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'DELETE' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const code = req.query.code || req.body?.code;
  const jobId = req.query.jobId || req.body?.jobId;

  if (!code && !jobId) {
    return res.status(400).json({ error: 'Either code or jobId is required for cleanup' });
  }

  try {
    let purgedSession = false;
    let purgedJob = false;

    if (code) {
      if (isValidCode(code)) {
        purgedSession = await deleteSession(code);
      }
    }

    if (jobId) {
      const cleanId = String(jobId).trim().replace(/[^a-zA-Z0-9_-]/g, '');
      purgedJob = await deleteJob(cleanId, true);
    }

    return res.status(200).json({
      success: true,
      message: 'Purged successfully',
      purgedSession,
      purgedJob,
    });
  } catch (error) {
    console.error('[api/cleanup] Error cleaning up:', error);
    return res.status(500).json({
      error: 'Cleanup failed',
      message: error.message,
    });
  }
}
