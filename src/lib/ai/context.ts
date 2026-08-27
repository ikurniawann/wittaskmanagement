import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { scopeCondition, visibleEventIds } from "@/lib/events/visibility";
import {
  divisions,
  eventPhases,
  events,
  profiles,
  taskAssignees,
  taskDependencies,
  taskExternalDependencies,
  tasks,
  ticketSalesSnapshots,
} from "@/db/schema";
import { eventBudgetRollup } from "@/lib/budgets/service";
import { assertCan, can, type Actor } from "@/lib/permissions";
import { summarizeStatuses } from "@/lib/tasks/progress";

// Context gatherer for the AI assistant (EPIC-014 T-140). Produces a compact
// JSON snapshot of what THIS actor is allowed to see — owner/admin get the
// whole org, a division head gets their divisions' slice. The assistant can
// only ever leak what the actor could already open in the app.

const OPEN = ["todo", "in_progress", "in_review", "blocked"] as const;

function visibleDivisionIds(actor: Actor): string[] | null {
  // null = unrestricted (owner/admin); heads see their own divisions
  if (actor.role === "owner" || actor.role === "admin") return null;
  return actor.memberships.map((m) => m.divisionId);
}

async function eventSnapshot(
  actor: Actor,
  event: {
    id: string;
    name: string;
    artists: string;
    venue: string;
    capacity: number | null;
    showDate: Date;
    health: string;
    currentPhaseId: string | null;
  },
  opts: { deep: boolean },
) {
  const scope = visibleDivisionIds(actor);

  const [phases, taskRows] = await Promise.all([
    db
      .select({ id: eventPhases.id, name: eventPhases.name })
      .from(eventPhases)
      .where(eq(eventPhases.eventId, event.id))
      .orderBy(eventPhases.sortOrder),
    db
      .select({
        id: tasks.id,
        title: tasks.title,
        status: tasks.status,
        priority: tasks.priority,
        divisionId: tasks.divisionId,
        divisionName: divisions.name,
        dueDate: tasks.dueDate,
        leadId: tasks.leadId,
        autoUrgentAt: tasks.autoUrgentAt,
      })
      .from(tasks)
      .innerJoin(divisions, eq(tasks.divisionId, divisions.id))
      .where(
        scope
          ? and(eq(tasks.eventId, event.id), inArray(tasks.divisionId, scope))
          : eq(tasks.eventId, event.id),
      ),
  ]);

  const now = Date.now();
  const daysToShow = Math.round((event.showDate.getTime() - now) / 86_400_000);
  const progress = summarizeStatuses(taskRows.map((t) => t.status));
  const isOpen = (s: string) => (OPEN as readonly string[]).includes(s);
  const openTasks = taskRows.filter((t) => isOpen(t.status));
  const overdue = openTasks.filter(
    (t) => t.dueDate && t.dueDate.getTime() < now,
  );

  // per-person open workload (the "one person overloaded" signal)
  const taskIds = taskRows.map((t) => t.id);
  const assigneeRows =
    taskIds.length === 0
      ? []
      : await db
          .select({
            taskId: taskAssignees.taskId,
            name: profiles.name,
          })
          .from(taskAssignees)
          .innerJoin(profiles, eq(taskAssignees.userId, profiles.id))
          .where(inArray(taskAssignees.taskId, taskIds));
  const openIds = new Set(openTasks.map((t) => t.id));
  const workload = new Map<string, number>();
  for (const row of assigneeRows) {
    if (!openIds.has(row.taskId)) continue;
    workload.set(row.name, (workload.get(row.name) ?? 0) + 1);
  }
  const workloadTop = [...workload.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([name, count]) => ({ name, openTasks: count }));

  // dependency pressure: waiters per blocker within the visible slice
  const depRows =
    taskIds.length === 0
      ? []
      : await db
          .select({
            taskId: taskDependencies.taskId,
            dependsOnTaskId: taskDependencies.dependsOnTaskId,
          })
          .from(taskDependencies)
          .where(inArray(taskDependencies.taskId, taskIds));
  const waiterCount = new Map<string, number>();
  for (const d of depRows) {
    if (!openIds.has(d.taskId)) continue;
    waiterCount.set(
      d.dependsOnTaskId,
      (waiterCount.get(d.dependsOnTaskId) ?? 0) + 1,
    );
  }
  const titleById = new Map(taskRows.map((t) => [t.id, t.title]));
  const bottlenecks = [...waiterCount.entries()]
    .filter(([, count]) => count >= 1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([id, count]) => ({
      task: titleById.get(id) ?? "(task in another division/project)",
      openTasksWaitingOnIt: count,
    }));

  const externalWaits =
    taskIds.length === 0
      ? []
      : await db
          .select({
            label: taskExternalDependencies.label,
            party: taskExternalDependencies.party,
          })
          .from(taskExternalDependencies)
          .where(
            and(
              inArray(taskExternalDependencies.taskId, taskIds),
              isNull(taskExternalDependencies.resolvedAt),
            ),
          );

  const [ticketRow] = await db
    .select({
      sold: sql<number>`coalesce(sum(tickets_sold), 0)::int`,
      revenue: sql<number>`coalesce(sum(revenue), 0)::bigint`,
    })
    .from(ticketSalesSnapshots)
    .where(eq(ticketSalesSnapshots.eventId, event.id));

  const budget = await eventBudgetRollup(actor, event.id).catch(() => null);

  const base = {
    id: event.id,
    name: event.name,
    artists: event.artists,
    venue: event.venue,
    capacity: event.capacity,
    showDateWIB: event.showDate.toISOString(),
    daysToShow,
    health: event.health,
    currentPhase:
      phases.find((p) => p.id === event.currentPhaseId)?.name ?? null,
    phases: phases.map((p) => p.name),
    tasks: {
      total: progress.total,
      done: progress.done,
      committedDone_pct: progress.pct,
      backlog: progress.backlog,
      open: openTasks.length,
      overdue: overdue.length,
      autoEscalatedUrgent: taskRows.filter((t) => t.autoUrgentAt).length,
    },
    workloadTop,
    bottlenecks,
    externalWaitsUnresolved: externalWaits.map((w) =>
      w.party ? `${w.label} (${w.party})` : w.label,
    ),
    tickets: {
      sold: ticketRow?.sold ?? 0,
      revenueIDR: Number(ticketRow?.revenue ?? 0),
      capacity: event.capacity,
    },
    budgetIDR: budget
      ? {
          planned: budget.totals.planned,
          committed: budget.totals.committed,
          paid: budget.totals.actual,
        }
      : null,
  };

  if (!opts.deep) return base;

  return {
    ...base,
    overdueTasks: overdue.slice(0, 15).map((t) => ({
      title: t.title,
      division: t.divisionName,
      priority: t.priority,
      dueDate: t.dueDate?.toISOString() ?? null,
    })),
    openByDivision: Object.fromEntries(
      [...new Set(openTasks.map((t) => t.divisionName))].map((name) => [
        name,
        openTasks.filter((t) => t.divisionName === name).length,
      ]),
    ),
  };
}

