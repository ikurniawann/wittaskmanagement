import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  appSettings,
  eventTicketChannels,
  events,
  ticketTransactions,
} from "@/db/schema";
import { logActivity } from "@/lib/activity";
import { assertCan, type Actor } from "@/lib/permissions";
import { recordChannelDaily } from "@/lib/tickets/rollup";
import { wibDayKey } from "@/lib/tickets/service";
import { extractEvents, extractKpis, type TesseraEventRow } from "./extract";

// Tessera ticketing (Owner 2026-08-12). Two hard facts shape everything:
//
//   1. These are the endpoints Tessera's own dashboard uses — there is no
//      public API. They can change without notice, so every failure path is
//      loud and no other feature depends on this working.
//   2. The token is copied by hand from DevTools and DIES AFTER ~5 DAYS.
//      The sync will therefore stop regularly by design; the job of this
//      module is to make that stoppage visible the moment it happens, not to
//      pretend the data is still fresh.
//
// The token lives in app_settings, is used only server-side, and is never
// returned to a browser after being saved — the admin panel sees only that
// one exists, when it was saved, and when it last worked.

const BASE = "https://api.yourtessera.com";
const KEY_TOKEN = "tessera_token";
const KEY_ORG = "tessera_org_id";
const KEY_STATUS = "tessera_status";

export class TesseraAuthError extends Error {
  constructor() {
    super("Tessera token expired or invalid (401).");
  }
}

interface Stored {
  token: string;
  orgId: string;
  savedAt: string | null;
}

async function readSetting(key: string): Promise<unknown> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, key)).limit(1);
  return row?.value ?? null;
}

async function writeSetting(key: string, value: unknown) {
  await db
    .insert(appSettings)
    .values({ key, value: value as never })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: value as never, updatedAt: new Date() } });
}

async function credentials(): Promise<Stored | null> {
  const raw = (await readSetting(KEY_TOKEN)) as { token?: string; savedAt?: string } | string | null;
  const orgId = String((await readSetting(KEY_ORG)) ?? "");
  if (!raw) return null;
  const token = typeof raw === "string" ? raw : (raw.token ?? "");
  if (!token) return null;
  return { token, orgId, savedAt: typeof raw === "object" ? (raw.savedAt ?? null) : null };
}

export interface TesseraStatus {
  configured: boolean;
  savedAt: string | null;
  /** estimated days left of the ~5-day token lifetime; null when unknown */
  daysLeft: number | null;
  lastOkAt: string | null;
  lastError: string | null;
  /** raw sample kept ONLY when extraction failed, so the shape can be read */
  unreadableSample: string | null;
}

export async function getTesseraStatus(actor: Actor): Promise<TesseraStatus> {
  assertCan(actor, "org.manage");
  const creds = await credentials();
  const status = ((await readSetting(KEY_STATUS)) ?? {}) as Partial<TesseraStatus>;
  return {
    configured: Boolean(creds),
    savedAt: creds?.savedAt ?? null,
    // computed here, not in the page: Date.now() during render is impure
    // under the React compiler, and a lib function is where clocks live
    daysLeft: creds?.savedAt
      ? 5 - Math.floor((Date.now() - new Date(creds.savedAt).getTime()) / 86_400_000)
      : null,
    lastOkAt: status.lastOkAt ?? null,
    lastError: status.lastError ?? null,
    unreadableSample: status.unreadableSample ?? null,
  };
}

export async function saveTesseraCredentials(
  actor: Actor,
  input: { token: string; orgId: string },
) {
  assertCan(actor, "org.manage");
  const token = input.token.trim().replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("Paste the token from the authorization header.");
  await writeSetting(KEY_TOKEN, { token, savedAt: new Date().toISOString() });
  await writeSetting(KEY_ORG, input.orgId.trim());
  await writeSetting(KEY_STATUS, {});
  await logActivity({
    actorId: actor.id,
    action: "tessera.credentials_saved",
    entity: "org:tessera",
    // the token itself never reaches the log
    detail: { orgId: input.orgId.trim() || "(none)" },
  });
}

