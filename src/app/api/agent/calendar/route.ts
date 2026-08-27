import { agentRoute } from "@/lib/agent/respond";
import { listActiveEvents } from "@/lib/events/service";
import { listEventTasks } from "@/lib/tasks/service";

/**
 * GET /calendar?from=YYYY-MM-DD&to=YYYY-MM-DD (WIB dates, both optional —
 * default: the next 31 days). Show days and task due dates in one list,
 * which is exactly what the calendar page draws.
 */
export async function GET(request: Request) {
  return agentRoute(request, async ({ actor }) => {
    const url = new URL(request.url);
    const from = url.searchParams.get("from")
      ? new Date(`${url.searchParams.get("from")}T00:00:00+07:00`)
      : new Date();
    const to = url.searchParams.get("to")
      ? new Date(`${url.searchParams.get("to")}T23:59:59+07:00`)
      : new Date(from.getTime() + 31 * 86_400_000);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw new Error("from/to must be YYYY-MM-DD.");
    }

    const events = await listActiveEvents(actor);
    const inRange = (d: Date | null) => d && d >= from && d <= to;

    const entries: Array<{
      date: Date;
      kind: "show" | "task";
      title: string;
      eventId: string;
      eventName: string;
      taskId?: string;
      status?: string;
    }> = [];
    for (const event of events) {
      if (inRange(event.showDate)) {
        entries.push({
          date: event.showDate,
          kind: "show",
          title: `SHOW DAY — ${event.name}`,
          eventId: event.id,
          eventName: event.name,
        });
      }
      const tasks = await listEventTasks(actor, event.id);
      for (const task of tasks) {
        if (inRange(task.dueDate)) {
          entries.push({
            date: task.dueDate!,
            kind: "task",
            title: task.title,
            eventId: event.id,
            eventName: event.name,
            taskId: task.id,
            status: task.status,
          });
        }
      }
    }
    entries.sort((a, b) => a.date.getTime() - b.date.getTime());
    return { from, to, entries };
  });
}