export async function buildAssistantContext(
  actor: Actor,
  focusEventId?: string,
) {
  assertCan(actor, "ai.assistant");
  // the snapshot must never describe an event the reader cannot open
  const eventScope = await visibleEventIds(actor);

  const activeEvents = await db
    .select({
      id: events.id,
      name: events.name,
      artists: events.artists,
      venue: events.venue,
      capacity: events.capacity,
      showDate: events.showDate,
      health: events.health,
      currentPhaseId: events.currentPhaseId,
    })
    .from(events)
    .where(
      and(isNull(events.archivedAt), scopeCondition(eventScope, events.id)),
    )
    .orderBy(events.showDate);

  const snapshots = [];
  for (const event of activeEvents) {
    snapshots.push(
      await eventSnapshot(actor, event, {
        deep: focusEventId === event.id,
      }),
    );
  }

  const scope = visibleDivisionIds(actor);
  return {
    generatedAtWIB: new Intl.DateTimeFormat("en-GB", {
      dateStyle: "full",
      timeStyle: "short",
      timeZone: "Asia/Jakarta",
    }).format(new Date()),
    viewer: {
      role: actor.role,
      scopedToDivisions: scope, // null = whole org
      canSeeBudgets: can(actor, "dashboard.view") || scope !== null,
    },
    focusEventId: focusEventId ?? null,
    events: snapshots,
  };
}
