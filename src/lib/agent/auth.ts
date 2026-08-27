import { createHash, randomBytes } from "node:crypto";
import { eq, isNull, and } from "drizzle-orm";
import { db } from "@/db";
import { agentApiKeys, profiles } from "@/db/schema";
import { logActivity } from "@/lib/activity";
import { getActor } from "@/lib/permissions/actor";
import { assertCan, type Actor } from "@/lib/permissions";
import { normalizeMsisdn } from "@/lib/whatsapp/normalize";

// Agent API authentication (EPIC-023). Two credentials per request, on
// purpose:
//
//   Authorization: Bearer rvca_…   — proves WHICH AGENT is calling
//   X-On-Behalf-Of: <phone>        — names WHICH HUMAN it speaks for
//
// The key alone can do nothing: every request resolves the phone number to a
// profile and runs as that user through src/lib/permissions, so an agent in
// a WhatsApp group answers each sender with THAT sender's rights. A leaked
// key without a phone the system knows is a brick. This is the deliberate
// alternative to the all-access token the Owner first asked for — one
// injected message in a group chat must never be able to read a sealed
// dataroom folder through the agent.

const TOKEN_PREFIX = "rvca_";

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Mints a key; the PLAINTEXT is returned once and never stored. */
export async function createAgentKey(
  actor: Actor,
  name: string,
): Promise<{ token: string; id: string }> {
  assertCan(actor, "org.manage");
  const clean = name.trim();
  if (!clean) throw new Error("A key needs a name.");
  const token = TOKEN_PREFIX + randomBytes(24).toString("base64url");
  const [row] = await db
    .insert(agentApiKeys)
    .values({
      name: clean,
      tokenHash: hashToken(token),
      tokenTail: token.slice(-4),
      createdBy: actor.id,
    })
    .returning({ id: agentApiKeys.id });
  await logActivity({
    actorId: actor.id,
    action: "agent.key_created",
    entity: `agent-key:${row.id}`,
    detail: { name: clean },
  });
  return { token, id: row.id };
}

export async function revokeAgentKey(actor: Actor, keyId: string) {
  assertCan(actor, "org.manage");
  await db
    .update(agentApiKeys)
    .set({ revokedAt: new Date() })
    .where(eq(agentApiKeys.id, keyId));
  await logActivity({
    actorId: actor.id,
    action: "agent.key_revoked",
    entity: `agent-key:${keyId}`,
    detail: {},
  });
}

export async function listAgentKeys(actor: Actor) {
  assertCan(actor, "org.manage");
  return db
    .select({
      id: agentApiKeys.id,
      name: agentApiKeys.name,
      tokenTail: agentApiKeys.tokenTail,
      createdAt: agentApiKeys.createdAt,
      lastUsedAt: agentApiKeys.lastUsedAt,
      revokedAt: agentApiKeys.revokedAt,
    })
    .from(agentApiKeys)
    .orderBy(agentApiKeys.createdAt);
}

export class AgentAuthError extends Error {
  constructor(
    public status: 401 | 403 | 429,
    message: string,
  ) {
    super(message);
  }
}

// Best-effort per-key rate limit (single container, in-memory): enough to
// stop a runaway agent loop from hammering the database, not a substitute
// for real infrastructure if this ever goes multi-instance.
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 120;
const hits = new Map<string, number[]>();

function checkRate(keyId: string) {
  const now = Date.now();
  const list = (hits.get(keyId) ?? []).filter((t) => now - t < WINDOW_MS);
  if (list.length >= MAX_PER_WINDOW) {
    throw new AgentAuthError(429, "Rate limit: 120 requests per minute per key.");
  }
  list.push(now);
  hits.set(keyId, list);
}

export interface AgentContext {
  actor: Actor;
  keyId: string;
  keyName: string;
  /** normalized msisdn the request acts for — for the audit trail */
  msisdn: string;
}

/**
 * Authenticates one request. Throws AgentAuthError with the right HTTP
 * status; never reveals whether it was the key or the phone that failed
 * beyond what the caller needs to fix it.
 */
export async function authenticateAgent(request: Request): Promise<AgentContext> {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token.startsWith(TOKEN_PREFIX)) {
    throw new AgentAuthError(401, "Missing bearer token.");
  }
  const [key] = await db
    .select()
    .from(agentApiKeys)
    .where(and(eq(agentApiKeys.tokenHash, hashToken(token)), isNull(agentApiKeys.revokedAt)))
    .limit(1);
  if (!key) throw new AgentAuthError(401, "Unknown or revoked key.");
  checkRate(key.id);

  const rawPhone = request.headers.get("x-on-behalf-of") ?? "";
  const msisdn = normalizeMsisdn(rawPhone);
  if (!msisdn) {
    throw new AgentAuthError(
      401,
      "X-On-Behalf-Of must carry the phone number of the person speaking.",
    );
  }

  // profiles store phones in assorted local formats; normalise both sides
  const candidates = await db
    .select({ id: profiles.id, phone: profiles.phone, isActive: profiles.isActive })
    .from(profiles);
  const person = candidates.find(
    (p) => p.phone && normalizeMsisdn(p.phone) === msisdn,
  );
  if (!person) {
    throw new AgentAuthError(403, "This phone number belongs to no user.");
  }
  if (!person.isActive) {
    throw new AgentAuthError(403, "This user is deactivated.");
  }
  const actor = await getActor(person.id);
  if (!actor) throw new AgentAuthError(403, "This user cannot act.");
  if (actor.role === "external") {
    // externals have their own invite-scoped surface; the agent is not it
    throw new AgentAuthError(403, "External accounts cannot use the agent.");
  }

  // fire-and-forget stamp; a failed stamp must not fail the request
  db.update(agentApiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(agentApiKeys.id, key.id))
    .catch(() => {});

  return { actor, keyId: key.id, keyName: key.name, msisdn };
}
