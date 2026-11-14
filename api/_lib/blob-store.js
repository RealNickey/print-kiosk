import { put, del, list } from '@vercel/blob';

/**
 * Validates that a code is a 4-digit numeric string.
 * @param {string} code
 * @returns {boolean}
 */
export function isValidCode(code) {
  return typeof code === 'string' && /^\d{4}$/.test(code.trim());
}

/**
 * Sanitizes a filename to prevent path traversal, null bytes, and script injection.
 * @param {string} rawName
 * @returns {string}
 */
export function sanitizeFileName(rawName) {
  if (!rawName || typeof rawName !== 'string') return 'document';
  // Strip null bytes and control chars
  let clean = rawName.replace(/[\x00-\x1f\x7f]/g, '');
  // Extract basename (remove Unix and Windows directory separators)
  clean = clean.split(/[/\\]/).pop() || 'document';
  // Remove dangerous characters
  clean = clean.replace(/[<>:"|?*]/g, '_');
  // Strip leading/trailing dots or spaces
  clean = clean.trim().replace(/^\.+/, '');
  // Limit max length
  if (clean.length > 120) {
    const ext = clean.includes('.') ? '.' + clean.split('.').pop() : '';
    clean = clean.substring(0, 110) + ext;
  }
  return clean || 'document';
}

/**
 * Retrieve session data from Vercel Blob.
 * @param {string} code 4-digit session code
 * @returns {Promise<{ session: any, blobUrl: string } | null>}
 */
export async function getSession(code) {
  if (!isValidCode(code)) return null;

  try {
    const pathname = `sessions/${code.trim()}.json`;
    const response = await list({ prefix: pathname, limit: 1 });
    const match = response.blobs.find((b) => b.pathname === pathname);
    if (!match) return null;

    const res = await fetch(match.url, { cache: 'no-store' });
    if (!res.ok) return null;
    const session = await res.json();
    return { session, blobUrl: match.url, pathname: match.pathname };
  } catch (err) {
    console.error(`[blob-store] Error getting session ${code}:`, err);
    throw err;
  }
}

/**
 * Save or update session data in Vercel Blob.
 * @param {string} code 4-digit session code
 * @param {object} data Session object
 * @returns {Promise<any>}
 */
export async function saveSession(code, data) {
  if (!isValidCode(code)) throw new Error('Invalid 4-digit code');

  const pathname = `sessions/${code.trim()}.json`;
  const blob = await put(pathname, JSON.stringify(data), {
    access: 'public',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
  });
  return blob;
}

/**
 * Delete session and all associated files from Vercel Blob.
 * @param {string} code 4-digit session code
 * @returns {Promise<boolean>}
 */
export async function deleteSession(code) {
  if (!isValidCode(code)) return false;

  try {
    const existing = await getSession(code);
    if (!existing) return false;

    // Collect all files to delete
    const filesToDelete = new Set();

    if (Array.isArray(existing.session?.files)) {
      for (const f of existing.session.files) {
        if (f?.url) filesToDelete.add(f.url);
      }
    }
    if (existing.session?.file?.url) {
      filesToDelete.add(existing.session.file.url);
    }

    // Delete all uploaded blobs in parallel
    for (const fileUrl of filesToDelete) {
      try {
        await del(fileUrl);
      } catch (e) {
        console.warn(`[blob-store] Failed to delete file ${fileUrl}:`, e.message);
      }
    }

    // Delete session JSON record
    await del(existing.blobUrl);
    return true;
  } catch (err) {
    console.error(`[blob-store] Error deleting session ${code}:`, err);
    throw err;
  }
}

/**
 * Retrieve temporary pre-upload job data from Vercel Blob.
 * @param {string} jobId
 * @returns {Promise<{ job: any, blobUrl: string } | null>}
 */
export async function getJob(jobId) {
  if (!jobId || typeof jobId !== 'string') return null;

  try {
    const cleanId = jobId.trim().replace(/[^a-zA-Z0-9_-]/g, '');
    const pathname = `jobs/${cleanId}.json`;
    const response = await list({ prefix: pathname, limit: 1 });
    const match = response.blobs.find((b) => b.pathname === pathname);
    if (!match) return null;

    const res = await fetch(match.url, { cache: 'no-store' });
    if (!res.ok) return null;
    const job = await res.json();
    return { job, blobUrl: match.url, pathname: match.pathname };
  } catch (err) {
    console.error(`[blob-store] Error getting job ${jobId}:`, err);
    throw err;
  }
}

/**
 * Save temporary pre-upload job data in Vercel Blob.
 * @param {string} jobId
 * @param {object} data
 * @returns {Promise<any>}
 */
export async function saveJob(jobId, data) {
  const cleanId = jobId.trim().replace(/[^a-zA-Z0-9_-]/g, '');
  const pathname = `jobs/${cleanId}.json`;
  return await put(pathname, JSON.stringify(data), {
    access: 'public',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
  });
}

/**
 * Delete job record and optionally all its files.
 * @param {string} jobId
 * @param {boolean} deleteFiles
 * @returns {Promise<boolean>}
 */
export async function deleteJob(jobId, deleteFiles = false) {
  if (!jobId) return false;

  try {
    const existing = await getJob(jobId);
    if (!existing) return false;

    if (deleteFiles) {
      const filesToDelete = new Set();
      if (Array.isArray(existing.job?.files)) {
        for (const f of existing.job.files) {
          if (f?.url) filesToDelete.add(f.url);
        }
      }
      if (existing.job?.file?.url) {
        filesToDelete.add(existing.job.file.url);
      }

      for (const fileUrl of filesToDelete) {
        try {
          await del(fileUrl);
        } catch (e) {
          console.warn(`[blob-store] Failed to delete job file ${fileUrl}:`, e.message);
        }
      }
    }

    await del(existing.blobUrl);
    return true;
  } catch (err) {
    console.error(`[blob-store] Error deleting job ${jobId}:`, err);
    throw err;
  }
}
