// Privacy-token (tctoken) bookkeeping, mirroring Baileys rc14's internal
// lib/Utils/tc-token-utils.js, which the package does not export and ships
// without typings. Kept dependency-free so it is unit-testable; the shapes
// are Baileys' own (SignalKeyStore 'tctoken' entries, BinaryNode IQ result).

export const TC_TOKEN_INDEX_KEY = "__index";
const BUCKET_SECONDS = 604_800; // 7 days
const NUM_BUCKETS = 4; // ~28-day rolling window

export interface TcTokenEntry {
  token?: Uint8Array;
  timestamp?: string | number;
  senderTimestamp?: number;
}

export interface TcTokenKeys {
  get: (type: "tctoken", ids: string[]) => Promise<Record<string, TcTokenEntry | null | undefined>>;
  set: (data: { tctoken: Record<string, TcTokenEntry | null> }) => Promise<void>;
}

export interface BinaryNode {
  tag: string;
  attrs: Record<string, string>;
  content?: BinaryNode[] | string | Uint8Array;
}

const isLidUser = (jid: string) => jid.endsWith("@lid");

/** `6281…:12@s.whatsapp.net` → `6281…@s.whatsapp.net` (device suffix dropped) */
export function normalizeUser(jid: string): string {
  const [user, server] = jid.split("@");
  return `${(user ?? "").split(":")[0]}@${server ?? "s.whatsapp.net"}`;
}

function children(node: BinaryNode | undefined, tag: string): BinaryNode[] {
  if (!node || !Array.isArray(node.content)) return [];
  return node.content.filter((c) => c.tag === tag);
}

/** WA Web keeps tokens for ~4 weekly buckets; older ones count as missing. */
export function isTcTokenExpired(timestamp: string | number | null | undefined, now = Date.now()): boolean {
  if (timestamp === null || timestamp === undefined) return true;
  const ts = typeof timestamp === "string" ? parseInt(timestamp, 10) : timestamp;
  if (Number.isNaN(ts)) return true;
  const currentBucket = Math.floor(Math.floor(now / 1000) / BUCKET_SECONDS);
  const cutoff = (currentBucket - (NUM_BUCKETS - 1)) * BUCKET_SECONDS;
  return ts < cutoff;
}

/** Tokens are stored under the contact's LID when one is known. */
export async function resolveTcTokenJid(
  jid: string,
  getLIDForPN: (pn: string) => Promise<string | null | undefined>,
): Promise<string> {
  if (isLidUser(jid)) return jid;
  return (await getLIDForPN(jid)) ?? jid;
}

/** Which JID to ask the server to issue a token for (AB prop 14303). */
export async function resolveIssuanceJid(
  jid: string,
  issueToLid: boolean,
  getLIDForPN: (pn: string) => Promise<string | null | undefined>,
  getPNForLID: (lid: string) => Promise<string | null | undefined>,
): Promise<string> {
  if (issueToLid) return isLidUser(jid) ? jid : ((await getLIDForPN(jid)) ?? jid);
  if (!isLidUser(jid)) return jid;
  return (await getPNForLID(jid)) ?? jid;
}

/**
 * Persists the trusted_contact tokens an `issuePrivacyTokens` IQ returned.
 * Newer-or-equal timestamps replace, older ones are ignored, timestamp-less
 * ones skipped (they would be expired on arrival). Returns the storage JIDs
 * written.
 */
export async function storeTcTokensFromIqResult(opts: {
  result: BinaryNode;
  fallbackJid: string;
  keys: TcTokenKeys;
  getLIDForPN: (pn: string) => Promise<string | null | undefined>;
}): Promise<string[]> {
  const stored: string[] = [];
  for (const tokenNode of children(children(opts.result, "tokens")[0], "token")) {
    if (tokenNode.attrs.type !== "trusted_contact" || !(tokenNode.content instanceof Uint8Array)) continue;
    // in the IQ result attrs.jid can be our own device — the fallback names the contact
    const rawJid = normalizeUser(opts.fallbackJid || tokenNode.attrs.jid);
    const storageJid = await resolveTcTokenJid(rawJid, opts.getLIDForPN);
    const existing = (await opts.keys.get("tctoken", [storageJid]))[storageJid];
    const existingTs = existing?.timestamp ? Number(existing.timestamp) : 0;
    const incomingTs = tokenNode.attrs.t ? Number(tokenNode.attrs.t) : 0;
    if (!incomingTs || (existingTs > 0 && existingTs > incomingTs)) continue;
    await opts.keys.set({
      tctoken: {
        [storageJid]: { ...existing, token: new Uint8Array(tokenNode.content), timestamp: tokenNode.attrs.t },
      },
    });
    stored.push(storageJid);
  }
  return stored;
}

/** The `__index` sentinel lists every JID with a stored token (for cleanup). */
export async function mergedTcTokenIndexWrite(
  keys: TcTokenKeys,
  addedJids: string[],
): Promise<Record<string, TcTokenEntry>> {
  const entry = (await keys.get("tctoken", [TC_TOKEN_INDEX_KEY]))[TC_TOKEN_INDEX_KEY];
  const merged = new Set<string>();
  if (entry?.token?.length) {
    try {
      const parsed: unknown = JSON.parse(Buffer.from(entry.token).toString());
      if (Array.isArray(parsed)) {
        for (const j of parsed) if (typeof j === "string" && j && j !== TC_TOKEN_INDEX_KEY) merged.add(j);
      }
    } catch {
      // a corrupt index is rebuilt from what we know
    }
  }
  for (const j of addedJids) if (j && j !== TC_TOKEN_INDEX_KEY) merged.add(j);
  return { [TC_TOKEN_INDEX_KEY]: { token: new Uint8Array(Buffer.from(JSON.stringify([...merged]))) } };
}
