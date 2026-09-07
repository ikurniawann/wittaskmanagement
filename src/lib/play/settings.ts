import { eq } from "drizzle-orm";
import { db } from "@/db";
import { appSettings } from "@/db/schema";
import { logActivity } from "@/lib/activity";
import { assertCan, type Actor } from "@/lib/permissions";

// Backstage Play feature flag (EPIC-024 T-240). Same accessor pattern as
// src/lib/integrations/service.ts: one app_settings row, no migration, and a
// missing/broken row reads as OFF — a fresh install never shows the 3D office
// until an admin turns it on.

export const PLAY_ENABLED_KEY = "play_enabled";

function asBool(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value.replaceAll('"', "").trim() === "true";
  return false;
}

/** Never throws — a database wobble must not open or break the page. */
export async function isPlayEnabled(): Promise<boolean> {
  try {
    const [row] = await db
      .select()
      .from(appSettings)
      .where(eq(appSettings.key, PLAY_ENABLED_KEY))
      .limit(1);
    return asBool(row?.value);
  } catch {
    return false;
  }
}

export async function setPlayEnabled(actor: Actor, enabled: boolean): Promise<void> {
  assertCan(actor, "org.manage");
  await db
    .insert(appSettings)
    .values({ key: PLAY_ENABLED_KEY, value: enabled })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value: enabled, updatedAt: new Date() },
    });
  await logActivity({
    actorId: actor.id,
    action: enabled ? "play.enable" : "play.disable",
    entity: "setting:play_enabled",
  });
}
