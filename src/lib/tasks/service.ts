import { and, asc, eq, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  attachments,
  comments,
  divisionMembers,
  events,
  handoffs,
  labels,
  profiles,
  savedFilters,
  taskAssignees,
  taskChecklistItems,
  taskDependencies,
  taskExternalDependencies,
  taskLabels,
  tasks,
  taskWatchers,
} from "@/db/schema";
import { logActivity } from "@/lib/activity";
import { recomputeEventHealth } from "@/lib/events/service";
import { notify, notifyMany } from "@/lib/notifications";
import { canSeeTask, canRestrictTask, subjectOf } from "./visibility";
import {
  notifyLeadAssigned,
  notifyMemberAssigned,
  notifyPriorityUrgent,
} from "./wa-notify";
import {
  assertCan,
  can,
  PermissionError,
  type Actor,
} from "@/lib/permissions";
import { nextRecurrenceDate } from "./dates";
import {
  maybeNotifyUnblocked,
  recomputeBottleneck,
  wouldCreateCycle,
} from "./dependency-engine";

// Task service (T-031..T-037). THE rule: every read/write resolves the task,
// derives {divisionId, isAssigned}, and goes through the permission module.

import type { TaskStatus } from "./status";

export { STATUS_LABELS, TASK_STATUS_ORDER, type TaskStatus } from "./status";

// ---- scoped fetch ---------------------------------------------------------

export async function getTaskScoped(actor: Actor, taskId: string) {
  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  if (!task) return null;

  const assigneeRows = await db
    .select({ userId: taskAssignees.userId })
    .from(taskAssignees)
    .where(eq(taskAssignees.taskId, taskId));
  const isAssigned = assigneeRows.some((a) => a.userId === actor.id);

  // Reading follows the cross-division default (Owner 2026-08-11): an
  // ordinary task opens for anyone internal, a sealed one only for its own
  // division, leadership, and the people working on it. Editing rights are
  // unchanged and still come from task.edit / task.updateAssigned.
  const watcherRows = task.restricted
    ? await db
        .select({ userId: taskWatchers.userId })
        .from(taskWatchers)
        .where(eq(taskWatchers.taskId, taskId))
    : [];
  const visible = canSeeTask(subjectOf(actor), {
    divisionId: task.divisionId,
    restricted: task.restricted,
    leadId: task.leadId,
    assigneeIds: assigneeRows.map((a) => a.userId),
    watcherIds: watcherRows.map((w) => w.userId),
  });
  if (!visible) return null;

  return { ...task, assigneeIds: assigneeRows.map((a) => a.userId), isAssigned };
}

async function requireTask(actor: Actor, taskId: string) {
  const task = await getTaskScoped(actor, taskId);
  if (!task) throw new PermissionError("task.viewDivision");
  return task;
}

function canMutate(actor: Actor, task: { divisionId: string; isAssigned: boolean }) {
  return (
    can(actor, "task.edit", { divisionId: task.divisionId }) ||
    can(actor, "task.updateAssigned", { isAssigned: task.isAssigned })
  );
}

// ---- queries --------------------------------------------------------------

export async function listBoardTasks(
  actor: Actor,
  eventId: string,
  divisionId: string,
) {
  // A board is now readable across divisions (Owner 2026-08-11); the sealed
  // rows are removed afterwards rather than the whole division being refused.
  const rows = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.eventId, eventId), eq(tasks.divisionId, divisionId)))
    .orderBy(asc(tasks.dueDate), asc(tasks.createdAt));
  return withLabels(await withAssignees(await filterVisible(actor, rows)));
}

/**
 * Drops the tasks this person may not see. Applied after the query rather
 * than inside it because "may see" depends on assignees and watchers, and a
 * three-way EXISTS in every task query would be far easier to get subtly
 * wrong than one rule applied in one place.
 */
async function filterVisible<
  T extends { id: string; divisionId: string; restricted: boolean; leadId: string | null },
>(actor: Actor, rows: T[]): Promise<T[]> {
  const subject = subjectOf(actor);
  if (subject.role === "owner" || subject.role === "admin") return rows;
  const sealed = rows.filter((r) => r.restricted);
  if (sealed.length === 0) {
    return rows.filter((r) => canSeeTask(subject, { ...r, assigneeIds: [] }));
  }
  const ids = sealed.map((r) => r.id);
  const [assignees, watchers] = await Promise.all([
    db
      .select({ taskId: taskAssignees.taskId, userId: taskAssignees.userId })
      .from(taskAssignees)
      .where(and(inArray(taskAssignees.taskId, ids), eq(taskAssignees.userId, actor.id))),
    db
      .select({ taskId: taskWatchers.taskId })
      .from(taskWatchers)
      .where(and(inArray(taskWatchers.taskId, ids), eq(taskWatchers.userId, actor.id))),
  ]);
  const mine = new Set([
    ...assignees.map((a) => a.taskId),
    ...watchers.map((w) => w.taskId),
  ]);
  return rows.filter((r) =>
    canSeeTask(subject, {
      ...r,
      assigneeIds: mine.has(r.id) ? [actor.id] : [],
    }),
  );
}

async function withLabels<T extends { id: string }>(rows: T[]) {
  if (rows.length === 0)
    return [] as Array<T & { labels: Array<{ id: string; name: string; color: string }> }>;
  const links = await db
    .select({
      taskId: taskLabels.taskId,
      id: labels.id,
      name: labels.name,
      color: labels.color,
    })
    .from(taskLabels)
    .innerJoin(labels, eq(taskLabels.labelId, labels.id))
    .where(inArray(taskLabels.taskId, rows.map((r) => r.id)));
  const byTask = new Map<string, Array<{ id: string; name: string; color: string }>>();
  for (const l of links) {
    const list = byTask.get(l.taskId) ?? [];
    list.push({ id: l.id, name: l.name, color: l.color });
    byTask.set(l.taskId, list);
  }
  return rows.map((r) => ({ ...r, labels: byTask.get(r.id) ?? [] }));
}

