import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

let supabase = null;

try {
  supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false },
  });
} catch (err) {
  console.error('[supabase] Initialization error:', err.message);
}

export function getSupabase() {
  return supabase;
}

export function isValidCode(code) {
  return typeof code === 'string' && /^\d{4}$/.test(code.trim());
}

export function sanitizeFileName(rawName) {
  if (!rawName || typeof rawName !== 'string') return 'document';
  let clean = rawName.replace(/[\x00-\x1f\x7f]/g, '');
  clean = clean.split(/[/\\]/).pop() || 'document';
  clean = clean.replace(/[<>:"|?*]/g, '_');
  clean = clean.trim().replace(/^\.+/, '');
  if (clean.length > 120) {
    const ext = clean.includes('.') ? '.' + clean.split('.').pop() : '';
    clean = clean.substring(0, 110) + ext;
  }
  return clean || 'document';
}

/**
 * Retrieve session by 4-digit code (Tries Postgres table first, falls back to Storage bucket)
 */
export async function getSession(code) {
  if (!isValidCode(code) || !supabase) return null;
  const cleanCode = code.trim();

  // 1. Primary: Try public.sessions table
  try {
    const { data, error } = await supabase
      .from('sessions')
      .select('*')
      .eq('code', cleanCode)
      .single();

    if (!error && data) {
      const expiresAt = new Date(data.expires_at).getTime();
      if (Date.now() > expiresAt) {
        await deleteSession(cleanCode);
        return null;
      }
      return { session: data };
    }
  } catch (err) {}

  // 2. Fallback: Check storage bucket (_sessions/{code}.json)
  try {
    const path = `_sessions/${cleanCode}.json`;
    const { data, error } = await supabase.storage.from('documents').download(path);
    if (!error && data) {
      const text = await data.text();
      const session = JSON.parse(text);
      const expiresAt = new Date(session.expires_at).getTime();
      if (Date.now() > expiresAt) {
        await deleteSession(cleanCode);
        return null;
      }
      return { session };
    }
  } catch (err) {}

  return null;
}

/**
 * Save or update session (Writes to Postgres table, falls back to Storage bucket)
 */
export async function saveSession(code, sessionData) {
  if (!isValidCode(code) || !supabase) return null;
  const cleanCode = code.trim();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 180 * 1000); // 3 minutes

  const payload = {
    code: cleanCode,
    status: sessionData.status || 'waiting',
    mode: sessionData.mode || 'receive',
    files: Array.isArray(sessionData.files) ? sessionData.files : [],
    created_at: sessionData.created_at || now.toISOString(),
    updated_at: now.toISOString(),
    expires_at: expiresAt.toISOString(),
  };

  // 1. Primary: Upsert into public.sessions table
  try {
    const { data, error } = await supabase
      .from('sessions')
      .upsert(payload, { onConflict: 'code' })
      .select()
      .single();

    if (!error && data) {
      return data;
    }
  } catch (err) {}

  // 2. Fallback: Save to storage bucket (_sessions/{code}.json)
  try {
    const path = `_sessions/${cleanCode}.json`;
    await supabase.storage.from('documents').upload(path, JSON.stringify(payload), {
      contentType: 'application/json',
      upsert: true,
    });
    return payload;
  } catch (err) {
    console.error(`[supabase] saveSession fallback error (${cleanCode}):`, err.message);
    return null;
  }
}

/**
 * Delete session and purge stored files
 */
export async function deleteSession(code) {
  if (!isValidCode(code) || !supabase) return false;
  const cleanCode = code.trim();

  try {
    // 1. Get file list to purge
    let filesToDelete = [];
    const sessionWrap = await getSession(cleanCode);
    if (sessionWrap?.session?.files?.length) {
      filesToDelete = sessionWrap.session.files.map(f => f.storagePath).filter(Boolean);
    }

    if (filesToDelete.length > 0) {
      await supabase.storage.from('documents').remove(filesToDelete);
    }

    // 2. Remove fallback session JSON
    await supabase.storage.from('documents').remove([`_sessions/${cleanCode}.json`]);

    // 3. Remove row from table
    await supabase.from('sessions').delete().eq('code', cleanCode);
    return true;
  } catch (err) {
    console.error(`[supabase] deleteSession error (${cleanCode}):`, err.message);
    return false;
  }
}

/**
 * Pre-upload temporary jobs support
 */
export async function getJob(jobId) {
  if (!jobId || !supabase) return null;
  const key = `job_${String(jobId).trim().replace(/[^a-zA-Z0-9_-]/g, '')}`;

  try {
    const { data } = await supabase.from('sessions').select('*').eq('code', key).single();
    if (data) return { job: { files: data.files, jobId } };
  } catch (e) {}

  try {
    const path = `_jobs/${key}.json`;
    const { data } = await supabase.storage.from('documents').download(path);
    if (data) {
      const text = await data.text();
      const job = JSON.parse(text);
      return { job: { files: job.files, jobId } };
    }
  } catch (e) {}

  return null;
}

export async function saveJob(jobId, jobData) {
  if (!jobId || !supabase) return null;
  const key = `job_${String(jobId).trim().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 600 * 1000); // 10 minutes

  const payload = {
    code: key,
    status: 'pending',
    mode: 'receive',
    files: jobData.files || [],
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
    expires_at: expiresAt.toISOString(),
  };

  try {
    const { data } = await supabase.from('sessions').upsert(payload).select().single();
    if (data) return data;
  } catch (e) {}

  try {
    const path = `_jobs/${key}.json`;
    await supabase.storage.from('documents').upload(path, JSON.stringify(payload), {
      contentType: 'application/json',
      upsert: true,
    });
    return payload;
  } catch (e) {}

  return null;
}

export async function deleteJob(jobId) {
  if (!jobId || !supabase) return false;
  const key = `job_${String(jobId).trim().replace(/[^a-zA-Z0-9_-]/g, '')}`;

  try { await supabase.from('sessions').delete().eq('code', key); } catch (e) {}
  try { await supabase.storage.from('documents').remove([`_jobs/${key}.json`]); } catch (e) {}
  return true;
}
