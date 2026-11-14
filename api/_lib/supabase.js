import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

let supabase = null;

if (supabaseUrl && supabaseKey) {
  try {
    supabase = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false },
    });
  } catch (err) {
    console.error('[supabase] Initialization error:', err.message);
  }
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
 * Retrieve session by 4-digit code from Supabase
 */
export async function getSession(code) {
  if (!isValidCode(code) || !supabase) return null;
  const cleanCode = code.trim();

  try {
    const { data, error } = await supabase
      .from('sessions')
      .select('*')
      .eq('code', cleanCode)
      .single();

    if (error || !data) return null;

    // Check expiration (3 minutes)
    const expiresAt = new Date(data.expires_at).getTime();
    if (Date.now() > expiresAt) {
      await deleteSession(cleanCode);
      return null;
    }

    return { session: data };
  } catch (err) {
    console.error(`[supabase] getSession error (${cleanCode}):`, err.message);
    return null;
  }
}

/**
 * Save or update session in Supabase
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
    updated_at: now.toISOString(),
    expires_at: expiresAt.toISOString(),
  };

  try {
    const { data, error } = await supabase
      .from('sessions')
      .upsert(payload, { onConflict: 'code' })
      .select()
      .single();

    if (error) {
      console.error(`[supabase] saveSession error (${cleanCode}):`, error.message);
      return null;
    }

    return data;
  } catch (err) {
    console.error(`[supabase] saveSession exception (${cleanCode}):`, err.message);
    return null;
  }
}

/**
 * Delete session and clean up any associated files from storage
 */
export async function deleteSession(code) {
  if (!isValidCode(code) || !supabase) return false;
  const cleanCode = code.trim();

  try {
    // 1. Fetch file list to delete from storage
    const { data: session } = await supabase
      .from('sessions')
      .select('files')
      .eq('code', cleanCode)
      .single();

    if (session && Array.isArray(session.files) && session.files.length > 0) {
      const pathsToDelete = session.files
        .map(f => f.storagePath || f.pathname)
        .filter(Boolean);

      if (pathsToDelete.length > 0) {
        await supabase.storage.from('documents').remove(pathsToDelete);
      }
    }

    // 2. Delete row from sessions table
    await supabase.from('sessions').delete().eq('code', cleanCode);
    return true;
  } catch (err) {
    console.error(`[supabase] deleteSession error (${cleanCode}):`, err.message);
    return false;
  }
}

/**
 * Temporary Pre-Upload Jobs Support (Reuses sessions table with job_ prefix)
 */
export async function getJob(jobId) {
  if (!jobId || !supabase) return null;
  const key = `job_${String(jobId).trim().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  try {
    const { data } = await supabase.from('sessions').select('*').eq('code', key).single();
    if (!data) return null;
    return { job: { files: data.files, jobId } };
  } catch (e) {
    return null;
  }
}

export async function saveJob(jobId, jobData) {
  if (!jobId || !supabase) return null;
  const key = `job_${String(jobId).trim().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 600 * 1000); // 10 minutes
  try {
    const { data } = await supabase.from('sessions').upsert({
      code: key,
      status: 'pending',
      mode: 'receive',
      files: jobData.files || [],
      updated_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
    }).select().single();
    return data;
  } catch (e) {
    return null;
  }
}

export async function deleteJob(jobId) {
  if (!jobId || !supabase) return false;
  const key = `job_${String(jobId).trim().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  try {
    await supabase.from('sessions').delete().eq('code', key);
    return true;
  } catch (e) {
    return false;
  }
}