export async function listLabels() {
  return db.select().from(labels).orderBy(asc(labels.name));
}

export interface ListFilters {
  status?: TaskStatus;
  priority?: "low" | "medium" | "high" | "urgent";
  divisionId?: string;
  assigneeId?: string;
}

export async function listEventTasks(
  actor: Actor,
  eventId: string,
  filters: ListFilters = {},
) {
  // Tasks are visible across divisions by default now; only the sealed ones
  // are withheld, and that is decided per row below.
  const conditions = [eq(tasks.eventId, eventId)];
  if (filters.divisionId) {
    conditions.push(eq(tasks.divisionId, filters.divisionId));
  }
  if (filters.status) conditions.push(eq(tasks.status, filters.status));
  if (filters.priority) conditions.push(eq(tasks.priority, filters.priority));

  let rows = await filterVisible(
    actor,
    await db
      .select()
      .from(tasks)
      .where(and(...conditions))
      .orderBy(asc(tasks.dueDate), asc(tasks.createdAt)),
  );

  if (filters.assigneeId) {
    const assigned = await db
      .select({ taskId: taskAssignees.taskId })
      .from(taskAssignees)
      .where(eq(taskAssignees.userId, filters.assigneeId));
    const ids = new Set(assigned.map((a) => a.taskId));
    rows = rows.filter((r) => ids.has(r.id));
  }
  return withLabels(await withAssignees(rows));
}

export async function listMyTasks(actor: Actor) {
  const rows = await db
    .select({ task: tasks, eventName: events.name })
    .from(taskAssignees)
    .innerJoin(tasks, eq(taskAssignees.taskId, tasks.id))
    .innerJoin(events, eq(tasks.eventId, events.id))
    .where(and(eq(taskAssignees.userId, actor.id), ne(tasks.status, "done")))
    .orderBy(asc(tasks.dueDate));
  return rows;
}

async function withAssignees<T extends { id: string }>(rows: T[]) {
  if (rows.length === 0) return [] as Array<T & { assignees: Array<{ id: string; name: string }> }>;
  const links = await db
    .select({
      taskId: taskAssignees.taskId,
      id: profiles.id,
      name: profiles.name,
    })
    .from(taskAssignees)
    .innerJoin(profiles, eq(taskAssignees.userId, profiles.id))
    .where(inArray(taskAssignees.taskId, rows.map((r) => r.id)));
  const byTask = new Map<string, Array<{ id: string; name: string }>>();
  for (const l of links) {
    const list = byTask.get(l.taskId) ?? [];
    list.push({ id: l.id, name: l.name });
    byTask.set(l.taskId, list);
  }
  return rows.map((r) => ({ ...r, assignees: byTask.get(r.id) ?? [] }));
}

// ---- mutations ------------------------------------------------------------

export async function createTask(
  actor: Actor,
  input: {
    eventId: string;
    divisionId: string;
    title: string;
    description?: string;
    priority?: "low" | "medium" | "high" | "urgent";
    startDate?: Date;
    dueDate?: Date;
    recurrence?: "none" | "daily" | "weekly" | "monthly";
    leadId?: string;
    assigneeIds?: string[];
    labelIds?: string[];
    newLabel?: { name: string; color: string };
    /** hide from other divisions — head of that division, or leadership */
    restricted?: boolean;
  },
) {
  assertCan(actor, "task.create", { divisionId: input.divisionId });
  if (input.restricted && !canRestrictTask(subjectOf(actor), input.divisionId)) {
    // staff cannot hide their own work from the rest of the event; sealing is
    // a management decision, so it belongs to the division's head
    throw new PermissionError("task.create");
  }
  const [task] = await db
    .insert(tasks)
    .values({
      eventId: input.eventId,
      divisionId: input.divisionId,
      title: input.title.trim(),
      description: input.description?.trim() ?? "",
      priority: input.priority ?? "medium",
      startDate: input.startDate ?? null,
      dueDate: input.dueDate ?? null,
      recurrence: input.recurrence ?? "none",
      leadId: input.leadId ?? null,
      restricted: input.restricted ?? false,
      createdBy: actor.id,
    })
    .returning();

  if (input.leadId && input.leadId !== actor.id) {
    await notifyLeadAssigned(task.id, input.leadId);
  }

  for (const userId of input.assigneeIds ?? []) {
    await assignUser(actor, task.id, userId, { skipFetch: task });
  }

  const labelIds = [...(input.labelIds ?? [])];
  if (input.newLabel?.name.trim()) {
    const label = await ensureLabel(input.newLabel.name, input.newLabel.color);
    labelIds.push(label.id);
  }
  if (labelIds.length > 0) {
    await db
      .insert(taskLabels)
      .values(labelIds.map((labelId) => ({ taskId: task.id, labelId })))
      .onConflictDoNothing();
  }

  await logActivity({
    actorId: actor.id,
    action: "task.create",
    entity: `task:${task.id}`,
    detail: { title: task.title, divisionId: task.divisionId },
    eventId: task.eventId,
  });
  await recomputeEventHealth(task.eventId);
  return task;
}

