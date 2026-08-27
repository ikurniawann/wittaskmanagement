import { and, eq } from "drizzle-orm";
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
import {
  extractEvents,
  extractOrders,
  extractPresenters,
  summariseOrders,
  type MegatixEventRow,
  type MegatixPresenter,
} from "./extract";

// Megatix Data API (Owner 2026-08-17) — the second ticketing channel.
//
// It differs from Tessera in the one way that matters operationally: auth is
// email + password against /auth/login, which returns a bearer token good for
// ~8 hours. So there is no five-day paste ritual — this module logs in again
// by itself whenever the token is missing, aged out, or rejected.
//
// The price of that convenience is that an API PASSWORD lives in the
// database. It is stored write-only (never returned to a browser), used only
// server-side, never logged, and never included in an error message. Use a
// dedicated Megatix login for this, not a personal admin account: anything
// that reads the database can otherwise act as that user on Megatix.

const KEY_CREDS = "megatix_credentials";
const KEY_SESSION = "megatix_session";
const KEY_STATUS = "megatix_status";

/**
 * Verified by probe 2026-08-17: the API lives on the bare domain. The
 * documentation ships `{{hostname}}` as a Postman variable and never prints
 * the value, and the obvious guess — api.megatix.com.au — does not exist in
 * DNS at all. This host answers /auth/login with a proper 422
 * authentication_failed, which is the endpoint behaving correctly.
 * Still overridable: the host may be region-scoped.
 */
export const DEFAULT_MEGATIX_BASE = "https://megatix.com.au";

export class MegatixAuthError extends Error {
  constructor(message = "Megatix rejected the credentials (401).") {
    super(message);
  }
}

interface StoredCreds {
  email: string;
  password: string;
  baseUrl: string;
  savedAt: string;
}

interface StoredSession {
  token: string;
  /** absolute expiry, ISO — computed from expires_in at login */
  expiresAt: string;
}

export interface MegatixStatus {
  configured: boolean;
  email: string | null;
  baseUrl: string;
  savedAt: string | null;
  tokenValidUntil: string | null;
  /** computed here, not in the panel: Date.now() during render is impure
   *  under the React compiler, and a lib function is where clocks live */
  tokenLive: boolean;
  lastOkAt: string | null;
  lastError: string | null;
  unreadableSample: string | null;
}

async function readSetting(key: string): Promise<unknown> {
  const [row] = await db
    .select()
    .from(appSettings)
    .where(eq(appSettings.key, key))
    .limit(1);
  return row?.value ?? null;
}

/**
 * Removes a setting entirely. Writing null here would violate app_settings'
 * NOT NULL on `value` — "forget this" has to mean deleting the row, not
 * storing an empty one.
 */
async function dropSetting(key: string) {
  await db.delete(appSettings).where(eq(appSettings.key, key));
}

async function writeSetting(key: string, value: unknown) {
  await db
    .insert(appSettings)
    .values({ key, value: value as never })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value: value as never, updatedAt: new Date() },
    });
}

async function credentials(): Promise<StoredCreds | null> {
  const raw = (await readSetting(KEY_CREDS)) as Partial<StoredCreds> | null;
  if (!raw || !raw.email || !raw.password) return null;
  return {
    email: raw.email,
    password: raw.password,
    baseUrl: raw.baseUrl || DEFAULT_MEGATIX_BASE,
    savedAt: raw.savedAt ?? "",
  };
}

export async function getMegatixStatus(actor: Actor): Promise<MegatixStatus> {
  assertCan(actor, "org.manage");
  const creds = await credentials();
  const session = (await readSetting(KEY_SESSION)) as StoredSession | null;
  const status = ((await readSetting(KEY_STATUS)) ?? {}) as Partial<MegatixStatus>;
  return {
    configured: Boolean(creds),
    // the email identifies the connection; the password never comes back out
    email: creds?.email ?? null,
    baseUrl: creds?.baseUrl ?? DEFAULT_MEGATIX_BASE,
    savedAt: creds?.savedAt || null,
    tokenValidUntil: session?.expiresAt ?? null,
    tokenLive: session?.expiresAt
      ? new Date(session.expiresAt).getTime() > Date.now()
      : false,
    lastOkAt: status.lastOkAt ?? null,
    lastError: status.lastError ?? null,
    unreadableSample: status.unreadableSample ?? null,
  };
}

