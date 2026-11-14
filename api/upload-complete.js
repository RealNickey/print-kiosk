import { getSession, saveSession, sanitizeFileName, isValidCode } from './_lib/supabase.js';

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
    const { code, files, mode } = req.body || {};

    const incomingFiles = Array.isArray(files) && files.length > 0 ? files : [];

    if (incomingFiles.length === 0) {
      return res.status(400).json({ error: 'Missing uploaded file details' });
    }

    if (!isValidCode(code)) {
      return res.status(400).json({ error: 'Invalid 4-digit code' });
    }

    const now = Date.now();
    const formattedFiles = incomingFiles.map((f) => ({
      url: f.url,
      storagePath: f.storagePath || f.pathname || '',
      name: sanitizeFileName(f.name || 'document'),
      size: typeof f.size === 'number' ? f.size : 0,
      contentType: f.contentType || 'application/octet-stream',
      uploadedAt: now,
    }));

    const existing = await getSession(code);
    const sessionData = existing?.session || {
      code,
      mode: mode || 'receive',
      files: [],
    };

    const currentFiles = Array.isArray(sessionData.files) ? sessionData.files : [];
    const merged = [...currentFiles];

    for (const newFile of formattedFiles) {
      if (!merged.some(m => m.url === newFile.url || (m.storagePath && m.storagePath === newFile.storagePath))) {
        merged.push(newFile);
      }
    }

    const updated = await saveSession(code, {
      ...sessionData,
      status: 'uploaded',
      mode: mode || sessionData.mode || 'receive',
      files: merged,
    });

    return res.status(200).json({
      success: true,
      code,
      status: 'uploaded',
      files: merged,
      saved: Boolean(updated),
    });
  } catch (error) {
    console.error('[api/upload-complete] Error completing upload:', error);
    return res.status(500).json({ error: 'Failed to finalize uploaded files' });
  }
}
