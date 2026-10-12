import type { XctskFile } from './xctrack';

/**
 * XContest's task sharing (tools.xcontest.org/xctsk): upload a task, get back a
 * short code a pilot types into XCTrack to load it.
 *
 * Anonymous — no account or key — and it allows browser requests from any
 * origin, so VTasker calls it directly. Verified against the live service: a
 * task uploads, and the code loads it back with every turnpoint, the start type
 * and the deadline intact.
 *
 * Codes are only valid for a month (the service's own rule), so a code is reused
 * while it's comfortably inside that window and a fresh one fetched after.
 */
const SAVE_URL = 'https://tools.xcontest.org/api/xctsk/save';
const CACHE_KEY = 'vtasker_xcontest_codes';
const REUSE_FOR_MS = 25 * 24 * 3600 * 1000;
/** XContest's own limit on a code; the hash link never expires. */
export const CODE_VALID_MS = 30 * 24 * 3600 * 1000;

export interface XContestCode {
  code: string;
  hash: string;
  savedAt: number;
}

/** Cheap content fingerprint, so an edited task gets its own code. */
export function fingerprint(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36) + ':' + text.length;
}

function readCache(): Record<string, XContestCode> {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'); } catch { return {}; }
}

function writeCache(cache: Record<string, XContestCode>) {
  try {
    // Drop anything past its useful life so the store doesn't grow forever.
    const now = Date.now();
    for (const [k, v] of Object.entries(cache)) if (now - v.savedAt > REUSE_FOR_MS) delete cache[k];
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch { /* storage unavailable — codes just won't be reused */ }
}

/** Same input getXContestCode fingerprints, for comparing against a stored code. */
export const fingerprintFile = (file: XctskFile) => fingerprint(JSON.stringify(file));

/**
 * A link that hands the task straight to XCTrack. XContest serves it as an
 * application/xctsk download, which Android offers to XCTrack. Uses the
 * permanent hash where there is one, so the link outlives the code.
 */
export const xcontestOpenUrl = (c: Pick<XContestCode, 'code' | 'hash'>) =>
  `https://tools.xcontest.org/api/xctsk/load/${encodeURIComponent(c.hash || c.code)}`;

export async function getXContestCode(file: XctskFile): Promise<XContestCode> {
  const body = JSON.stringify(file);
  const key = fingerprint(body);

  const cached = readCache()[key];
  if (cached && Date.now() - cached.savedAt < REUSE_FOR_MS) return cached;

  const res = await fetch(SAVE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Author: 'VTasker (nbparagliding.nz)' },
    body,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`XContest didn't accept this task: ${text.slice(0, 160)}`);

  const json = JSON.parse(text) as { taskCode?: string; taskHash?: string };
  if (!json.taskCode) throw new Error('XContest returned no task code.');

  const result: XContestCode = { code: json.taskCode, hash: json.taskHash ?? '', savedAt: Date.now() };
  const cache = readCache();
  cache[key] = result;
  writeCache(cache);
  return result;
}
