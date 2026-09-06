import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  activityLog,
  divisionMembers,
  divisions,
  events,
  profiles,
  taskAssignees,
  tasks,
  taskWatchers,
} from "@/db/schema";
import type { Actor } from "@/lib/permissions";
import { STATUS_LABELS, type TaskStatus } from "./service";

// "Your work" profile data (Owner 2026-08-07, Plane-style My Tasks).
// Everything is strictly ME-scoped: my created / assigned / watched items,
// my workload, my activity — no cross-user reads, so no extra gating beyond
// being signed in.

export interface MyWork {
  profile: {
    name: string;
    email: string;
    role: string;
    joinedAt: Date;
  };
  /** current WIB wall-clock, e.g. "12:59" — computed here, not in render */
  wibClock: string;
  counts: { created: number; assigned: number; watched: number };
  workload: Array<{ status: TaskStatus; label: string; count: number }>;
  byPriority: Array<{ priority: "urgent" | "high" | "medium" | "low"; count: number }>;
  events: Array<{ id: string; name: string; open: number }>;
  divisions: Array<{ id: string; name: string; role: string }>;
  activity: Array<{
    id: string;
    actionLabel: string;
    entityLabel: string;
    eventName: string | null;
    createdAt: Date;
  }>;
}

const OPEN = ["todo", "in_progress", "in_review", "blocked"] as const;

export async function getMyWork(actor: Actor): Promise<MyWork> {
  const [me] = await db
    .select({
      name: profiles.name,
      email: profiles.email,
      role: profiles.role,
      joinedAt: profiles.createdAt,
    })
    .from(profiles)
    .where(eq(profiles.id, actor.id))
    .limit(1);

  const [createdRow, watchedRow, assignedStatusRows, myDivisions, activityRows] =
    await Promise.all([
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(tasks)
        .where(eq(tasks.createdBy, actor.id)),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(taskWatchers)
        .where(eq(taskWatchers.userId, actor.id)),
      db
        .select({
          status: tasks.status,
          priority: tasks.priority,
          eventId: tasks.eventId,
          eventName: events.name,
        })
        .from(taskAssignees)
        .innerJoin(tasks, eq(taskAssignees.taskId, tasks.id))
        .innerJoin(events, eq(tasks.eventId, events.id))
        .where(eq(taskAssignees.userId, actor.id)),
      db
        .select({
          id: divisions.id,
          name: divisions.name,
          role: divisionMembers.role,
        })
        .from(divisionMembers)
        .innerJoin(divisions, eq(divisionMembers.divisionId, divisions.id))
        .where(eq(divisionMembers.userId, actor.id))
        .orderBy(divisions.sortOrder),
      db
        .select({
          id: activityLog.id,
          action: activityLog.action,
          entity: activityLog.entity,
          createdAt: activityLog.createdAt,
          eventName: events.name,
        })
        .from(activityLog)
        .leftJoin(events, eq(activityLog.eventId, events.id))
        .where(
          and(eq(activityLog.actorId, actor.id), ne(activityLog.action, "auth.signin")),
        )
        .orderBy(desc(activityLog.createdAt))
        .limit(10),
    ]);

  const workload = (
    ["backlog", ...OPEN, "done", "cancelled"] as TaskStatus[]
  ).map((status) => ({
    status,
    label: STATUS_LABELS[status],
    count: assignedStatusRows.filter((r) => r.status === status).length,
  }));

  const openRows = assignedStatusRows.filter((r) =>
    (OPEN as readonly string[]).includes(r.status),
  );
  const byPriority = (["urgent", "high", "medium", "low"] as const).map(
    (priority) => ({
      priority,
      count: openRows.filter((r) => r.priority === priority).length,
    }),
  );

  const eventMap = new Map<string, { id: string; name: string; open: number }>();
  for (const row of openRows) {
    const entry = eventMap.get(row.eventId) ?? {
      id: row.eventId,
      name: row.eventName,
      open: 0,
    };
    entry.open += 1;
    eventMap.set(row.eventId, entry);
  }

  const { actionLabel, resolveEntityLabels } = await import(
    "@/lib/activity-labels"
  );
  const entityLabels = await resolveEntityLabels(activityRows.map((r) => r.entity));

  return {
    profile: me,
    wibClock: new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Asia/Jakarta",
    }).format(new Date()),
    counts: {
      created: createdRow[0]?.count ?? 0,
      assigned: assignedStatusRows.length,
      watched: watchedRow[0]?.count ?? 0,
    },
    workload,
    byPriority,
    events: [...eventMap.values()].sort((a, b) => b.open - a.open),
    divisions: myDivisions,
    activity: activityRows.map((r) => ({
      id: r.id,
      actionLabel: actionLabel(r.action),
      entityLabel: entityLabels.get(r.entity) ?? "",
      eventName: r.eventName,
      createdAt: r.createdAt,
    })),
  };
}

