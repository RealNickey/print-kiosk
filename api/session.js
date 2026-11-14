import { getSession, saveSession } from './_lib/supabase.js';

function generate4DigitCode() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { mode = 'receive' } = req.body || {};

    let code = null;
    let attempts = 0;

    // Pick an unused 4-digit code
    while (attempts < 5) {
      const candidate = generate4DigitCode();
      const existing = await getSession(candidate);
      if (!existing) {
        code = candidate;
        break;
      }
      attempts++;
    }

    if (!code) code = generate4DigitCode();

    const sessionData = {
      code,
      status: 'waiting',
      mode: mode === 'send' ? 'send' : 'receive',
      files: [],
    };

    const saved = await saveSession(code, sessionData);

    return res.status(201).json({
      success: true,
      code,
      status: 'waiting',
      mode: sessionData.mode,
      files: [],
      saved: Boolean(saved),
    });
  } catch (error) {
    console.error('[api/session] Error creating session:', error);
    return res.status(500).json({ error: 'Failed to initialize session' });
  }
}
