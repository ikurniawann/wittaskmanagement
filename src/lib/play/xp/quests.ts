import { and, eq, inArray, lt, notInArray } from "drizzle-orm";
import { db } from "@/db";
import { divisionMembers, handoffs, playQuests, taskDependencies, tasks } from "@/db/schema";
import { getActor } from "@/lib/permissions/actor";
import { listEventTasks } from "@/lib/tasks/service";
import { listActiveEvents } from "@/lib/events/service";
import { PermissionError } from "@/lib/permissions";
import { wibDay } from "./rules";

// EPIC-026 T-262 — daily quests generated from REAL work the user can already
// see. A quest never invents a task: every target id comes from the same
// permission-scoped lists the app shows, so a quest can never point at
// something the user cannot open. Regeneration for the same day is idempotent
// (unique on user+day+kind).

export type QuestKind = "clear_overdue" | "unblock" | "decide" | "refresh_stale";
export type Quest = { id: string; kind: QuestKind; title: string; targetIds: string[]; targetCount: number; progress: number; completedAt: string | null };

const MAX_QUESTS = 3;
const CLOSED = ["done", "cancelled"] as const;

export async function generateQuestsFor(userId: string, now = new Date()): Promise<Quest[]> {
  const day = wibDay(now);
  const existing = await db.select().from(playQuests).where(and(eq(playQuests.userId, userId), eq(playQuests.day, day)));
  if (existing.length) return existing.map(toQuest);
  const actor = await getActor(userId);
  if (!actor || actor.role === "external") return [];

  // visible open tasks assigned to me (through the boards' own list function)
  let eventIds: string[] = [];
  try {
    eventIds = (await listActiveEvents(actor)).map((e) => e.id);
  } catch (error) {
    if (!(error instanceof PermissionError)) throw error;
  }
  const perEvent = await Promise.all(eventIds.map((id) => listEventTasks(actor, id)));
  const mine = perEvent.flat().filter((t) => !CLOSED.includes(t.status as (typeof CLOSED)[number]) && t.assignees.some((a) => a.id === userId));
  const overdue = mine.filter((t) => t.dueDate && t.dueDate.getTime() < now.getTime());
  const ids = mine.map((t) => t.id);
  const waited = ids.length
    ? await db
        .selectDistinct({ id: taskDependencies.dependsOnTaskId })
        .from(taskDependencies)
        .innerJoin(tasks, eq(taskDependencies.taskId, tasks.id))
        .where(and(inArray(taskDependencies.dependsOnTaskId, ids), notInArray(tasks.status, [...CLOSED])))
    : [];
  const stale = ids.length
    ? (
        await db
          .select({ id: tasks.id })
          .from(tasks)
          .where(and(inArray(tasks.id, ids), eq(tasks.status, "in_progress"), lt(tasks.updatedAt, new Date(now.getTime() - 3 * 86400000))))
      ).map((r) => r.id)
    : [];
  // decisions waiting on me: handoffs into divisions I head + approvals in my queue
  const headOf = actor.memberships.filter((m) => m.role === "head").map((m) => m.divisionId);
  const pendingHandoffs = headOf.length
    ? (await db.select({ id: handoffs.id }).from(handoffs).where(and(eq(handoffs.status, "pending"), inArray(handoffs.toDivisionId, headOf)))).map((r) => r.id)
    : [];
  let pendingApprovals: string[] = [];
  try {
    const { listMyQueue } = await import("@/lib/approvals/service");
    pendingApprovals = (await listMyQueue(actor)).map((a) => a.id);
  } catch (error) {
    if (!(error instanceof PermissionError)) throw error;
  }

  const drafts: Array<{ kind: QuestKind; title: string; targetIds: string[]; targetCount: number }> = [];
  if (overdue.length) drafts.push({ kind: "clear_overdue", title: `Clear ${Math.min(2, overdue.length)} overdue task${overdue.length > 1 ? "s" : ""}`, targetIds: overdue.map((t) => t.id), targetCount: Math.min(2, overdue.length) });
  if (waited.length) drafts.push({ kind: "unblock", title: "Finish a task someone is waiting on", targetIds: waited.map((w) => w.id), targetCount: 1 });
  const decisions = [...pendingHandoffs, ...pendingApprovals];
  if (decisions.length) drafts.push({ kind: "decide", title: `Decide ${Math.min(3, decisions.length)} waiting request${decisions.length > 1 ? "s" : ""}`, targetIds: decisions, targetCount: Math.min(3, decisions.length) });
  if (stale.length) drafts.push({ kind: "refresh_stale", title: "Update a task that went quiet for 3 days", targetIds: stale, targetCount: 1 });
  if (!drafts.length) return [];
  const rows = await db
    .insert(playQuests)
    .values(drafts.slice(0, MAX_QUESTS).map((d) => ({ userId, day, kind: d.kind, title: d.title, targetIds: d.targetIds, targetCount: d.targetCount })))
    .onConflictDoNothing()
    .returning();
  return rows.map(toQuest);
}

export async function todaysQuests(userId: string, now = new Date()): Promise<Quest[]> {
  const rows = await db.select().from(playQuests).where(and(eq(playQuests.userId, userId), eq(playQuests.day, wibDay(now))));
  return rows.map(toQuest);
}

/** 06:00 WIB: quests for everyone with a division seat. */
export async function generateAllQuests(now = new Date()): Promise<number> {
  const users = await db.selectDistinct({ userId: divisionMembers.userId }).from(divisionMembers);
  let n = 0;
  for (const u of users) n += (await generateQuestsFor(u.userId, now)).length;
  return n;
}

function toQuest(r: typeof playQuests.$inferSelect): Quest {
  return { id: r.id, kind: r.kind as QuestKind, title: r.title, targetIds: (r.targetIds as string[]) ?? [], targetCount: r.targetCount, progress: r.progress, completedAt: r.completedAt ? r.completedAt.toISOString() : null };
}
