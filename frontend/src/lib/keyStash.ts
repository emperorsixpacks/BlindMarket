/**
 * AES-key stash for the just-in-time wrap flow.
 *
 * When a task is posted without a full executor set (or none at all), the
 * frontend keeps the AES key in localStorage so the poster can wrap it to
 * bidders that register *after* the post. The key never leaves this browser
 * unencrypted — wrap-to-bidder happens in JS, the backend only ever sees
 * ECIES blobs.
 *
 * Trade-off acknowledged in PITCH.md: if the poster clears the browser /
 * switches devices before bids arrive, the task becomes uncompletable. This
 * is the v1 cost of preserving the architectural-blindness invariant without
 * a TEE-held key (v2 roadmap).
 */

const PREFIX = 'blindmarket:aesKey:';

function hexFromBytes(b: Uint8Array): string {
  return Array.from(b, (n) => n.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0) throw new Error('odd-length hex in keyStash');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function normalize(taskHash: string): string {
  return taskHash.startsWith('0x') ? taskHash.toLowerCase() : `0x${taskHash.toLowerCase()}`;
}

export function stashAesKey(taskHash: string, key: Uint8Array): void {
  try {
    localStorage.setItem(PREFIX + normalize(taskHash), hexFromBytes(key));
  } catch (e) {
    // Storage full / disabled — the task still posts, the user just can't
    // wrap to post-hoc bidders from this browser. Log so it's visible.
    console.warn('[keyStash] failed to persist AES key:', (e as Error).message);
  }
}

// NB: with storage fully blocked (Safari "Block All Cookies", strict
// webviews) ANY localStorage access throws, not just setItem — every helper
// here degrades to "no key available" instead of crashing its caller.
export function getAesKey(taskHash: string): Uint8Array | null {
  try {
    const raw = localStorage.getItem(PREFIX + normalize(taskHash));
    if (!raw) return null;
    return hexToBytes(raw);
  } catch {
    return null;
  }
}

export function clearAesKey(taskHash: string): void {
  try {
    localStorage.removeItem(PREFIX + normalize(taskHash));
  } catch {}
}

/** List every taskHash we currently hold a key for. Used by the bid-watcher
 *  to know which tasks it should poll for new bidders. */
export function listStashedHashes(): string[] {
  const out: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(PREFIX)) out.push(k.slice(PREFIX.length));
    }
  } catch {}
  return out;
}
