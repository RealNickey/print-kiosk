import { getSession, saveSession } from './_lib/blob-store.js';

/**
 * Generate a random 4-digit numeric code between 1000 and 9999.
 */
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

    // Pick an unallocated 4-digit code (retry up to 5 times)
    while (attempts < 5) {
      const candidate = generate4DigitCode();
      const existing = await getSession(candidate);
      if (!existing) {
        code = candidate;
        break;
      }
      // If session is older than 3 hours, we can overwrite it
      const age = Date.now() - (existing.session?.createdAt || 0);
      if (age > 3 * 60 * 60 * 1000) {
        code = candidate;
        break;
      }
      attempts++;
    }

    if (!code) {
      code = generate4DigitCode();
    }

    const now = Date.now();
    const sessionData = {
      code,
      status: 'waiting',
      mode: mode === 'send' ? 'send' : 'receive',
      createdAt: now,
      updatedAt: now,
      files: [],
      file: null,
    };

    await saveSession(code, sessionData);

    return res.status(201).json({
      success: true,
      code,
      status: 'waiting',
      mode: sessionData.mode,
      createdAt: now,
      files: [],
    });
  } catch (error) {
    console.error('[api/session] Error creating session:', error);
    return res.status(500).json({
      error: 'Failed to create session',
      message: error.message,
    });
  }
}
