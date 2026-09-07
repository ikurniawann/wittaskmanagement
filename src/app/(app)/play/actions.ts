"use server";

import { sessionActor } from "@/lib/auth/session-actor";
import { logActivity } from "@/lib/activity";
import { can } from "@/lib/permissions";

// EPIC-024 T-247 — session telemetry. One activity row per Play session with
// the measured frame rate and device class; no PII beyond the acting user,
// which the activity log carries anyway. Numbers are clamped so a hostile
// client cannot write garbage into the audit feed.
export async function recordPlaySessionAction(input: {
  fpsP50: number | null;
  drawCalls: number;
  touch: boolean;
  dpr: number;
}): Promise<void> {
  const actor = await sessionActor();
  if (!actor || !can(actor, "play.view")) return;
  const clamp = (v: unknown, lo: number, hi: number) =>
    typeof v === "number" && Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v * 10) / 10)) : null;
  await logActivity({
    actorId: actor.id,
    action: "play.session",
    entity: "play:office",
    detail: {
      fpsP50: clamp(input.fpsP50, 0, 480),
      drawCalls: clamp(input.drawCalls, 0, 100000),
      device: input.touch ? "touch" : "desktop",
      dpr: clamp(input.dpr, 0.25, 8),
    },
  });
}
