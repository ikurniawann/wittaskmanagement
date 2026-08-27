import { NextResponse } from "next/server";
import { db } from "@/db";
import { profiles, taskChecklistItems } from "@/db/schema";
import { eq } from "drizzle-orm";
import { sessionActor } from "@/lib/auth/session-actor";
import { readSharePass, SHARE_COOKIE } from "@/lib/dataroom/share-session";
import { can } from "@/lib/permissions";
import { resolveSummaryShare } from "@/lib/summary-share/service";
import type { Reader } from "@/lib/subtask-comments/identity";
import { listThread, markRead, postComment } from "@/lib/subtask-comments/service";

// One thread, two doors (Owner 2026-08-27).
//
// A colleague is admitted by the app session and their task.edit right on the
// sub-task's division; a guest by a live progress link that carries this very
// sub-task. Neither check stands in for the other, and a caller with neither
// gets the same 404 as a sub-task that does not exist — a probe learns
// nothing about what is behind the door.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function readerFor(request: Request, itemId: string): Promise<Reader | null> {
  const [item] = await db
    .select()
    .from(taskChecklistItems)
    .where(eq(taskChecklistItems.id, itemId))
    .limit(1);
  if (!item) return null;

  // door 1 — a signed-in colleague
  const actor = await sessionActor();
  if (actor) {
    const { tasks } = await import("@/db/schema");
    const [task] = await db.select().from(tasks).where(eq(tasks.id, item.taskId)).limit(1);
    if (task && can(actor, "task.edit", { divisionId: task.divisionId })) {
      const [me] = await db
        .select({ name: profiles.name })
        .from(profiles)
        .where(eq(profiles.id, actor.id))
        .limit(1);
      return { kind: "member", profileId: actor.id, name: me?.name ?? "Team" };
    }
  }

  // door 2 — a live progress link that actually contains this sub-task
  const url = new URL(request.url);
  const token = url.searchParams.get("token") ?? "";
  if (!token) return null;
  const cookie = request.headers
    .get("cookie")
    ?.split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${SHARE_COOKIE}=`))
    ?.slice(SHARE_COOKIE.length + 1);
  const pass = readSharePass(token, cookie ? decodeURIComponent(cookie) : undefined);
  const resolution = await resolveSummaryShare(token, {
    email: pass?.email ?? undefined,
    passcodeVerified: pass?.passcodeOk,
  });
  if (!resolution.ok || resolution.view.kind !== "task") return null;

  const { summaryShareLinks } = await import("@/db/schema");
  const [link] = await db
    .select()
    .from(summaryShareLinks)
    .where(eq(summaryShareLinks.id, resolution.linkId))
    .limit(1);
  // the binding that stops one link opening another task's conversation
  if (!link?.taskId || link.taskId !== item.taskId) return null;

  return {
    kind: "guest",
    shareLinkId: link.id,
    email: resolution.viewerEmail,
    name: resolution.viewerEmail?.split("@")[0] || "Guest",
  };
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ itemId: string }> },
) {
  const { itemId } = await params;
  const reader = await readerFor(request, itemId);
  if (!reader) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const thread = await listThread(itemId, reader);
  await markRead(itemId, reader);
  return NextResponse.json({ ok: true, ...thread });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ itemId: string }> },
) {
  const { itemId } = await params;
  const reader = await readerFor(request, itemId);
  if (!reader) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const body = (await request.json().catch(() => ({}))) as { body?: string };
  try {
    await postComment(itemId, reader, String(body.body ?? ""));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not post." },
      { status: 400 },
    );
  }
  return NextResponse.json({ ok: true, ...(await listThread(itemId, reader)) });
}
