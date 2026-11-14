import { deleteSession, isValidCode } from './_lib/supabase.js';

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
    const { code } = req.body || {};

    if (!isValidCode(code)) {
      return res.status(400).json({ error: 'Invalid 4-digit code' });
    }

    const deleted = await deleteSession(code);

    return res.status(200).json({
      success: true,
      message: 'Session and files successfully cleared.',
      deleted,
    });
  } catch (error) {
    console.error('[api/cleanup] Error clearing session:', error);
    return res.status(500).json({ error: 'Failed to clear session' });
  }
}
