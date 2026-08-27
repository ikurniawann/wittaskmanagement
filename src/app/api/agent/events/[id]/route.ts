import { agentRoute } from "@/lib/agent/respond";
import { getEvent, getEventPeople, listEventDivisions } from "@/lib/events/service";
import { listSnapshots } from "@/lib/tickets/service";

/** One event: header facts, crew, divisions, latest ticket figures. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return agentRoute(request, async ({ actor }) => {
    const { id } = await params;
    const event = await getEvent(actor, id);
    if (!event) throw new Error("Event not found.");
    const [crew, divisions, snapshots] = await Promise.all([
      getEventPeople(actor, id),
      listEventDivisions(actor, id),
      listSnapshots(actor, id),
    ]);
    const latest = snapshots.at(-1) ?? null;
    return {
      id: event.id,
      name: event.name,
      artists: event.artists,
      venue: event.venue,
      showDate: event.showDate,
      capacity: event.capacity,
      health: event.health,
      phase: event.phaseName,
      pic: crew.pic ? { id: crew.pic.id, name: crew.pic.name } : null,
      members: crew.members.map((m) => ({ id: m.id, name: m.name })),
      divisions: divisions.map((d) => ({ id: d.id, name: d.name })),
      tickets: latest
        ? { day: latest.day, sold: latest.ticketsSold, revenue: latest.revenue, note: latest.note }
        : null,
    };
  });
}