export async function saveMegatixCredentials(
  actor: Actor,
  input: { email: string; password: string; baseUrl?: string },
) {
  assertCan(actor, "org.manage");
  const email = input.email.trim();
  const password = input.password;
  if (!email || !password) throw new Error("Both email and password are required.");
  const baseUrl = (input.baseUrl?.trim() || DEFAULT_MEGATIX_BASE).replace(/\/+$/, "");
  await writeSetting(KEY_CREDS, {
    email,
    password,
    baseUrl,
    savedAt: new Date().toISOString(),
  } satisfies StoredCreds);
  // a new login invalidates whatever session was cached for the old one
  await dropSetting(KEY_SESSION);
  await logActivity({
    actorId: actor.id,
    action: "megatix.credentials_saved",
    entity: "org:megatix",
    // the password never reaches the log
    detail: { email, baseUrl },
  });
}

export async function clearMegatixCredentials(actor: Actor) {
  assertCan(actor, "org.manage");
  await dropSetting(KEY_CREDS);
  await dropSetting(KEY_SESSION);
  await logActivity({
    actorId: actor.id,
    action: "megatix.credentials_cleared",
    entity: "org:megatix",
    detail: {},
  });
}

/** Logs in and caches the token with a safety margin before its expiry. */
async function login(creds: StoredCreds): Promise<string> {
  const response = await fetch(`${creds.baseUrl}/api/v4/data/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ email: creds.email, password: creds.password }),
    signal: AbortSignal.timeout(20_000),
    cache: "no-store",
  });
  if (response.status === 401 || response.status === 422) {
    throw new MegatixAuthError();
  }
  if (!response.ok) {
    throw new Error(`Megatix login answered ${response.status}.`);
  }
  const payload = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
  };
  const token = payload.access_token;
  if (!token) throw new MegatixAuthError("Megatix login returned no access token.");
  // 5 minutes of margin: a token that expires mid-sync would otherwise turn
  // a healthy run into a spurious auth failure
  const seconds = Math.max(60, (payload.expires_in ?? 28_799) - 300);
  await writeSetting(KEY_SESSION, {
    token,
    expiresAt: new Date(Date.now() + seconds * 1000).toISOString(),
  } satisfies StoredSession);
  return token;
}

async function tokenFor(creds: StoredCreds): Promise<string> {
  const session = (await readSetting(KEY_SESSION)) as StoredSession | null;
  if (session?.token && new Date(session.expiresAt).getTime() > Date.now()) {
    return session.token;
  }
  return login(creds);
}

/**
 * One GET, with a single automatic re-login if the cached token is rejected.
 * Bounded to one retry on purpose: a wrong password must fail fast and loudly
 * rather than hammer their login endpoint.
 */
async function request(path: string, query: Record<string, string | number> = {}) {
  const creds = await credentials();
  if (!creds) throw new Error("Megatix is not connected.");
  const url = new URL(`${creds.baseUrl}/api/v4/data/${path}`);
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, String(value));
  }

  const call = async (token: string) =>
    fetch(url, {
      headers: { accept: "application/json", authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(30_000),
      cache: "no-store",
    });

  let response = await call(await tokenFor(creds));
  if (response.status === 401) {
    response = await call(await login(creds));
  }
  if (response.status === 401) throw new MegatixAuthError();
  if (!response.ok) {
    throw new Error(`Megatix answered ${response.status} for ${path}.`);
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
  const prior = ((await readSetting(KEY_STATUS)) ?? {}) as Partial<MegatixStatus>;
  await writeSetting(KEY_STATUS, {
    lastOkAt: prior.lastOkAt ?? null,
    lastError: error instanceof Error ? error.message : "Megatix request failed.",
    unreadableSample: sample
      ? JSON.stringify(sample).slice(0, 2000)
      : (prior.unreadableSample ?? null),
  });
}

/** The connection test AND the source for the presenter picker. */
export async function listMegatixPresenters(actor: Actor): Promise<MegatixPresenter[]> {
  assertCan(actor, "org.manage");
  try {
    const payload = await request("presenters");
    const rows = extractPresenters(payload);
    if (rows.length === 0) await markFailed(new Error("No readable presenters."), payload);
    else await markOk();
    return rows;
  } catch (error) {
    await markFailed(error);
    throw error;
  }
}

export async function listMegatixEvents(
  actor: Actor,
  presenterId: string,
): Promise<MegatixEventRow[]> {
  assertCan(actor, "org.manage");
  try {
    const payload = await request("events", { presenter_id: presenterId });
    const rows = extractEvents(payload);
    if (rows.length === 0) await markFailed(new Error("No readable events."), payload);
    else await markOk();
    return rows;
  } catch (error) {
    await markFailed(error);
    throw error;
  }
}

/**
 * Pulls every page of orders for one Megatix event.
 *
 * Paging is followed to the end rather than capped: a partial pull written
 * into the snapshot would look exactly like a show that stopped selling.
 */
async function fetchAllOrders(providerEventId: string) {
  const all: ReturnType<typeof extractOrders> = [];
  let page = 1;
  // a hard ceiling purely as a runaway guard — 200 pages × 1000 rows
  while (page <= 200) {
    const payload = await request("reports/orders", {
      event_id: providerEventId,
      page,
    });
    const rows = extractOrders(payload);
    all.push(...rows);
    const size = Number(
      (payload as { page_size?: unknown }).page_size ?? rows.length,
    );
    const limit = Number(
      (payload as { page_size_limit?: unknown }).page_size_limit ?? 0,
    );
    // last page: the server returned fewer rows than a full page
    if (!limit || size < limit || rows.length === 0) break;
    page += 1;
  }
  return all;
}

/**
 * Syncs every event connected to the Megatix channel: stores each order as
 * is, then writes today's aggregate snapshot from those same rows.
 *
 * The snapshot is derived from the stored orders rather than a separate
 * totals endpoint on purpose — one source, so the table and the headline can
 * never disagree.
 */
export async function syncMegatixSales(): Promise<{
  synced: number;
  failed: number;
  authFailed: boolean;
}> {
  const creds = await credentials();
  if (!creds) return { synced: 0, failed: 0, authFailed: false };

  const channels = await db
    .select({
      eventId: eventTicketChannels.eventId,
      providerEventId: eventTicketChannels.providerEventId,
    })
    .from(eventTicketChannels)
    .where(eq(eventTicketChannels.provider, "megatix"));
  if (channels.length === 0) return { synced: 0, failed: 0, authFailed: false };

  let synced = 0;
  let failed = 0;
  const day = wibDayKey(new Date());

  for (const channel of channels) {
    try {
      const orders = await fetchAllOrders(channel.providerEventId);

      for (const order of orders) {
        const values = {
          eventId: channel.eventId,
          provider: "megatix",
          providerTxnId: order.orderNumber,
          orderId: order.orderNumber,
          buyerEmail: order.buyerEmail,
          buyerName: order.buyerName,
          buyerPhone: order.buyerPhone,
          status: order.completedAtRaw ? "completed" : null,
          currency: order.currency,
          purchasedAt: order.completedAt,
          quantity: order.quantity,
          // Megatix reports the tickets' subtotal and the total charged; it
          // does NOT report a promoter-net figure, so netSales stays null
          // rather than being guessed from the two.
          ticketPrice: order.ticketSubtotal,
          grossSales: order.amount,
          totalFees: order.transactionFee,
          discountAmount: order.discountAmount,
          refundedAmount: order.refundedAmount,
          raw: order.raw,
          syncedAt: new Date(),
        };
        await db
          .insert(ticketTransactions)
          .values(values)
          .onConflictDoUpdate({
            target: [
              ticketTransactions.provider,
              ticketTransactions.eventId,
              ticketTransactions.providerTxnId,
            ],
            set: values,
          });
      }

      const totals = summariseOrders(orders);
      // revenue as the tickets' face value, not the total charged: Tessera
      // reports the same figure, so the two channels stay addable. The
      // buyer-paid fees remain visible per row and in the channel cards.
      const faceValue = orders.reduce(
        (sum, o) => sum + (o.ticketSubtotal ? Number(o.ticketSubtotal) : 0),
        0,
      );
      await recordChannelDaily({
        eventId: channel.eventId,
        provider: "megatix",
        day,
        tickets: totals.tickets,
        revenue: faceValue,
      });
      synced += 1;
    } catch (error) {
      if (error instanceof MegatixAuthError) {
        await markFailed(error);
        return { synced, failed, authFailed: true };
      }
      failed += 1;
      await markFailed(error);
    }
  }

  if (synced > 0 && failed === 0) await markOk();
  return { synced, failed, authFailed: false };
}

/** Connects (or re-points) an event's Megatix channel. */
export async function mapMegatixEvent(
  actor: Actor,
  eventId: string,
  input: { providerEventId: string; presenterId: string | null },
) {
  assertCan(actor, "org.manage");
  const providerEventId = input.providerEventId.trim();
  if (!providerEventId) {
    await db
      .delete(eventTicketChannels)
      .where(
        and(
          eq(eventTicketChannels.eventId, eventId),
          eq(eventTicketChannels.provider, "megatix"),
        ),
      );
  } else {
    await db
      .insert(eventTicketChannels)
      .values({
        eventId,
        provider: "megatix",
        providerEventId,
        providerAccountId: input.presenterId,
      })
      .onConflictDoUpdate({
        target: [eventTicketChannels.eventId, eventTicketChannels.provider],
        set: { providerEventId, providerAccountId: input.presenterId },
      });
  }
  await db
    .update(events)
    .set({ updatedAt: new Date() })
    .where(eq(events.id, eventId));
  await logActivity({
    actorId: actor.id,
    action: "megatix.event_mapped",
    entity: `event:${eventId}`,
    detail: { providerEventId: providerEventId || "(disconnected)" },
    eventId,
  });
}
