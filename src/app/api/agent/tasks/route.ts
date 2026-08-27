import { agentRoute } from "@/lib/agent/respond";
import { createTask, listEventTasks, listMyTasks } from "@/lib/tasks/service";

/**
 * GET  /api/agent/tasks?eventId=…&status=…   — tasks of one event
 * GET  /api/agent/tasks?mine=1               — the speaker's own tasks
 * POST /api/agent/tasks                      — create one
 * All visibility and rights come from the acting user, never the key.
 */
export async function GET(request: Request) {
  return agentRoute(request, async ({ actor }) => {
    const url = new URL(request.url);
    if (url.searchParams.get("mine")) {
      const mine = await listMyTasks(actor);
      return mine.map(({ task, eventName }) => ({
        id: task.id,
        title: task.title,
        status: task.status,
        priority: task.priority,
        dueDate: task.dueDate,
        eventId: task.eventId,
        eventName,
      }));
    }
    const eventId = url.searchParams.get("eventId");
    if (!eventId) throw new Error("Pass ?eventId=… or ?mine=1.");
    const status = url.searchParams.get("status");
    const rows = await listEventTasks(actor, eventId, {
      status: (status as never) ?? undefined,
    });
    return rows.map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      priority: t.priority,
      dueDate: t.dueDate,
      divisionId: t.divisionId,
    }));
  });
}

export async function POST(request: Request) {
  return agentRoute(request, async ({ actor, keyName, msisdn }) => {
    const body = (await request.json().catch(() => null)) as {
      eventId?: string;
      divisionId?: string;
      title?: string;
      description?: string;
      priority?: "low" | "medium" | "high" | "urgent";
      dueDate?: string;
    } | null;
    if (!body?.eventId || !body.divisionId || !body.title) {
      throw new Error("eventId, divisionId and title are required.");
    }
    const due = body.dueDate ? new Date(body.dueDate) : undefined;
    if (due && Number.isNaN(due.getTime())) throw new Error("dueDate is invalid.");
    const task = await createTask(actor, {
      eventId: body.eventId,
      divisionId: body.divisionId,
      title: body.title,
      description: body.description
        ? `${body.description}\n\n— via agent ${keyName} (wa:${msisdn})`
        : `— via agent ${keyName} (wa:${msisdn})`,
      priority: body.priority,
      dueDate: due,
    });
    return { id: task.id, title: task.title };
  });
}