// tasks I created (open first), for the Created tab
export async function listMyCreatedTasks(actor: Actor) {
  return db
    .select({ task: tasks, eventName: events.name })
    .from(tasks)
    .innerJoin(events, eq(tasks.eventId, events.id))
    .where(and(eq(tasks.createdBy, actor.id), ne(tasks.status, "cancelled")))
    .orderBy(desc(tasks.createdAt))
    .limit(50);
}

// tasks I watch, for the Watched tab
export async function listMyWatchedTasks(actor: Actor) {
  return db
    .select({ task: tasks, eventName: events.name })
    .from(taskWatchers)
    .innerJoin(tasks, eq(taskWatchers.taskId, tasks.id))
    .innerJoin(events, eq(tasks.eventId, events.id))
    .where(eq(taskWatchers.userId, actor.id))
    .orderBy(desc(tasks.updatedAt))
    .limit(50);
}

export async function listMyActivity(actor: Actor, limit = 30) {
  const rows = await db
    .select({
      id: activityLog.id,
      action: activityLog.action,
      entity: activityLog.entity,
      createdAt: activityLog.createdAt,
      eventName: events.name,
    })
    .from(activityLog)
    .leftJoin(events, eq(activityLog.eventId, events.id))
    .where(
      and(eq(activityLog.actorId, actor.id), ne(activityLog.action, "auth.signin")),
    )
    .orderBy(desc(activityLog.createdAt))
    .limit(limit);
  const { actionLabel, resolveEntityLabels } = await import(
    "@/lib/activity-labels"
  );
  const entityLabels = await resolveEntityLabels(rows.map((r) => r.entity));
  return rows.map((r) => ({
    id: r.id,
    actionLabel: actionLabel(r.action),
    entityLabel: entityLabels.get(r.entity) ?? "",
    eventName: r.eventName,
    createdAt: r.createdAt,
  }));
}

// helper used by the header tab for unscoped assigned lists (unchanged
// behavior from the old page lives in the Assigned tab)
export const OPEN_STATUSES = OPEN;

/** "17 minutes ago" — lives here because clock reads are banned in render. */
export function relativeTime(date: Date): string {
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  const months = Math.floor(days / 30);
  return `${months} month${months === 1 ? "" : "s"} ago`;
}

// ---- drill-down behind the Summary numbers (Owner 2026-08-31) ------------

export type MyWorkSource = "created" | "assigned" | "watched";

export interface MyWorkFilter {
  status?: TaskStatus;
  priority?: "urgent" | "high" | "medium" | "low";
}

export interface MyWorkRow {
  id: string;
  title: string;
  status: TaskStatus;
  priority: "urgent" | "high" | "medium" | "low";
  /** ISO, because this crosses into a client component */
  dueDate: string | null;
  eventName: string;
}

/**
 * The tasks behind one number on the Summary tab.
 *
 * Each branch repeats the predicate of the counter it belongs to, on purpose,
 * rather than reusing listMyCreatedTasks / listMyWatchedTasks: those drop
 * cancelled work and stop at 50, so a card saying 24 would open a list of 19.
 * A number you can click has to open exactly what it counted, or the click
 * teaches people not to trust the number.
 *
 * `priority` is only meaningful for open work — that is what the priority
 * chart shows — so it carries the same OPEN restriction the chart uses.
 */
export async function listMyWorkDrilldown(
  actor: Actor,
  source: MyWorkSource,
  filter: MyWorkFilter = {},
): Promise<MyWorkRow[]> {
  const shape = {
    id: tasks.id,
    title: tasks.title,
    status: tasks.status,
    priority: tasks.priority,
    dueDate: tasks.dueDate,
    eventName: events.name,
  };

  const conditions = [];
  if (filter.status) conditions.push(eq(tasks.status, filter.status));
  if (filter.priority) {
    conditions.push(eq(tasks.priority, filter.priority));
    conditions.push(inArray(tasks.status, [...OPEN]));
  }

  let rows;
  if (source === "created") {
    rows = await db
      .select(shape)
      .from(tasks)
      .innerJoin(events, eq(tasks.eventId, events.id))
      .where(and(eq(tasks.createdBy, actor.id), ...conditions))
      .orderBy(asc(tasks.dueDate), desc(tasks.createdAt));
  } else if (source === "watched") {
    rows = await db
      .select(shape)
      .from(taskWatchers)
      .innerJoin(tasks, eq(taskWatchers.taskId, tasks.id))
      .innerJoin(events, eq(tasks.eventId, events.id))
      .where(and(eq(taskWatchers.userId, actor.id), ...conditions))
      .orderBy(asc(tasks.dueDate), desc(tasks.updatedAt));
  } else {
    rows = await db
      .select(shape)
      .from(taskAssignees)
      .innerJoin(tasks, eq(taskAssignees.taskId, tasks.id))
      .innerJoin(events, eq(tasks.eventId, events.id))
      .where(and(eq(taskAssignees.userId, actor.id), ...conditions))
      .orderBy(asc(tasks.dueDate), desc(tasks.updatedAt));
  }

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    status: r.status as TaskStatus,
    priority: r.priority as MyWorkRow["priority"],
    dueDate: r.dueDate ? r.dueDate.toISOString() : null,
    eventName: r.eventName,
  }));
}
