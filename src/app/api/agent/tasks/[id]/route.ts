import { agentRoute } from "@/lib/agent/respond";
import {
  getTaskScoped,
  updateStatus,
  updateTaskFields,
  type TaskStatus,
} from "@/lib/tasks/service";

const STATUSES = [
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "blocked",
  "done",
  "cancelled",
] as const;
const PRIORITIES = ["low", "medium", "high", "urgent"] as const;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return agentRoute(request, async ({ actor }) => {
    const { id } = await params;
    const scoped = await getTaskScoped(actor, id);
    if (!scoped) throw new Error("Task not found.");
    return scoped;
  });
}

/** PATCH { status?, priority?, title?, dueDate? } — narrow on purpose. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return agentRoute(request, async ({ actor }) => {
    const { id } = await params;
    const body = (await request.json().catch(() => null)) as {
      status?: string;
      priority?: string;
      title?: string;
      dueDate?: string | null;
    } | null;
    if (!body) throw new Error("A JSON body is required.");

    const changed: string[] = [];
    if (body.status !== undefined) {
      if (!STATUSES.includes(body.status as never)) {
        throw new Error(`status must be one of: ${STATUSES.join(", ")}.`);
      }
      await updateStatus(actor, id, body.status as TaskStatus);
      changed.push("status");
    }
    const fields: Parameters<typeof updateTaskFields>[2] = {};
    if (body.priority !== undefined) {
      if (!PRIORITIES.includes(body.priority as never)) {
        throw new Error(`priority must be one of: ${PRIORITIES.join(", ")}.`);
      }
      fields.priority = body.priority as (typeof PRIORITIES)[number];
    }
    if (body.title !== undefined) {
      if (!body.title.trim()) throw new Error("title cannot be empty.");
      fields.title = body.title.trim();
    }
    if (body.dueDate !== undefined) {
      if (body.dueDate === null) fields.dueDate = null;
      else {
        const due = new Date(body.dueDate);
        if (Number.isNaN(due.getTime())) throw new Error("dueDate is invalid.");
        fields.dueDate = due;
      }
    }
    if (Object.keys(fields).length > 0) {
      await updateTaskFields(actor, id, fields);
      changed.push(...Object.keys(fields));
    }
    if (changed.length === 0) {
      throw new Error("Nothing to change — pass status, priority, title or dueDate.");
    }
    return { changed };
  });
}
