import { agentRoute } from "@/lib/agent/respond";
import { deleteRunOfShowItem, updateRunOfShowItem } from "@/lib/run-of-show/service";

/** PATCH { startTime, title, durationMinutes?, note? } — full replace. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return agentRoute(request, async ({ actor }) => {
    const { id } = await params;
    const body = (await request.json().catch(() => null)) as {
      startTime?: string;
      durationMinutes?: number;
      title?: string;
      note?: string;
    } | null;
    if (!body?.startTime || !body.title) {
      throw new Error('startTime ("HH:MM" WIB) and title are required.');
    }
    await updateRunOfShowItem(actor, id, {
      startTime: body.startTime,
      durationMinutes: body.durationMinutes,
      title: body.title,
      note: body.note,
    });
    return { updated: true };
  });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return agentRoute(request, async ({ actor }) => {
    const { id } = await params;
    await deleteRunOfShowItem(actor, id);
    return { deleted: true };
  });
}
