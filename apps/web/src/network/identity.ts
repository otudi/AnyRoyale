// Guest identity persisted in localStorage. The server issues guestId + token (HMAC); the browser
// only stores them. Storage can be unavailable (private mode, blocked cookies): everything still
// works, the player just gets a new identity next visit.

const KEY = 'anyroyale.identity.v1';

export interface StoredIdentity {
  guestId?: string;
  token?: string;
  name?: string;
}

function safeGet(): StoredIdentity {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as StoredIdentity) : {};
  } catch {
    return {};
  }
}

let cache: StoredIdentity = safeGet();

export function loadIdentity(): StoredIdentity {
  return { ...cache };
}

export function saveIdentity(patch: StoredIdentity): void {
  cache = { ...cache, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    // storage unavailable; keep the in-memory copy
  }
}

/** Client-side default name shown before the server answers. */
export function provisionalName(): string {
  const existing = cache.name;
  if (existing) return existing;
  const name = `Royal_${1000 + Math.floor(Math.random() * 9000)}`;
  saveIdentity({ name });
  return name;
}