export async function updateTaskFields(
  actor: Actor,
  taskId: string,
  fields: Partial<{
    title: string;
    description: string;
    priority: "low" | "medium" | "high" | "urgent";
    startDate: Date | null;
    dueDate: Date | null;
    recurrence: "none" | "daily" | "weekly" | "monthly";
  }>,
) {
  const task = await requireTask(actor, taskId);
  assertCan(actor, "task.edit", { divisionId: task.divisionId });
  await db
    .update(tasks)
    .set({
      ...fields,
      // a HUMAN priority edit ends any auto-bump — manual always wins
      // (EPIC-012): clear the flags so the engine never reverts over it
      ...(fields.priority !== undefined
        ? { priorityBeforeAuto: null, autoUrgentAt: null }
        : {}),
      updatedAt: new Date(),
    })
    .where(eq(tasks.id, taskId));
  await logActivity({
    actorId: actor.id,
    action: "task.update",
    entity: `task:${taskId}`,
    detail: { fields: Object.keys(fields) },
    eventId: task.eventId,
  });
  // a human raising a task to urgent pings its PIC on WhatsApp (T-151);
  // only on the transition, so re-saving an already-urgent task is silent
  if (fields.priority === "urgent" && task.priority !== "urgent") {
    await notifyPriorityUrgent(taskId, { kind: "manual", actorId: actor.id });
  }
  await recomputeEventHealth(task.eventId);
  // due-date edits shift the overdue input of the bottleneck rule
  if (fields.dueDate !== undefined || fields.priority !== undefined) {
    await recomputeBottleneck(taskId);
  }
}

