import { agentRoute } from "@/lib/agent/respond";
import { listActiveEvents } from "@/lib/events/service";

/** Events this person may see — the same visibility rule as the app. */
export async function GET(request: Request) {
  return agentRoute(request, async ({ actor }) => {
    const events = await listActiveEvents(actor);
    return events.map((e) => ({
      id: e.id,
      name: e.name,
      showDate: e.showDate,
      venue: e.venue,
      health: e.health,
    }));
  });
}
