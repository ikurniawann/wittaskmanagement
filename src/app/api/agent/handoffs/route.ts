import { agentRoute } from "@/lib/agent/respond";
import { listHandoffs, requestHandoff } from "@/lib/tasks/service";

/** GET /handoffs?eventId=… */
export async function GET(request: Request) {
  return agentRoute(request, async ({ actor }) => {
    const eventId = new URL(request.url).searchParams.get("eventId");
    if (!eventId) throw new Error("Pass ?eventId=…");
    return listHandoffs(actor, eventId);
  });
}

/** POST { eventId, fromDivisionId, toDivisionId, title, note? } */
export async function POST(request: Request) {
  return agentRoute(request, async ({ actor, keyName }) => {
    const body = (await request.json().catch(() => null)) as {
      eventId?: string;
      fromDivisionId?: string;
      toDivisionId?: string;
      title?: string;
      note?: string;
      originTaskId?: string;
    } | null;
    if (!body?.eventId || !body.fromDivisionId || !body.toDivisionId || !body.title) {
      throw new Error("eventId, fromDivisionId, toDivisionId and title are required.");
    }
    const handoff = await requestHandoff(actor, {
      eventId: body.eventId,
      fromDivisionId: body.fromDivisionId,
      toDivisionId: body.toDivisionId,
      title: body.title,
      note: body.note ? `${body.note} — via ${keyName}` : `via ${keyName}`,
      originTaskId: body.originTaskId,
    });
    return { id: handoff.id };
  });
}
