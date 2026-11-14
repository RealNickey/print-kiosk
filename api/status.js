import { isValidCode, getSession } from './_lib/supabase.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { code } = req.query;

  if (!isValidCode(code)) {
    return res.status(400).json({ error: 'Invalid 4-digit code', status: 'error' });
  }

  try {
    const sessionWrap = await getSession(code);
    if (!sessionWrap || !sessionWrap.session) {
      return res.status(404).json({
        code,
        status: 'not_found',
        message: 'Session does not exist or has expired.',
      });
    }

    const { session } = sessionWrap;
    const files = Array.isArray(session.files) ? session.files : [];

    return res.status(200).json({
      code: session.code,
      status: session.status || 'waiting',
      mode: session.mode || 'receive',
      files,
      file: files[0] || null,
      createdAt: session.created_at,
      updatedAt: session.updated_at,
      expiresAt: session.expires_at,
    });
  } catch (error) {
    console.error(`[api/status] Error checking session ${code}:`, error);
    return res.status(500).json({
      code,
      status: 'error',
      message: error.message,
    });
  }
}
