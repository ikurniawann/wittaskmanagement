import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { appSettings } from "@/db/schema";
import { logActivity } from "@/lib/activity";
import { assertCan, type Actor } from "@/lib/permissions";

// Which outside services this installation talks to (Owner 2026-08-31).
//
// Stored in app_settings under `integration_<key>_enabled`, the same accessor
// pattern as branding and the WhatsApp templates — no new table, no migration.
//
// EVERY integration is off until somebody turns it on. A missing row therefore
// means "off", which is also what a fresh install and a wiped settings table
// mean: the safe reading is the same in all three cases, so there is no state
// where a connection is quietly live because nobody said otherwise.

export type IntegrationKey = "megatix";

export interface IntegrationSpec {
  key: IntegrationKey;
  name: string;
  /** what it does, in the words someone deciding would want */
  summary: string;
  /** where its own settings live once it is on */
  configuredAt: string;
}

export const INTEGRATIONS: readonly IntegrationSpec[] = [
  {
    key: "megatix",
    name: "Megatix",
    summary:
      "Pulls ticket sales into each project — daily totals, buyer fees and per-transaction detail.",
    configuredAt: "Admin → Megatix ticketing",
  },
];

function settingKey(key: IntegrationKey): string {
  return `integration_${key}_enabled`;
}

function asBool(value: unknown): boolean {
  // jsonb round-trips as a real boolean, but a hand-edited row could be the
  // string "true"; both are accepted, everything else reads as off
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value.replaceAll('"', "").trim() === "true";
  return false;
}

/**
 * Never throws. A database wobble must not switch an integration on by
 * accident, and it must not break the page asking the question either — so a
 * failure reads as "off", the same as absent.
 */
export async function isIntegrationEnabled(key: IntegrationKey): Promise<boolean> {
  try {
    const [row] = await db
      .select()
      .from(appSettings)
      .where(eq(appSettings.key, settingKey(key)))
      .limit(1);
    return asBool(row?.value);
  } catch {
    return false;
  }
}

export async function integrationStates(): Promise<Record<IntegrationKey, boolean>> {
  const out = Object.fromEntries(
    INTEGRATIONS.map((i) => [i.key, false]),
  ) as Record<IntegrationKey, boolean>;
  try {
    const rows = await db
      .select()
      .from(appSettings)
      .where(inArray(appSettings.key, INTEGRATIONS.map((i) => settingKey(i.key))));
    for (const row of rows) {
      const spec = INTEGRATIONS.find((i) => settingKey(i.key) === row.key);
      if (spec) out[spec.key] = asBool(row.value);
    }
  } catch {
    // leave every one off
  }
  return out;
}

export async function setIntegrationEnabled(
  actor: Actor,
  key: IntegrationKey,
  enabled: boolean,
): Promise<void> {
  assertCan(actor, "org.manage");
  if (!INTEGRATIONS.some((i) => i.key === key)) {
    throw new Error("Unknown integration.");
  }
  await db
    .insert(appSettings)
    .values({ key: settingKey(key), value: enabled })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value: enabled, updatedAt: new Date() },
    });
  await logActivity({
    actorId: actor.id,
    action: enabled ? "integration.enable" : "integration.disable",
    entity: `integration:${key}`,
  });
}
