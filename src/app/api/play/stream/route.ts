import { and, asc, gt } from "drizzle-orm";
import { db } from "@/db";
import { activityLog } from "@/db/schema";
import { sessionActor } from "@/lib/auth/session-actor";
import { canViewEvent } from "@/lib/events/visibility";
import { can, type Actor } from "@/lib/permissions";
import { isPlayEnabled } from "@/lib/play/settings";
import { entityOf, type ActivityRow } from "@/lib/play/world/diff";
import { getTaskScoped } from "@/lib/tasks/service";

export const dynamic = "force-dynamic";

// EPIC-025 T-250 — SSE of activity_log rows after a cursor, filtered per actor.
// Same shape as the notifications stream: poll every POLL_MS, emit only when
// there is something, keepalive comments otherwise, close after MAX_MS so a
// forgotten tab reconnects with a fresh cursor instead of holding a DB slot.
const POLL_MS = 3000;
const MAX_MS = 15 * 60 * 1000;
const BATCH = 200;

async function visibleTo(actor: Actor, row: typeof activityLog.$inferSelect, taskCache: Map<string, boolean>): Promise<boolean> {
  const { type, id } = entityOf(row.entity);
  if (type === "task" && id) {
    let ok = taskCache.get(id);
    if (ok === undefined) {
      ok = (await getTaskScoped(actor, id)) !== null;
      taskCache.set(id, ok);
    }
    return ok;
  }
  if (type === "handoff" || type === "approval") {
    if (row.actorId === actor.id) return true;
    if (row.eventId) return canViewEvent(actor, row.eventId);
    return can(actor, "dashboard.view");
  }
  return false; // nothing else is drawn
}

export async function GET(request: Request) {
  const actor = await sessionActor();
  if (!actor) return new Response("Unauthorized", { status: 401 });
  if (!(await isPlayEnabled()) || !can(actor, "play.view")) return new Response("Not found", { status: 404 });
  const url = new URL(request.url);
  const start = url.searchParams.get("cursor");
  let cursor = start && !Number.isNaN(Date.parse(start)) ? new Date(start) : new Date();
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const opened = Date.now();
      const push = async () => {
        if (closed) return;
        try {
          const rows = await db
            .select()
            .from(activityLog)
            .where(and(gt(activityLog.createdAt, cursor)))
            .orderBy(asc(activityLog.createdAt))
            .limit(BATCH);
          if (rows.length) {
            cursor = rows[rows.length - 1].createdAt;
            const taskCache = new Map<string, boolean>();
            const out: ActivityRow[] = [];
            for (const r of rows) {
              if (!(await visibleTo(actor, r, taskCache))) continue;
              out.push({
                id: r.id,
                action: r.action,
                entity: r.entity,
                detail: (r.detail as Record<string, unknown> | null) ?? null,
                actorId: r.actorId,
                eventId: r.eventId,
                createdAt: r.createdAt.toISOString(),
              });
            }
            if (out.length) controller.enqueue(encoder.encode(`data: ${JSON.stringify({ cursor: cursor.toISOString(), rows: out })}\n\n`));
            else controller.enqueue(encoder.encode(`: cursor ${cursor.toISOString()}\n\n`));
          } else {
            controller.enqueue(encoder.encode(": keepalive\n\n"));
          }
        } catch {
          // transient DB error — keep the stream alive, retry next tick
        }
        if (Date.now() - opened > MAX_MS) close();
      };
      const timer = setInterval(push, POLL_MS);
      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(timer);
        try { controller.close(); } catch { /* already closed */ }
      };
      request.signal.addEventListener("abort", close);
      void push();
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" },
  });
}