async function request(path: string, withOrg = false): Promise<unknown> {
  const creds = await credentials();
  if (!creds) throw new Error("Tessera is not connected.");
  const response = await fetch(`${BASE}${path}`, {
    headers: {
      accept: "application/json",
      authorization: `Bearer ${creds.token}`,
      ...(withOrg && creds.orgId ? { "x-organization-id": creds.orgId } : {}),
    },
    signal: AbortSignal.timeout(20_000),
    cache: "no-store",
  });
  if (response.status === 401) throw new TesseraAuthError();
  if (!response.ok) {
    throw new Error(`Tessera answered ${response.status} for ${path}.`);
  }
  return response.json();
}

async function markOk() {
  await writeSetting(KEY_STATUS, {
    lastOkAt: new Date().toISOString(),
    lastError: null,
    unreadableSample: null,
  });
}

async function markFailed(error: unknown, sample?: unknown) {
  const prior = ((await readSetting(KEY_STATUS)) ?? {}) as Partial<TesseraStatus>;
  await writeSetting(KEY_STATUS, {
    lastOkAt: prior.lastOkAt ?? null,
    lastError: error instanceof Error ? error.message : "Tessera request failed.",
    unreadableSample: sample ? JSON.stringify(sample).slice(0, 2000) : (prior.unreadableSample ?? null),
  });
}

/** The connection test AND the source for the mapping picker. */
export async function listTesseraEvents(actor: Actor): Promise<TesseraEventRow[]> {
  assertCan(actor, "org.manage");
  try {
    const payload = await request(
      "/eo/events?page=1&limit=100&includes=ticketsSold,revenue,admission,gmv",
    );
    const rows = extractEvents(payload);
    if (rows.length === 0) {
      // an empty org is possible, but an unreadable shape is likelier —
      // keep the sample so the admin panel can show what came back
      await markFailed(new Error("No events could be read from the response."), payload);
      return [];
    }
    await markOk();
    return rows;
  } catch (error) {
    await markFailed(error);
    throw error;
  }
}

/** Buyer rows for one Tessera event — the Connect tab's transactions table.
 *  Gated on tickets.record: these rows carry real buyers' emails, a step
 *  more sensitive than the aggregate numbers the page already shows. */
export async function listTesseraParticipants(
  actor: Actor,
  tesseraEventId: string,
  limit = 50,
) {
  assertCan(actor, "tickets.record");
  const { extractParticipants } = await import("./extract");
  const payload = await request(
    `/v2/eo/events/${encodeURIComponent(tesseraEventId)}/tickets/participants?limit=${limit}`,
  );
  const rows = extractParticipants(payload);
  if (rows.length === 0) {
    // empty sales are possible; an unreadable shape is likelier — keep the
    // sample so the panel can show what actually came back
    await markFailed(new Error("No participants could be read from the response."), payload);
  } else {
    await markOk();
  }
  return rows;
}

// ---- the sync -------------------------------------------------------------

export interface SyncResult {
  synced: number;
  failed: number;
  tokenExpired: boolean;
}

/**
 * Pulls today's numbers for every mapped, unarchived event into the same
 * snapshot table the manual form writes — health, dashboard and the AI all
 * read on unchanged. System rows carry no recordedBy and a note naming the
 * source, so a human's manual entry is distinguishable from the machine's.
 *
 * One events-list call covers every mapped event when the list carries the
 * numbers; the per-event KPI endpoint is the fallback, not the default —
 * these unofficial endpoints are rate-limited and one call beats N.
 */
