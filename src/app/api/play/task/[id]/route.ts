import { sessionActor } from "@/lib/auth/session-actor";
import { PermissionError } from "@/lib/permissions";
import { getPlayTask } from "@/lib/play/service";

export const dynamic = "force-dynamic";

// EPIC-025 T-250 — one task for the diff engine's "refetch this task". Same
// visibility as the task page; a task the actor may not see is simply null.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const actor = await sessionActor();
  if (!actor) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  try {
    const task = await getPlayTask(actor, id);
    return Response.json({ ok: true, task });
  } catch (error) {
    if (error instanceof PermissionError) return Response.json({ ok: false, error: "Forbidden" }, { status: 403 });
    throw error;
  }
}
