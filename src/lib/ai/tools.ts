import { db } from "@/db";
import { profiles } from "@/db/schema";
import { eq } from "drizzle-orm";
import { listFilesForAssistant } from "@/lib/dataroom/service";
import { listActiveEvents, listEventDivisions, listEventPeople } from "@/lib/events/service";
import type { Actor } from "@/lib/permissions";
import { globalSearch } from "@/lib/search/service";
import { listThread } from "@/lib/subtask-comments/service";
import { getTaskDetail, listEventTasks, listMyTasks } from "@/lib/tasks/service";

// What the assistant may look up on its own (Owner 2026-09-06: "task apa
// saja?" was answered with "the snapshot has no detail"). The snapshot stays
// a summary; for anything deeper the model calls one of these, the way a
// colleague would open the page.
//
// Every tool runs AS THE ASKER through the same permission-scoped services
// the UI and the Agent API use — nothing here reaches around a sealed folder,
// a restricted task or a division the asker cannot see. All read-only.
// Results are capped so one call cannot balloon the prompt.

const MAX_ROWS = 80;

export const ASSISTANT_TOOLS = [
  {
    type: "function",
    function: {
      name: "list_projects",
      description: "Every active project this user can see, with launch date, phase and health.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "list_tasks",
      description:
        "Tasks of one project: title, status, priority, division, dates, lead, assignees. Use this whenever asked WHICH tasks exist, are late, are open, etc.",
      parameters: {
        type: "object",
        properties: {
          eventId: { type: "string", description: "project id from the snapshot or list_projects" },
          status: { type: "string", description: "optional: backlog|todo|in_progress|in_review|blocked|done|cancelled" },
          divisionId: { type: "string", description: "optional division slug" },
        },
        required: ["eventId"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_task",
      description:
        "Full detail of one task: description, checklist (sub-tasks) with done state and due dates, lead, assignees, labels, dependencies, recent comments.",
      parameters: {
        type: "object",
        properties: { taskId: { type: "string" } },
        required: ["taskId"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "my_tasks",
      description: "Open tasks assigned to the person asking.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "search",
      description: "Find tasks, projects, documents and people by keyword across everything the user can see.",
      parameters: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_documents",
      description: "Files in a project's document room (dataroom), with folder names.",
      parameters: {
        type: "object",
        properties: { eventId: { type: "string" } },
        required: ["eventId"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_people",
      description: "Who is on a project (PIC and members) and which divisions take part.",
      parameters: {
        type: "object",
        properties: { eventId: { type: "string" } },
        required: ["eventId"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "subtask_conversation",
      description: "Messages exchanged on one checklist item (sub-task) between the team and a guest.",
      parameters: {
        type: "object",
        properties: { checklistItemId: { type: "string" } },
        required: ["checklistItemId"],
        additionalProperties: false,
      },
    },
  },
] as const;

export type AssistantToolName = (typeof ASSISTANT_TOOLS)[number]["function"]["name"];

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const cap = <T,>(rows: T[]) =>
  rows.length > MAX_ROWS ? { rows: rows.slice(0, MAX_ROWS), truncated: rows.length - MAX_ROWS } : { rows };

/**
 * Executes one tool for the asker. Returns a JSON-serialisable result, or an
 * `{ error }` the model can read — a tool that throws would end the whole
 * answer, and "I could not open that" is a better reply than silence.
 */
export async function runAssistantTool(
  actor: Actor,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const str = (k: string) => (typeof args[k] === "string" ? (args[k] as string).trim() : "");
  try {
    switch (name as AssistantToolName) {
      case "list_projects": {
        const rows = await listActiveEvents(actor);
        return cap(
          rows.map((e) => ({
            id: e.id, name: e.name, venue: e.venue, launchDate: iso(e.showDate),
            phase: e.phaseName, health: e.health,
          })),
        );
      }
      case "list_tasks": {
        const eventId = str("eventId");
        if (!eventId) return { error: "eventId is required" };
        const status = str("status");
        const divisionId = str("divisionId");
        const rows = await listEventTasks(actor, eventId, {
          ...(divisionId ? { divisionId } : {}),
        });
        const filtered = status ? rows.filter((t) => t.status === status) : rows;
        return cap(
          filtered.map((t) => ({
            id: t.id, title: t.title, status: t.status, priority: t.priority,
            divisionId: t.divisionId, startDate: iso(t.startDate), dueDate: iso(t.dueDate),
            leadId: t.leadId,
            assignees: (t.assignees ?? []).map((a: { name: string }) => a.name),
            restricted: t.restricted,
          })),
        );
      }
      case "get_task": {
        const taskId = str("taskId");
        if (!taskId) return { error: "taskId is required" };
        const t = await getTaskDetail(actor, taskId);
        if (!t) return { error: "task not found or not visible to you" };
        return {
          id: t.id, title: t.title, status: t.status, priority: t.priority,
          project: t.event?.name ?? null, divisionId: t.divisionId,
          startDate: iso(t.startDate), dueDate: iso(t.dueDate), recurrence: t.recurrence,
          description: (t.description ?? "").slice(0, 2_000),
          lead: t.lead?.name ?? null,
          assignees: t.assignees.map((a) => a.name),
          labels: t.labels.map((l) => l.name),
          checklist: t.checklist.map((i) => ({
            id: i.id, title: i.title, done: i.done, dueDate: iso(i.dueDate), startDate: iso(i.startDate),
          })),
          blockedBy: t.blockers.map((b) => ({ id: b.id, title: b.title, status: b.status })),
          blocks: t.dependents.map((b) => ({ id: b.id, title: b.title, status: b.status })),
          externalWaits: t.externalDeps.map((d) => ({ label: d.label, party: d.party, resolved: d.resolvedAt !== null })),
          recentComments: t.comments.slice(-8).map((c) => ({
            by: c.authorName ?? "?", at: iso(c.comment.createdAt), text: c.comment.body.slice(0, 600),
          })),
          attachments: t.attachments.length,
        };
      }
      case "my_tasks": {
        const rows = await listMyTasks(actor);
        return cap(rows.map((r) => ({
          id: r.task.id, title: r.task.title, status: r.task.status, priority: r.task.priority,
          dueDate: iso(r.task.dueDate), project: r.eventName,
        })));
      }
      case "search": {
        const q = str("query");
        if (q.length < 2) return { error: "query too short" };
        return await globalSearch(actor, q);
      }
      case "list_documents": {
        const eventId = str("eventId");
        if (!eventId) return { error: "eventId is required" };
        const files = await listFilesForAssistant(actor, eventId, MAX_ROWS);
        return cap(files.map((f) => ({ fileId: f.fileId, name: f.name, folder: f.folderName })));
      }
      case "list_people": {
        const eventId = str("eventId");
        if (!eventId) return { error: "eventId is required" };
        const [people, divs] = await Promise.all([
          listEventPeople(actor, eventId),
          listEventDivisions(actor, eventId),
        ]);
        return {
          people: people.map((p) => ({ id: p.id, name: p.name, role: (p as { role?: string }).role ?? "member" })),
          divisions: divs.map((d) => ({ id: d.id, name: d.name })),
        };
      }
      case "subtask_conversation": {
        const itemId = str("checklistItemId");
        if (!itemId) return { error: "checklistItemId is required" };
        const [me] = await db.select({ name: profiles.name }).from(profiles).where(eq(profiles.id, actor.id)).limit(1);
        const thread = await listThread(itemId, { kind: "member", profileId: actor.id, name: me?.name ?? "Team" });
        return cap(thread.comments.map((c) => ({ by: c.authorName, fromTeam: c.fromTeam, at: c.createdAt, text: c.body.slice(0, 600) })));
      }
      default:
        return { error: `unknown tool ${name}` };
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : "tool failed" };
  }
}