export async function syncTesseraSales(): Promise<SyncResult> {
  const creds = await credentials();
  if (!creds) return { synced: 0, failed: 0, tokenExpired: false };

  // events connected to the TESSERA channel; an event may also carry a
  // Megatix channel, which its own sync handles independently
  const mapped = await db
    .select({
      id: events.id,
      tesseraEventId: eventTicketChannels.providerEventId,
    })
    .from(eventTicketChannels)
    .innerJoin(events, eq(events.id, eventTicketChannels.eventId))
    .where(
      and(eq(eventTicketChannels.provider, "tessera"), isNull(events.archivedAt)),
    );
  if (mapped.length === 0) return { synced: 0, failed: 0, tokenExpired: false };

  let listRows: TesseraEventRow[] = [];
  try {
    listRows = extractEvents(
      await request("/eo/events?page=1&limit=100&includes=ticketsSold,revenue,admission,gmv"),
    );
  } catch (error) {
    if (error instanceof TesseraAuthError) {
      await markFailed(error);
      await notifyAdminsTokenExpired(creds.savedAt);
      return { synced: 0, failed: mapped.length, tokenExpired: true };
    }
    await markFailed(error);
    return { synced: 0, failed: mapped.length, tokenExpired: false };
  }
  const byId = new Map(listRows.map((r) => [r.id, r]));

  const day = wibDayKey(new Date());
  let synced = 0;
  let failed = 0;
  for (const event of mapped) {
    try {
      const fromList = byId.get(event.tesseraEventId!);
      let sold = fromList?.ticketsSold ?? null;
      let revenue = fromList?.revenue ?? null;
      if (sold === null) {
        const kpis = extractKpis(
          await request(`/eo/events/${event.tesseraEventId}/tickets/kpis`),
        );
        if (!kpis) {
          failed += 1;
          continue;
        }
        sold = kpis.ticketsSold;
        revenue = kpis.revenue;
      }
      await recordChannelDaily({
        eventId: event.id,
        provider: "tessera",
        day,
        tickets: sold,
        revenue: revenue ?? 0,
      });
      // transactions, stored AS IS (Owner 2026-08-13): the typed columns feed
      // the table on the Connect tab, `raw` keeps everything Tessera sent —
      // and because the page reads THIS store, it stays useful after the
      // token dies instead of going blank
      try {
        const { extractParticipants } = await import("./extract");
        const txRows = extractParticipants(
          await request(
            `/v2/eo/events/${encodeURIComponent(event.tesseraEventId!)}/tickets/participants?limit=200`,
          ),
        );
        for (const tx of txRows) {
          if (!tx.tesseraId) continue; // no stable key — cannot upsert honestly
          const txValues = {
            eventId: event.id,
            provider: "tessera",
            providerTxnId: tx.tesseraId,
            orderId: tx.orderNo,
            buyerEmail: tx.email,
            buyerName: tx.name,
            category: tx.category,
            status: tx.status,
            promoCode: tx.promoCode,
            currency: tx.currency,
            purchasedAt: tx.purchasedAt ? new Date(tx.purchasedAt) : null,
            // Tessera reports one row PER TICKET, so each row is exactly one
            quantity: 1,
            ticketPrice: tx.ticketPrice,
            grossSales: tx.grossSales,
            totalFees: tx.totalFees,
            netSales: tx.netSales,
            discountAmount: tx.discountAmount,
            refundedAmount: tx.refundedAmount,
            vat: tx.vat,
            raw: tx.raw as never,
            syncedAt: new Date(),
          };
          await db
            .insert(ticketTransactions)
            .values(txValues)
            .onConflictDoUpdate({
              target: [
                ticketTransactions.provider,
                ticketTransactions.eventId,
                ticketTransactions.providerTxnId,
              ],
              set: txValues,
            });
        }
      } catch (error) {
        // transaction detail is enrichment; its failure must not undo the
        // aggregate sync that already landed
        if (error instanceof TesseraAuthError) throw error;
        console.error("[tessera] transactions sync failed:", error);
      }
      synced += 1;
    } catch (error) {
      if (error instanceof TesseraAuthError) {
        await markFailed(error);
        await notifyAdminsTokenExpired(creds.savedAt);
        return { synced, failed: failed + (mapped.length - synced - failed), tokenExpired: true };
      }
      failed += 1;
    }
  }
  if (synced > 0) await markOk();
  return { synced, failed, tokenExpired: false };
}

/** Once per token: the whole point is hearing about expiry immediately,
 *  without being re-pinged every hour until someone gets to it. */
async function notifyAdminsTokenExpired(savedAt: string | null) {
  const { profiles } = await import("@/db/schema");
  const { inArray } = await import("drizzle-orm");
  const { notifyMany } = await import("@/lib/notifications");
  const admins = await db
    .select({ id: profiles.id })
    .from(profiles)
    .where(inArray(profiles.role, ["owner", "admin"]));
  await notifyMany(
    admins.map((a) => a.id),
    {
      type: "mentioned",
      title: "Tessera token expired — ticket sync is stopped. Paste a fresh one in Admin.",
      href: "/admin",
      dedupKeyFor: (userId) => `tessera-expired:${savedAt ?? "unknown"}:${userId}`,
    },
  );
}
