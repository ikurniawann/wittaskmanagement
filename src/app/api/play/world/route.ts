import { sessionActor } from "@/lib/auth/session-actor";
import { PermissionError } from "@/lib/permissions";
import { getPlayWorld } from "@/lib/play/service";
import { isPlayEnabled } from "@/lib/play/settings";

export const dynamic = "force-dynamic";

// EPIC-024 T-242 — the world snapshot over HTTP (the page itself calls the
// service directly; this is for refreshes and for tests).
export async function GET() {
  const actor = await sessionActor();
  if (!actor) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!(await isPlayEnabled())) return Response.json({ ok: false, error: "Not found" }, { status: 404 });
  try {
    return Response.json({ ok: true, world: await getPlayWorld(actor) });
  } catch (error) {
    if (error instanceof PermissionError) return Response.json({ ok: false, error: "Forbidden" }, { status: 403 });
    throw error;
  }
}
