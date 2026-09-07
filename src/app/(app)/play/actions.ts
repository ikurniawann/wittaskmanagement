"use server";

import { sessionActor } from "@/lib/auth/session-actor";
import { logActivity } from "@/lib/activity";
import { can, PermissionError } from "@/lib/permissions";
import { getPlayTask } from "@/lib/play/service";
import type { PlayTask } from "@/lib/play/types";
import type { TaskStatus } from "@/lib/tasks/status";

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

// EPIC-025 T-251 — quick actions. Every one of these calls the SAME service
// the classic UI calls, so permission checks, notifications and the activity
// row are identical. Play adds one extra row (`play.action`) that says the
// action was taken from the office — the attribution the PRD asks for without
// touching the services' own logging.
export type ActionResult = { ok: true; task: PlayTask | null } | { ok: false; error: string };

function fail(error: unknown): ActionResult {
  if (error instanceof PermissionError) return { ok: false, error: "You are not allowed to do that on this task." };
  return { ok: false, error: error instanceof Error ? error.message : "Could not do that." };
}

async function mark(actorId: string, kind: string, taskId: string, extra: Record<string, unknown> = {}): Promise<void> {
  await logActivity({ actorId, action: "play.action", entity: `task:${taskId}`, detail: { source: "play", kind, ...extra } });
}

export async function setTaskStatusAction(taskId: string, status: TaskStatus): Promise<ActionResult> {
  const actor = await sessionActor();
  if (!actor || !can(actor, "play.view")) return { ok: false, error: "Not signed in." };
  try {
    const { updateStatus } = await import("@/lib/tasks/service");
    await updateStatus(actor, taskId, status);
    await mark(actor.id, "status", taskId, { to: status });
    return { ok: true, task: await getPlayTask(actor, taskId) };
  } catch (error) {
    return fail(error);
  }
}

export async function commentTaskAction(taskId: string, body: string): Promise<ActionResult> {
  const actor = await sessionActor();
  if (!actor || !can(actor, "play.view")) return { ok: false, error: "Not signed in." };
  const text = body.trim();
  if (!text) return { ok: false, error: "Write something first." };
  try {
    const { addComment } = await import("@/lib/tasks/service");
    await addComment(actor, taskId, text.slice(0, 4000));
    await mark(actor.id, "comment", taskId);
    return { ok: true, task: await getPlayTask(actor, taskId) };
  } catch (error) {
    return fail(error);
  }
}

export async function claimTaskAction(taskId: string): Promise<ActionResult> {
  const actor = await sessionActor();
  if (!actor || !can(actor, "play.view")) return { ok: false, error: "Not signed in." };
  try {
    const { assignUser } = await import("@/lib/tasks/service");
    await assignUser(actor, taskId, actor.id);
    await mark(actor.id, "claim", taskId);
    return { ok: true, task: await getPlayTask(actor, taskId) };
  } catch (error) {
    return fail(error);
  }
}

export async function decideHandoffAction(handoffId: string, accept: boolean): Promise<{ ok: true } | { ok: false; error: string }> {
  const actor = await sessionActor();
  if (!actor || !can(actor, "play.view")) return { ok: false, error: "Not signed in." };
  try {
    const { decideHandoff } = await import("@/lib/tasks/service");
    await decideHandoff(actor, handoffId, accept);
    await logActivity({ actorId: actor.id, action: "play.action", entity: `handoff:${handoffId}`, detail: { source: "play", kind: accept ? "handoff.accept" : "handoff.decline" } });
    return { ok: true };
  } catch (error) {
    const f = fail(error);
    return f.ok ? { ok: true } : f;
  }
}

// EPIC-026 T-264 — the person's own leaderboard consent. Nobody else can set it.
export async function setLeaderboardOptInAction(on: boolean): Promise<{ ok: true } | { ok: false; error: string }> {
  const actor = await sessionActor();
  if (!actor || !can(actor, "play.view")) return { ok: false, error: "Not signed in." };
  const { setMyLeaderboardOptIn } = await import("@/lib/play/xp/admin");
  await setMyLeaderboardOptIn(actor, on);
  return { ok: true };
}
