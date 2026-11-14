import { getSupabase } from './_lib/supabase.js';

export const config = {
  api: {
    bodyParser: false, // Stream raw binary directly
  },
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-File-Name, X-Kiosk-Code');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const supabase = getSupabase();
    if (!supabase) {
      return res.status(500).json({ error: 'Supabase server client not initialized' });
    }

    const code = req.headers['x-kiosk-code'] || req.query.code || 'temp';
    const rawName = decodeURIComponent(req.headers['x-file-name'] || req.query.name || 'document');
    const cleanName = rawName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const storagePath = `${code}/${Date.now()}_${cleanName}`;

    // Read binary body chunks
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);

    const contentType = req.headers['content-type'] || 'application/octet-stream';

    // Upload using service role key (bypasses RLS)
    const { data, error } = await supabase.storage
      .from('documents')
      .upload(storagePath, buffer, {
        contentType,
        upsert: true,
      });

    if (error) {
      console.error('[api/upload-file] Service role upload error:', error.message);
      return res.status(500).json({ error: error.message });
    }

    const { data: publicData } = supabase.storage
      .from('documents')
      .getPublicUrl(storagePath);

    return res.status(200).json({
      url: publicData.publicUrl,
      storagePath,
      name: rawName,
      size: buffer.length,
      contentType,
    });
  } catch (err) {
    console.error('[api/upload-file] Exception:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