export async function updateStatus(
  actor: Actor,
  taskId: string,
  status: TaskStatus,
) {
  const task = await requireTask(actor, taskId);
  if (!canMutate(actor, task)) throw new PermissionError("task.updateAssigned");

  const done = status === "done";
  await db
    .update(tasks)
    .set({
      status,
      completedAt: done ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(eq(tasks.id, taskId));

  await logActivity({
    actorId: actor.id,
    action: "task.status",
    entity: `task:${taskId}`,
    detail: { from: task.status, to: status },
    eventId: task.eventId,
  });

  if (done && task.status !== "done") {
    await onTaskCompleted(task);
  }
  await recomputeEventHealth(task.eventId);

  // bottleneck bookkeeping (EPIC-012): my own blocked/closed state changes
  // my criticality, and closing/reopening changes my blockers' waiter counts
  await recomputeBottleneck(taskId);
  const myBlockers = await db
    .select({ id: taskDependencies.dependsOnTaskId })
    .from(taskDependencies)
    .where(eq(taskDependencies.taskId, taskId));
  for (const blocker of myBlockers) {
    await recomputeBottleneck(blocker.id);
  }
}

async function onTaskCompleted(task: {
  id: string;
  eventId: string;
  divisionId: string;
  title: string;
  description: string;
  priority: "low" | "medium" | "high" | "urgent";
  recurrence: "none" | "daily" | "weekly" | "monthly";
  dueDate: Date | null;
  assigneeIds: string[];
}) {
  // recurrence: spawn exactly one next instance
  const nextDue = task.dueDate
    ? nextRecurrenceDate(task.dueDate, task.recurrence)
    : null;
  if (task.recurrence !== "none" && nextDue) {
    const [next] = await db
      .insert(tasks)
      .values({
        eventId: task.eventId,
        divisionId: task.divisionId,
        title: task.title,
        description: task.description,
        priority: task.priority,
        recurrence: task.recurrence,
        dueDate: nextDue,
        status: "todo",
      })
      .returning();
    if (task.assigneeIds.length > 0) {
      await db
        .insert(taskAssignees)
        .values(task.assigneeIds.map((userId) => ({ taskId: next.id, userId })))
        .onConflictDoNothing();
    }
  }

  // unblock: dependents whose gates (internal blockers + external deps)
  // are now ALL clear — the engine checks both and dedups the notification
  const dependents = await db
    .select({ taskId: taskDependencies.taskId })
    .from(taskDependencies)
    .where(eq(taskDependencies.dependsOnTaskId, task.id));
  for (const dep of dependents) {
    await maybeNotifyUnblocked(dep.taskId);
  }
}

// set/replace/clear the single Lead-PIC (Owner 2026-08-07); same gate as
// assigning workers
export async function setTaskLead(
  actor: Actor,
  taskId: string,
  userId: string | null,
) {
  const task = await requireTask(actor, taskId);
  assertCan(actor, "task.assign", { divisionId: task.divisionId });
  await db
    .update(tasks)
    .set({ leadId: userId, updatedAt: new Date() })
    .where(eq(tasks.id, taskId));
  if (userId && userId !== actor.id) {
    await notifyLeadAssigned(taskId, userId);
  }
  await logActivity({
    actorId: actor.id,
    action: userId ? "task.lead_set" : "task.lead_clear",
    entity: `task:${taskId}`,
    detail: { userId },
    eventId: task.eventId,
  });
}

export async function assignUser(
  actor: Actor,
  taskId: string,
  userId: string,
  opts: { skipFetch?: { divisionId: string; eventId: string } } = {},
) {
  const task = opts.skipFetch ?? (await requireTask(actor, taskId));
  assertCan(actor, "task.assign", { divisionId: task.divisionId });
  await db
    .insert(taskAssignees)
    .values({ taskId, userId })
    .onConflictDoNothing();
  if (userId !== actor.id) {
    await notifyMemberAssigned(taskId, userId);
  }
  await logActivity({
    actorId: actor.id,
    action: "task.assign",
    entity: `task:${taskId}`,
    detail: { userId },
    eventId: task.eventId,
  });
}

export async function unassignUser(actor: Actor, taskId: string, userId: string) {
  const task = await requireTask(actor, taskId);
  assertCan(actor, "task.assign", { divisionId: task.divisionId });
  await db
    .delete(taskAssignees)
    .where(and(eq(taskAssignees.taskId, taskId), eq(taskAssignees.userId, userId)));
}

export async function toggleWatch(actor: Actor, taskId: string) {
  await requireTask(actor, taskId);
  const [existing] = await db
    .select()
    .from(taskWatchers)
    .where(and(eq(taskWatchers.taskId, taskId), eq(taskWatchers.userId, actor.id)))
    .limit(1);
  if (existing) {
    await db
      .delete(taskWatchers)
      .where(and(eq(taskWatchers.taskId, taskId), eq(taskWatchers.userId, actor.id)));
  } else {
    await db.insert(taskWatchers).values({ taskId, userId: actor.id });
  }
}

// ---- checklist ------------------------------------------------------------

export async function addChecklistItem(
  actor: Actor,
  taskId: string,
  input: {
    title: string;
    startDate?: Date;
    dueDate?: Date;
    priority?: "low" | "medium" | "high" | "urgent";
  },
) {
  const task = await requireTask(actor, taskId);
  if (!canMutate(actor, task)) throw new PermissionError("task.edit");
  const [{ max }] = await db
    .select({ max: sql<number>`coalesce(max(sort_order), 0)::int` })
    .from(taskChecklistItems)
    .where(eq(taskChecklistItems.taskId, taskId));
  await db.insert(taskChecklistItems).values({
    taskId,
    title: input.title.trim(),
    startDate: input.startDate ?? null,
    dueDate: input.dueDate ?? null,
    priority: input.priority ?? null,
    sortOrder: max + 1,
  });
}

export async function updateChecklistItem(
  actor: Actor,
  itemId: string,
  input: {
    title: string;
    note: string;
    startDate: Date | null;
    dueDate: Date | null;
    priority: "low" | "medium" | "high" | "urgent" | null;
  },
) {
  const [item] = await db
    .select()
    .from(taskChecklistItems)
    .where(eq(taskChecklistItems.id, itemId))
    .limit(1);
  if (!item) return;
  const task = await requireTask(actor, item.taskId);
  if (!canMutate(actor, task)) throw new PermissionError("task.edit");
  if (!input.title.trim()) throw new Error("Checklist title is empty.");
  await db
    .update(taskChecklistItems)
    .set({
      title: input.title.trim(),
      note: input.note.trim(),
      startDate: input.startDate,
      dueDate: input.dueDate,
      priority: input.priority,
    })
    .where(eq(taskChecklistItems.id, itemId));
}

export async function deleteChecklistItem(actor: Actor, itemId: string) {
  const [item] = await db
    .select()
    .from(taskChecklistItems)
    .where(eq(taskChecklistItems.id, itemId))
    .limit(1);
  if (!item) return;
  const task = await requireTask(actor, item.taskId);
  if (!canMutate(actor, task)) throw new PermissionError("task.edit");
  await db.delete(taskChecklistItems).where(eq(taskChecklistItems.id, itemId));
}

export async function toggleChecklistItem(actor: Actor, itemId: string) {
  const [item] = await db
    .select()
    .from(taskChecklistItems)
    .where(eq(taskChecklistItems.id, itemId))
    .limit(1);
  if (!item) return;
  const task = await requireTask(actor, item.taskId);
  if (!canMutate(actor, task)) throw new PermissionError("task.edit");
  await db
    .update(taskChecklistItems)
    .set({ done: !item.done })
    .where(eq(taskChecklistItems.id, itemId));
  // Backstage Play (EPIC-026): a ticked item is a scorable event; unticking is not.
  if (!item.done) {
    await logActivity({
      actorId: actor.id,
      action: "task.checklist_done",
      entity: `task:${item.taskId}`,
      detail: { itemId },
      eventId: task.eventId,
    });
  }
}

// ---- labels ---------------------------------------------------------------

async function ensureLabel(name: string, color: string) {
  const { labelColorKey } = await import("@/lib/label-colors");
  const clean = name.trim().toLowerCase();
  const safeColor = labelColorKey(color);
  const [label] = await db
    .insert(labels)
    .values({ name: clean, color: safeColor })
    .onConflictDoUpdate({ target: labels.name, set: { color: safeColor } })
    .returning();
  return label;
}

export async function addLabelToTask(
  actor: Actor,
  taskId: string,
  name: string,
  color = "slate",
) {
  const task = await requireTask(actor, taskId);
  assertCan(actor, "task.edit", { divisionId: task.divisionId });
  if (!name.trim()) return;
  const label = await ensureLabel(name, color);
  await db
    .insert(taskLabels)
    .values({ taskId, labelId: label.id })
    .onConflictDoNothing();
}

export async function removeLabelFromTask(actor: Actor, taskId: string, labelId: string) {
  const task = await requireTask(actor, taskId);
  assertCan(actor, "task.edit", { divisionId: task.divisionId });
  await db
    .delete(taskLabels)
    .where(and(eq(taskLabels.taskId, taskId), eq(taskLabels.labelId, labelId)));
}

// ---- dependencies ---------------------------------------------------------

export async function addDependency(
  actor: Actor,
  taskId: string,
  dependsOnTaskId: string,
) {
  if (taskId === dependsOnTaskId) throw new Error("A task cannot block itself.");
  const task = await requireTask(actor, taskId);
  const blocker = await requireTask(actor, dependsOnTaskId);
  assertCan(actor, "task.edit", { divisionId: task.divisionId });
  // cross-division AND cross-event allowed (EPIC-012) — the whole point is
  // tracking waits on other teams. Cycles of any length are rejected.
  if (await wouldCreateCycle(taskId, dependsOnTaskId)) {
    throw new Error("That would create a dependency loop.");
  }
  const inserted = await db
    .insert(taskDependencies)
    .values({ taskId, dependsOnTaskId })
    .onConflictDoNothing()
    .returning();
  if (inserted.length === 0) return; // edge already existed

  await logActivity({
    actorId: actor.id,
    action: "task.dependency_add",
    entity: `task:${taskId}`,
    detail: { dependsOn: blocker.title },
    eventId: task.eventId,
  });
  // tell the blocking team they are now a bottleneck for someone (in-app
  // only; once per user per edge thanks to the dedup key)
  await notifyMany(blocker.assigneeIds, {
    type: "dependency_waiting",
    title: `A task now waits on: ${blocker.title}`,
    href: `/tasks/${dependsOnTaskId}`,
    dedupKeyFor: (userId) => `depwait:${taskId}:${dependsOnTaskId}:${userId}`,
  });
  await recomputeBottleneck(dependsOnTaskId);
}

export async function removeDependency(
  actor: Actor,
  taskId: string,
  dependsOnTaskId: string,
) {
  const task = await requireTask(actor, taskId);
  assertCan(actor, "task.edit", { divisionId: task.divisionId });
  await db
    .delete(taskDependencies)
    .where(
      and(
        eq(taskDependencies.taskId, taskId),
        eq(taskDependencies.dependsOnTaskId, dependsOnTaskId),
      ),
    );
  await logActivity({
    actorId: actor.id,
    action: "task.dependency_remove",
    entity: `task:${taskId}`,
    detail: { dependsOnTaskId },
    eventId: task.eventId,
  });
  await recomputeBottleneck(dependsOnTaskId);
  // removing the last open blocker can itself unblock the task
  await maybeNotifyUnblocked(taskId);
}

// ---- external dependencies (EPIC-012 T-120) -------------------------------
// A wait on a party outside the system. Informational: never forces status,
// but unresolved rows gate the "Unblocked" notification. Any member of the
// task's division may add/check off (Owner decision 2026-08-07).

export async function addExternalDependency(
  actor: Actor,
  input: { taskId: string; label: string; party?: string; note?: string },
) {
  const task = await requireTask(actor, input.taskId);
  assertCan(actor, "task.edit", { divisionId: task.divisionId });
  const label = input.label.trim();
  if (!label) throw new Error("What are you waiting for? Label is required.");
  await db.insert(taskExternalDependencies).values({
    taskId: input.taskId,
    label,
    party: input.party?.trim() ?? "",
    note: input.note?.trim() ?? "",
    createdBy: actor.id,
  });
  await logActivity({
    actorId: actor.id,
    action: "task.external_dep_add",
    entity: `task:${input.taskId}`,
    detail: { label, party: input.party?.trim() ?? "" },
    eventId: task.eventId,
  });
}

export async function setExternalDependencyResolved(
  actor: Actor,
  externalDepId: string,
  resolved: boolean,
) {
  const [row] = await db
    .select()
    .from(taskExternalDependencies)
    .where(eq(taskExternalDependencies.id, externalDepId))
    .limit(1);
  if (!row) throw new Error("External dependency not found.");
  const task = await requireTask(actor, row.taskId);
  assertCan(actor, "task.edit", { divisionId: task.divisionId });
  await db
    .update(taskExternalDependencies)
    .set(
      resolved
        ? { resolvedAt: new Date(), resolvedBy: actor.id }
        : { resolvedAt: null, resolvedBy: null },
    )
    .where(eq(taskExternalDependencies.id, externalDepId));
  await logActivity({
    actorId: actor.id,
    action: resolved ? "task.external_dep_resolve" : "task.external_dep_reopen",
    entity: `task:${row.taskId}`,
    detail: { label: row.label },
    eventId: task.eventId,
  });
  if (resolved) await maybeNotifyUnblocked(row.taskId);
}

export async function deleteExternalDependency(
  actor: Actor,
  externalDepId: string,
) {
  const [row] = await db
    .select()
    .from(taskExternalDependencies)
    .where(eq(taskExternalDependencies.id, externalDepId))
    .limit(1);
  if (!row) return;
  const task = await requireTask(actor, row.taskId);
  assertCan(actor, "task.edit", { divisionId: task.divisionId });
  await db
    .delete(taskExternalDependencies)
    .where(eq(taskExternalDependencies.id, externalDepId));
  await logActivity({
    actorId: actor.id,
    action: "task.external_dep_delete",
    entity: `task:${row.taskId}`,
    detail: { label: row.label },
    eventId: task.eventId,
  });
  await maybeNotifyUnblocked(row.taskId);
}

// all dependency edges between tasks of this event that the actor may see
// (T-080 Gantt). Reuses listEventTasks' division-visibility scoping so both
// ends of every returned edge are already permission-scoped.
export async function listEventTaskDependencies(actor: Actor, eventId: string) {
  const visibleTasks = await listEventTasks(actor, eventId);
  const visibleIds = new Set(visibleTasks.map((t) => t.id));
  if (visibleIds.size === 0) return [];

  const rows = await db
    .select({
      taskId: taskDependencies.taskId,
      dependsOnTaskId: taskDependencies.dependsOnTaskId,
    })
    .from(taskDependencies)
    .innerJoin(tasks, eq(taskDependencies.taskId, tasks.id))
    .where(eq(tasks.eventId, eventId));

  return rows.filter(
    (r) => visibleIds.has(r.taskId) && visibleIds.has(r.dependsOnTaskId),
  );
}

// ---- comments -------------------------------------------------------------

export async function addComment(
  actor: Actor,
  taskId: string,
  body: string,
  mentionIds: string[] = [],
  attachment?: { path: string; name: string },
) {
  const task = await requireTask(actor, taskId);
  if (!canMutate(actor, task) && !task.isAssigned) {
    // division members and assignees may comment
    assertCan(actor, "task.viewDivision", { divisionId: task.divisionId });
  }

  // "@all" (socmed behavior) expands to every member of the task's division
  let resolvedIds = mentionIds.filter((id) => id !== "all");
  if (mentionIds.includes("all") || /(^|\s)@all(\b|$)/i.test(body)) {
    const divisionUsers = await db
      .select({ userId: divisionMembers.userId })
      .from(divisionMembers)
      .where(eq(divisionMembers.divisionId, task.divisionId));
    resolvedIds = [...new Set([...resolvedIds, ...divisionUsers.map((u) => u.userId)])];
  }

  // only mention users who can actually see the task
  const validMentions =
    resolvedIds.length === 0
      ? []
      : (
          await db
            .select({ id: profiles.id, role: profiles.role })
            .from(profiles)
            .where(inArray(profiles.id, resolvedIds))
        ).filter((p) => p.role !== "external");

  const [comment] = await db
    .insert(comments)
    .values({
      taskId,
      authorId: actor.id,
      body: body.trim(),
      mentions: validMentions.map((m) => m.id),
      attachmentPath: attachment?.path ?? null,
      attachmentName: attachment?.name ?? null,
    })
    .returning();

  // Backstage Play (EPIC-025/026): comments now leave an activity row — the
  // office draws a speech bubble from it and the XP ledger scores mention
  // replies. The body is NOT copied into the log; only who/where/mentions.
  await logActivity({
    actorId: actor.id,
    action: "comment.add",
    entity: `task:${taskId}`,
    detail: { commentId: comment.id, mentions: validMentions.map((m) => m.id) },
    eventId: task.eventId,
  });

  await notifyMany(
    validMentions.map((m) => m.id).filter((id) => id !== actor.id),
    {
      type: "mentioned",
      title: "You were mentioned in a comment",
      href: `/tasks/${taskId}`,
    },
  );
  return comment;
}

// ---- handoffs (T-036) -----------------------------------------------------

export async function requestHandoff(
  actor: Actor,
  input: {
    eventId: string;
    fromDivisionId: string;
    toDivisionId: string;
    title: string;
    note?: string;
    originTaskId?: string;
  },
) {
  assertCan(actor, "handoff.request", { divisionId: input.fromDivisionId });
  if (input.fromDivisionId === input.toDivisionId) {
    throw new Error("Handoffs go to a different division.");
  }
  const [handoff] = await db
    .insert(handoffs)
    .values({
      eventId: input.eventId,
      fromDivisionId: input.fromDivisionId,
      toDivisionId: input.toDivisionId,
      originTaskId: input.originTaskId ?? null,
      title: input.title.trim(),
      note: input.note?.trim() ?? "",
      requestedBy: actor.id,
    })
    .returning();

  const heads = await db
    .select({ userId: divisionMembers.userId })
    .from(divisionMembers)
    .where(
      and(
        eq(divisionMembers.divisionId, input.toDivisionId),
        eq(divisionMembers.role, "head"),
      ),
    );
  await notifyMany(
    heads.map((h) => h.userId),
    {
      type: "handoff_request",
      title: `Handoff request: ${handoff.title}`,
      href: `/events/${input.eventId}/handoffs`,
    },
  );
  await logActivity({
    actorId: actor.id,
    action: "handoff.request",
    entity: `handoff:${handoff.id}`,
    detail: { from: input.fromDivisionId, to: input.toDivisionId },
    eventId: input.eventId,
  });
  return handoff;
}

export async function decideHandoff(
  actor: Actor,
  handoffId: string,
  accept: boolean,
) {
  const [handoff] = await db
    .select()
    .from(handoffs)
    .where(eq(handoffs.id, handoffId))
    .limit(1);
  if (!handoff || handoff.status !== "pending") {
    throw new Error("Handoff not found or already decided.");
  }
  assertCan(actor, "handoff.decide", { divisionId: handoff.toDivisionId });

  let createdTaskId: string | null = null;
  if (accept) {
    const [created] = await db
      .insert(tasks)
      .values({
        eventId: handoff.eventId,
        divisionId: handoff.toDivisionId,
        title: handoff.title,
        description: handoff.note,
        status: "todo",
        createdBy: actor.id,
      })
      .returning();
    createdTaskId = created.id;
    if (handoff.originTaskId) {
      await db
        .insert(taskDependencies)
        .values({ taskId: handoff.originTaskId, dependsOnTaskId: created.id })
        .onConflictDoNothing();
    }
  }

  await db
    .update(handoffs)
    .set({
      status: accept ? "accepted" : "declined",
      decidedBy: actor.id,
      decidedAt: new Date(),
      createdTaskId,
    })
    .where(eq(handoffs.id, handoffId));

  if (handoff.requestedBy) {
    await notify({
      userId: handoff.requestedBy,
      type: "handoff_decided",
      title: `Handoff ${accept ? "accepted" : "declined"}: ${handoff.title}`,
      href: createdTaskId ? `/tasks/${createdTaskId}` : `/events/${handoff.eventId}/handoffs`,
    });
  }
  await logActivity({
    actorId: actor.id,
    action: accept ? "handoff.accept" : "handoff.decline",
    entity: `handoff:${handoffId}`,
    eventId: handoff.eventId,
  });
  return createdTaskId;
}

export async function listHandoffs(actor: Actor, eventId: string) {
  const rows = await db
    .select()
    .from(handoffs)
    .where(eq(handoffs.eventId, eventId))
    .orderBy(asc(handoffs.createdAt));
  // visible if actor touches either side (or owner/admin)
  return rows.filter(
    (h) =>
      can(actor, "task.viewDivision", { divisionId: h.fromDivisionId }) ||
      can(actor, "task.viewDivision", { divisionId: h.toDivisionId }),
  );
}

// ---- attachments ----------------------------------------------------------

export async function addAttachment(
  actor: Actor,
  taskId: string,
  file: { name: string; size: number; path: string },
) {
  const task = await requireTask(actor, taskId);
  if (!canMutate(actor, task)) throw new PermissionError("task.updateAssigned");
  await db.insert(attachments).values({
    taskId,
    uploaderId: actor.id,
    fileName: file.name,
    path: file.path,
    size: file.size,
  });
}

// ---- saved filters (T-032) ------------------------------------------------

export async function listSavedFilters(actor: Actor) {
  return db
    .select()
    .from(savedFilters)
    .where(eq(savedFilters.userId, actor.id))
    .orderBy(asc(savedFilters.createdAt));
}

export async function saveFilter(actor: Actor, name: string, params: ListFilters) {
  await db
    .insert(savedFilters)
    .values({ userId: actor.id, name: name.trim(), params });
}

export async function deleteFilter(actor: Actor, filterId: string) {
  await db
    .delete(savedFilters)
    .where(and(eq(savedFilters.id, filterId), eq(savedFilters.userId, actor.id)));
}

// ---- detail & options -----------------------------------------------------

export async function getTaskDetail(actor: Actor, taskId: string) {
  const task = await getTaskScoped(actor, taskId);
  if (!task) return null;

  const [checklist, taskLabelRows, commentRows, attachmentRows, blockerRows, dependentRows, watcherRows, event] =
    await Promise.all([
      db
        .select()
        .from(taskChecklistItems)
        .where(eq(taskChecklistItems.taskId, taskId))
        .orderBy(asc(taskChecklistItems.sortOrder)),
      db
        .select({ id: labels.id, name: labels.name, color: labels.color })
        .from(taskLabels)
        .innerJoin(labels, eq(taskLabels.labelId, labels.id))
        .where(eq(taskLabels.taskId, taskId)),
      db
        .select({ comment: comments, authorName: profiles.name })
        .from(comments)
        .leftJoin(profiles, eq(comments.authorId, profiles.id))
        .where(eq(comments.taskId, taskId))
        .orderBy(asc(comments.createdAt)),
      db.select().from(attachments).where(eq(attachments.taskId, taskId)),
      db
        .select({
          id: tasks.id,
          title: tasks.title,
          status: tasks.status,
          eventId: tasks.eventId,
          eventName: events.name,
        })
        .from(taskDependencies)
        .innerJoin(tasks, eq(taskDependencies.dependsOnTaskId, tasks.id))
        .innerJoin(events, eq(tasks.eventId, events.id))
        .where(eq(taskDependencies.taskId, taskId)),
      db
        .select({
          id: tasks.id,
          title: tasks.title,
          status: tasks.status,
          eventId: tasks.eventId,
          eventName: events.name,
        })
        .from(taskDependencies)
        .innerJoin(tasks, eq(taskDependencies.taskId, tasks.id))
        .innerJoin(events, eq(tasks.eventId, events.id))
        .where(eq(taskDependencies.dependsOnTaskId, taskId)),
      db
        .select({ userId: taskWatchers.userId })
        .from(taskWatchers)
        .where(eq(taskWatchers.taskId, taskId)),
      db
        .select({ id: events.id, name: events.name })
        .from(events)
        .where(eq(events.id, task.eventId))
        .then((r) => r[0] ?? null),
    ]);

  const externalDeps = await db
    .select()
    .from(taskExternalDependencies)
    .where(eq(taskExternalDependencies.taskId, taskId))
    .orderBy(asc(taskExternalDependencies.createdAt));

  const assignees =
    task.assigneeIds.length === 0
      ? []
      : await db
          .select({ id: profiles.id, name: profiles.name })
          .from(profiles)
          .where(inArray(profiles.id, task.assigneeIds));

  const lead = task.leadId
    ? await db
        .select({ id: profiles.id, name: profiles.name })
        .from(profiles)
        .where(eq(profiles.id, task.leadId))
        .limit(1)
        .then((r) => r[0] ?? null)
    : null;

  // names of mentioned users, for socmed-style bolding in comment bodies
  const mentionIds = [
    ...new Set(
      commentRows.flatMap((r) => (r.comment.mentions as string[]) ?? []),
    ),
  ];
  const mentionProfiles =
    mentionIds.length === 0
      ? []
      : await db
          .select({ id: profiles.id, name: profiles.name })
          .from(profiles)
          .where(inArray(profiles.id, mentionIds));
  const mentionNameById = new Map(mentionProfiles.map((p) => [p.id, p.name]));
  const commentsWithMentions = commentRows.map((r) => ({
    ...r,
    mentionNames: ((r.comment.mentions as string[]) ?? [])
      .map((id) => mentionNameById.get(id))
      .filter((n): n is string => Boolean(n)),
  }));

  return {
    ...task,
    event,
    lead,
    assignees,
    checklist,
    labels: taskLabelRows,
    comments: commentsWithMentions,
    attachments: attachmentRows,
    blockers: blockerRows,
    dependents: dependentRows,
    externalDeps,
    watcherIds: watcherRows.map((w) => w.userId),
  };
}

// dependency edges that LEAVE this event (either direction) — the Gantt
// draws same-event arrows; these render as a list below it (EPIC-012)
export async function listCrossEventDependencies(actor: Actor, eventId: string) {
  const visibleTasks = await listEventTasks(actor, eventId);
  const visibleIds = new Set(visibleTasks.map((t) => t.id));
  if (visibleIds.size === 0) return [];
  const titleById = new Map(visibleTasks.map((t) => [t.id, t.title]));

  const idList = [...visibleIds];
  const edges = await db
    .select({
      taskId: taskDependencies.taskId,
      dependsOnTaskId: taskDependencies.dependsOnTaskId,
    })
    .from(taskDependencies)
    .where(
      or(
        inArray(taskDependencies.taskId, idList),
        inArray(taskDependencies.dependsOnTaskId, idList),
      ),
    );
  const crossEdges = edges.filter(
    (e) => visibleIds.has(e.taskId) !== visibleIds.has(e.dependsOnTaskId),
  );
  if (crossEdges.length === 0) return [];

  // resolve the far end, permission-scoped: only include edges whose remote
  // task the actor may also see
  const remoteIds = crossEdges.map((e) =>
    visibleIds.has(e.taskId) ? e.dependsOnTaskId : e.taskId,
  );
  const remoteRows = await db
    .select({
      id: tasks.id,
      title: tasks.title,
      status: tasks.status,
      divisionId: tasks.divisionId,
      eventName: events.name,
    })
    .from(tasks)
    .innerJoin(events, eq(tasks.eventId, events.id))
    .where(inArray(tasks.id, remoteIds));
  const remoteById = new Map(
    remoteRows
      .filter((r) => can(actor, "task.viewDivision", { divisionId: r.divisionId }))
      .map((r) => [r.id, r]),
  );

  return crossEdges.flatMap((edge) => {
    const localWaits = visibleIds.has(edge.taskId);
    const localId = localWaits ? edge.taskId : edge.dependsOnTaskId;
    const remote = remoteById.get(localWaits ? edge.dependsOnTaskId : edge.taskId);
    if (!remote) return [];
    return [
      {
        localTaskId: localId,
        localTitle: titleById.get(localId) ?? "",
        /** true = our task waits on the other event; false = theirs waits on ours */
        localWaits,
        remoteTaskId: remote.id,
        remoteTitle: remote.title,
        remoteStatus: remote.status,
        remoteEventName: remote.eventName,
      },
    ];
  });
}

// internal users of a division (assignee / mention options)
export async function listDivisionMemberOptions(divisionId: string) {
  return db
    .select({ id: profiles.id, name: profiles.name, role: divisionMembers.role })
    .from(divisionMembers)
    .innerJoin(profiles, eq(divisionMembers.userId, profiles.id))
    .where(eq(divisionMembers.divisionId, divisionId))
    .orderBy(asc(profiles.name));
}

// members for several divisions at once (cross-division create dialog)
export async function listMembersForDivisions(divisionIds: string[]) {
  if (divisionIds.length === 0) return [];
  return db
    .select({
      divisionId: divisionMembers.divisionId,
      id: profiles.id,
      name: profiles.name,
    })
    .from(divisionMembers)
    .innerJoin(profiles, eq(divisionMembers.userId, profiles.id))
    .where(inArray(divisionMembers.divisionId, divisionIds))
    .orderBy(asc(profiles.name));
}

// same-event tasks usable as dependency targets
export async function listEventTaskOptions(
  actor: Actor,
  eventId: string,
  excludeTaskId?: string,
) {
  const rows = await listEventTasks(actor, eventId);
  return rows
    .filter((t) => t.id !== excludeTaskId)
    .map((t) => ({ id: t.id, title: t.title, divisionId: t.divisionId }));
}

// ---- cron sweeps (T-037) --------------------------------------------------

export async function sweepDueNotifications(now = new Date()): Promise<void> {
  const soon = new Date(now.getTime() + 24 * 3600_000);

  const dueSoon = await db
    .select({ id: tasks.id, title: tasks.title, dueDate: tasks.dueDate })
    .from(tasks)
    .where(and(ne(tasks.status, "done"), lt(tasks.dueDate, soon), isNull(tasks.completedAt)));

  for (const task of dueSoon) {
    const overdue = task.dueDate !== null && task.dueDate < now;
    const assignees = await db
      .select({ userId: taskAssignees.userId })
      .from(taskAssignees)
      .where(eq(taskAssignees.taskId, task.id));
    await notifyMany(
      assignees.map((a) => a.userId),
      {
        type: overdue ? "overdue" : "due_soon",
        title: `${overdue ? "Overdue" : "Due within 24h"}: ${task.title}`,
        href: `/tasks/${task.id}`,
        dedupKeyFor: (userId) =>
          `${overdue ? "overdue" : "due24"}:${task.id}:${userId}`,
      },
    );
    if (overdue) {
      // matrix: overdue also notifies the division head
      const [row] = await db
        .select({ divisionId: tasks.divisionId })
        .from(tasks)
        .where(eq(tasks.id, task.id))
        .limit(1);
      if (row) {
        const heads = await db
          .select({ userId: divisionMembers.userId })
          .from(divisionMembers)
          .where(
            and(
              eq(divisionMembers.divisionId, row.divisionId),
              eq(divisionMembers.role, "head"),
            ),
          );
        await notifyMany(
          heads.map((h) => h.userId),
          {
            type: "overdue",
            title: `Overdue in your division: ${task.title}`,
            href: `/tasks/${task.id}`,
            dedupKeyFor: (userId) => `overdue-head:${task.id}:${userId}`,
          },
        );
      }
    }
  }
}
