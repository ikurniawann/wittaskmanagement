import { agentRoute } from "@/lib/agent/respond";
import { addRunOfShowItem, listRunOfShow } from "@/lib/run-of-show/service";

/** GET /run-of-show?eventId=… */
export async function GET(request: Request) {
  return agentRoute(request, async ({ actor }) => {
    const eventId = new URL(request.url).searchParams.get("eventId");
    if (!eventId) throw new Error("Pass ?eventId=…");
    return listRunOfShow(actor, eventId);
  });
}

/** POST { eventId, startTime: "HH:MM", title, durationMinutes?, note? } */
export async function POST(request: Request) {
  return agentRoute(request, async ({ actor }) => {
    const body = (await request.json().catch(() => null)) as {
      eventId?: string;
      startTime?: string;
      durationMinutes?: number;
      title?: string;
      note?: string;
    } | null;
    if (!body?.eventId || !body.startTime || !body.title) {
      throw new Error('eventId, startTime ("HH:MM" WIB) and title are required.');
    }
    const item = await addRunOfShowItem(actor, {
      eventId: body.eventId,
      startTime: body.startTime,
      durationMinutes: body.durationMinutes,
      title: body.title,
      note: body.note,
    });
    return { id: item.id };
  });
}
