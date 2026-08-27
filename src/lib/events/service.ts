import { and, asc, desc, eq, inArray, isNotNull, isNull, lt, ne, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  divisions,
  eventDivisions,
  eventPeople,
  eventPhases,
  events,
  profiles,
  taskAssignees,
  taskDependencies,
  tasks,
} from "@/db/schema";
import { logActivity } from "@/lib/activity";
import { assertCan, PermissionError, type Actor } from "@/lib/permissions";
import { isEventColor } from "./colors";
import { canViewEvent, scopeCondition, visibleEventIds } from "./visibility";
import { computeHealth, type HealthSignals } from "./health";

// Events service (T-021/T-022/T-023). All access permission-gated here.
// Workflow phases are per-event data (Owner request 2026-08-06).

export const DEFAULT_PHASES = [
  "Planning",
  "Pre-production",
  "Promotion",
  "Go-live week",
  "Launch day",
  "Settlement",
] as const;

export async function listActiveEvents(actor: Actor) {
  assertCan(actor, "event.view");
  const scope = await visibleEventIds(actor);
  return db
    .select({
      event: events,
      phaseName: eventPhases.name,
    })
    .from(events)
    .leftJoin(eventPhases, eq(events.currentPhaseId, eventPhases.id))
    .where(and(isNull(events.archivedAt), scopeCondition(scope, events.id)))
    .orderBy(asc(events.showDate))
    .then((rows) =>
      rows.map((r) => ({ ...r.event, phaseName: r.phaseName ?? "—" })),
    );
}

export async function getEvent(actor: Actor, eventId: string) {
  assertCan(actor, "event.view");
  // the direct-URL guard. Without it, scoping the lists would only hide
  // events from people who did not already know the address.
  if (!(await canViewEvent(actor, eventId))) return null;
  const [row] = await db
    .select({ event: events, phaseName: eventPhases.name })
    .from(events)
    .leftJoin(eventPhases, eq(events.currentPhaseId, eventPhases.id))
    .where(eq(events.id, eventId))
    .limit(1);
  return row ? { ...row.event, phaseName: row.phaseName ?? "—" } : null;
}

// ---- workflow phases ------------------------------------------------------

export async function listPhases(actor: Actor, eventId: string) {
  assertCan(actor, "event.view");
  return db
    .select()
    .from(eventPhases)
    .where(eq(eventPhases.eventId, eventId))
    .orderBy(asc(eventPhases.sortOrder));
}

export async function addPhase(actor: Actor, eventId: string, name: string) {
  assertCan(actor, "event.manageWorkflow");
  const clean = name.trim();
  if (!clean) throw new Error("Phase name is empty.");
  const [{ max }] = await db
    .select({ max: sql<number>`coalesce(max(sort_order), -1)::int` })
    .from(eventPhases)
    .where(eq(eventPhases.eventId, eventId));
  const [phase] = await db
    .insert(eventPhases)
    .values({ eventId, name: clean, sortOrder: max + 1 })
    .onConflictDoNothing()
    .returning();
  if (!phase) throw new Error("A phase with that name already exists.");
  await logActivity({
    actorId: actor.id,
    action: "event.phase.add",
    entity: `event:${eventId}`,
    detail: { name: clean },
    eventId,
  });
  return phase;
}

export async function renamePhase(
  actor: Actor,
  phaseId: string,
  name: string,
) {
  assertCan(actor, "event.manageWorkflow");
  const clean = name.trim();
  if (!clean) throw new Error("Phase name is empty.");
  const [phase] = await db
    .update(eventPhases)
    .set({ name: clean })
    .where(eq(eventPhases.id, phaseId))
    .returning();
  if (phase) {
    await logActivity({
      actorId: actor.id,
      action: "event.phase.rename",
      entity: `event:${phase.eventId}`,
      detail: { name: clean },
      eventId: phase.eventId,
    });
  }
}

export async function deletePhase(actor: Actor, phaseId: string) {
  assertCan(actor, "event.manageWorkflow");
  const [phase] = await db
    .select()
    .from(eventPhases)
    .where(eq(eventPhases.id, phaseId))
    .limit(1);
  if (!phase) return;
  const [event] = await db
    .select({ currentPhaseId: events.currentPhaseId })
    .from(events)
    .where(eq(events.id, phase.eventId))
    .limit(1);
  if (event?.currentPhaseId === phaseId) {
    throw new Error("This is the current phase — move the event first.");
  }
  const all = await db
    .select({ id: eventPhases.id })
    .from(eventPhases)
    .where(eq(eventPhases.eventId, phase.eventId))
    .orderBy(asc(eventPhases.sortOrder));
  if (all.length <= 1) throw new Error("An event needs at least one phase.");

  // delete + renumber the remainder contiguously (0..n-1) in one
  // transaction — closes the gap immediately instead of letting sort_order
  // drift, which is what let a later insert collide in the first place
  // (Owner-reported bug 2026-08-07, fixed by migration 0023)
  await db.transaction(async (tx) => {
    await tx.delete(eventPhases).where(eq(eventPhases.id, phaseId));
    const remaining = all.filter((p) => p.id !== phaseId);
    for (const [index, p] of remaining.entries()) {
      await tx
        .update(eventPhases)
        .set({ sortOrder: index })
        .where(eq(eventPhases.id, p.id));
    }
  });
  await logActivity({
    actorId: actor.id,
    action: "event.phase.delete",
    entity: `event:${phase.eventId}`,
    detail: { name: phase.name },
    eventId: phase.eventId,
  });
}

export async function movePhase(
  actor: Actor,
  phaseId: string,
  direction: "up" | "down",
) {
  assertCan(actor, "event.manageWorkflow");
  const [phase] = await db
    .select()
    .from(eventPhases)
    .where(eq(eventPhases.id, phaseId))
    .limit(1);
  if (!phase) return;
  const siblings = await db
    .select()
    .from(eventPhases)
    .where(eq(eventPhases.eventId, phase.eventId))
    .orderBy(asc(eventPhases.sortOrder));
  const index = siblings.findIndex((s) => s.id === phaseId);
  const swapWith = direction === "up" ? siblings[index - 1] : siblings[index + 1];
  if (!swapWith) return;
  // atomic swap (Owner-reported bug 2026-08-07): two separate awaited
  // UPDATEs could leave both rows on the same sort_order if the process
  // died between them — a transaction makes the swap all-or-nothing. The
  // intermediate step through a scratch value also dodges the unique
  // index mid-transaction (Postgres checks uniqueness after each
  // statement, not at commit, for a non-deferred index).
  await db.transaction(async (tx) => {
    const scratch = -1 - Math.abs(phase.sortOrder);
    await tx
      .update(eventPhases)
      .set({ sortOrder: scratch })
      .where(eq(eventPhases.id, phase.id));
    await tx
      .update(eventPhases)
      .set({ sortOrder: phase.sortOrder })
      .where(eq(eventPhases.id, swapWith.id));
    await tx
      .update(eventPhases)
      .set({ sortOrder: swapWith.sortOrder })
      .where(eq(eventPhases.id, phase.id));
  });
}

export async function setCurrentPhase(
  actor: Actor,
  eventId: string,
  phaseId: string,
) {
  assertCan(actor, "event.updatePhase");
  const [phase] = await db
    .select()
    .from(eventPhases)
    .where(and(eq(eventPhases.id, phaseId), eq(eventPhases.eventId, eventId)))
    .limit(1);
  if (!phase) throw new Error("Phase not found on this event.");
  await db
    .update(events)
    .set({ currentPhaseId: phaseId, updatedAt: new Date() })
    .where(eq(events.id, eventId));
  await logActivity({
    actorId: actor.id,
    action: "event.updatePhase",
    entity: `event:${eventId}`,
    detail: { phase: phase.name },
    eventId,
  });
}

export async function createEvent(
  actor: Actor,
  input: {
    name: string;
    color?: string | null;
    artists: string;
    venue: string;
    showDate: Date;
    capacity?: number;
    coverImagePath?: string;
    picId?: string | null;
    memberIds?: string[];
  },
) {
  assertCan(actor, "event.create");
  const [event] = await db
    .insert(events)
    .values({
      name: input.name.trim(),
      artists: input.artists.trim(),
      venue: input.venue.trim(),
      showDate: input.showDate,
      capacity: input.capacity ?? null,
      coverImagePath: input.coverImagePath ?? null,
      // an unrecognised value would render as no swatch at all, so it is
      // dropped here rather than trusted from the form
      color:
        input.color && isEventColor(input.color) ? input.color : null,
    })
    .returning();

  // all divisions participate by default; trimmed later per event if needed
  const allDivisions = await db.select({ id: divisions.id }).from(divisions);
  if (allDivisions.length > 0) {
    await db
      .insert(eventDivisions)
      .values(allDivisions.map((d) => ({ eventId: event.id, divisionId: d.id })))
      .onConflictDoNothing();
  }

  // event-level crew, picked before the event exists (Owner 2026-08-13)
  await writeEventPeople(event.id, input.picId ?? null, input.memberIds ?? []);

  // default workflow — fully editable per event afterwards
  const phases = await db
    .insert(eventPhases)
    .values(
      DEFAULT_PHASES.map((name, index) => ({
        eventId: event.id,
        name,
        sortOrder: index,
      })),
    )
    .returning();
  await db
    .update(events)
    .set({ currentPhaseId: phases[0].id })
    .where(eq(events.id, event.id));

  await logActivity({
    actorId: actor.id,
    action: "event.create",
    entity: `event:${event.id}`,
    detail: { name: event.name, showDate: event.showDate.toISOString() },
    eventId: event.id,
  });
  return event;
}

/** One PIC + members, deduped; the PIC wins when listed in both. */
async function writeEventPeople(
  eventId: string,
  picId: string | null,
  memberIds: string[],
) {
  await db.delete(eventPeople).where(eq(eventPeople.eventId, eventId));
  const rows: Array<{ eventId: string; userId: string; role: string }> = [];
  if (picId) rows.push({ eventId, userId: picId, role: "pic" });
  for (const userId of memberIds) {
    if (userId && userId !== picId) rows.push({ eventId, userId, role: "member" });
  }
  if (rows.length > 0) {
    await db.insert(eventPeople).values(rows).onConflictDoNothing();
  }
}

export async function getEventPeople(actor: Actor, eventId: string) {
  assertCan(actor, "event.view");
  if (!(await canViewEvent(actor, eventId))) {
    return { pic: null as null | { id: string; name: string; avatarPath: string | null }, members: [] as Array<{ id: string; name: string; avatarPath: string | null }> };
  }
  const rows = await db
    .select({
      id: profiles.id,
      name: profiles.name,
      avatarPath: profiles.avatarPath,
      role: eventPeople.role,
    })
    .from(eventPeople)
    .innerJoin(profiles, eq(profiles.id, eventPeople.userId))
    .where(eq(eventPeople.eventId, eventId))
    .orderBy(asc(profiles.name));
  return {
    pic: rows.find((r) => r.role === "pic") ?? null,
    members: rows.filter((r) => r.role !== "pic"),
  };
}

export async function setEventPeople(
  actor: Actor,
  eventId: string,
  input: { picId: string | null; memberIds: string[] },
) {
  assertCan(actor, "event.edit");
  if (!(await canViewEvent(actor, eventId))) {
    throw new PermissionError("event.edit");
  }
  await writeEventPeople(eventId, input.picId, input.memberIds);
  await logActivity({
    actorId: actor.id,
    action: "event.update",
    entity: `event:${eventId}`,
    detail: { picId: input.picId ?? "(none)", members: input.memberIds.length },
    eventId,
  });
}

/** Active internal users, for the PIC/member pickers. */
export async function listAssignablePeople(actor: Actor) {
  assertCan(actor, "event.view");
  return db
    .select({ id: profiles.id, name: profiles.name })
    .from(profiles)
    .where(and(eq(profiles.isActive, true), ne(profiles.role, "external")))
    .orderBy(asc(profiles.name));
}

export async function updateEvent(
  actor: Actor,
  eventId: string,
  input: {
    name: string;
    artists: string;
    venue: string;
    showDate: Date;
    capacity?: number | null;
    color?: string | null;
    /** undefined = keep the current poster */
    coverImagePath?: string;
  },
) {
  assertCan(actor, "event.edit");
  // the capability says "heads may edit events"; visibility says WHICH ones —
  // a head cannot edit a show their division is not even allowed to see
  if (!(await canViewEvent(actor, eventId))) {
    throw new PermissionError("event.edit");
  }
  const name = input.name.trim();
  if (!name) throw new Error("An event needs a name.");
  await db
    .update(events)
    .set({
      name,
      artists: input.artists.trim(),
      venue: input.venue.trim(),
      showDate: input.showDate,
      capacity: input.capacity ?? null,
      color: input.color && isEventColor(input.color) ? input.color : null,
      ...(input.coverImagePath !== undefined
        ? { coverImagePath: input.coverImagePath }
        : {}),
      updatedAt: new Date(),
    })
    .where(eq(events.id, eventId));
  await logActivity({
    actorId: actor.id,
    action: "event.update",
    entity: `event:${eventId}`,
    detail: { name, showDate: input.showDate.toISOString() },
    eventId,
  });
}

/**
 * Archived events, newest show first.
 *
 * Every other list in the app filters `archivedAt IS NULL` — sidebar,
 * dashboard, search, tickets, budgets, the AI snapshot — so without this an
 * archived event is not merely hidden but unreachable, and `setArchived(…,
 * false)` can never be called because nothing can show you the event to
 * un-archive it.
 */
export async function listArchivedEvents(actor: Actor) {
  assertCan(actor, "event.view");
  return db
    .select({ event: events, phaseName: eventPhases.name })
    .from(events)
    .leftJoin(eventPhases, eq(events.currentPhaseId, eventPhases.id))
    .where(
      and(isNotNull(events.archivedAt), scopeCondition(await visibleEventIds(actor), events.id)),
    )
    .orderBy(desc(events.showDate))
    .then((rows) =>
      rows.map((r) => ({ ...r.event, phaseName: r.phaseName ?? "—" })),
    );
}

/**
 * People with work on this event — leads and assignees, deduplicated.
 *
 * Answers "who is on this show?" at a glance in the header. Membership of a
 * participating division is deliberately NOT enough: a division of twelve
 * would fill the strip with people who have never touched the event.
 */
export async function listEventPeople(actor: Actor, eventId: string) {
  assertCan(actor, "event.view");
  if (!(await canViewEvent(actor, eventId))) return [];

  const rows = await db
    .selectDistinct({
      id: profiles.id,
      name: profiles.name,
      avatarPath: profiles.avatarPath,
    })
    .from(tasks)
    .leftJoin(taskAssignees, eq(taskAssignees.taskId, tasks.id))
    .innerJoin(
      profiles,
      or(eq(profiles.id, tasks.leadId), eq(profiles.id, taskAssignees.userId)),
    )
    .where(eq(tasks.eventId, eventId))
    .orderBy(asc(profiles.name));
  // event-level crew belongs in the strip too — a PIC with no task yet is
  // still on the show (Owner 2026-08-13)
  const crew = await db
    .select({
      id: profiles.id,
      name: profiles.name,
      avatarPath: profiles.avatarPath,
    })
    .from(eventPeople)
    .innerJoin(profiles, eq(profiles.id, eventPeople.userId))
    .where(eq(eventPeople.eventId, eventId));
  const seen = new Set(rows.map((r) => r.id));
  for (const person of crew) {
    if (!seen.has(person.id)) rows.push(person);
  }
  return rows;
}

export async function setArchived(
  actor: Actor,
  eventId: string,
  archived: boolean,
) {
  assertCan(actor, "event.archive");
  await db
    .update(events)
    .set({ archivedAt: archived ? new Date() : null, updatedAt: new Date() })
    .where(eq(events.id, eventId));
  await logActivity({
    actorId: actor.id,
    action: archived ? "event.archive" : "event.unarchive",
    entity: `event:${eventId}`,
    eventId,
  });
}

// ---- division roster per event (Owner request 2026-08-06) -----------------

export async function listEventDivisions(actor: Actor, eventId: string) {
  assertCan(actor, "event.view");
  return db
    .select({ id: divisions.id, name: divisions.name })
    .from(eventDivisions)
    .innerJoin(divisions, eq(eventDivisions.divisionId, divisions.id))
    .where(eq(eventDivisions.eventId, eventId))
    .orderBy(asc(divisions.sortOrder));
}

export async function setEventDivisions(
  actor: Actor,
  eventId: string,
  divisionIds: string[],
) {
  assertCan(actor, "event.manageDivisions");
  if (divisionIds.length === 0) {
    throw new Error("An event needs at least one division.");
  }
  const current = await db
    .select({ divisionId: eventDivisions.divisionId })
    .from(eventDivisions)
    .where(eq(eventDivisions.eventId, eventId));
  const wanted = new Set(divisionIds);
  const existing = new Set(current.map((c) => c.divisionId));

  const toRemove = [...existing].filter((id) => !wanted.has(id));
  if (toRemove.length > 0) {
    await db
      .delete(eventDivisions)
      .where(
        and(
          eq(eventDivisions.eventId, eventId),
          inArray(eventDivisions.divisionId, toRemove),
        ),
      );
  }
  const toAdd = [...wanted].filter((id) => !existing.has(id));
  if (toAdd.length > 0) {
    await db
      .insert(eventDivisions)
      .values(toAdd.map((divisionId) => ({ eventId, divisionId })))
      .onConflictDoNothing();
  }
  await logActivity({
    actorId: actor.id,
    action: "event.updateDivisions",
    entity: `event:${eventId}`,
    detail: { divisions: divisionIds },
    eventId,
  });
}

// ---- health (T-023) -------------------------------------------------------

// Signal gathering. Task signals live (EPIC-003); budget signals live (EPIC-005).
async function gatherSignals(eventId: string): Promise<HealthSignals> {
  const now = new Date();
  // lazy import avoids a static service cycle (budgets → events)
  const { budgetHealthSignals } = await import("@/lib/budgets/service");
  const budget = await budgetHealthSignals(eventId);

  const [overdueRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(tasks)
    .where(
      and(eq(tasks.eventId, eventId), ne(tasks.status, "done"), lt(tasks.dueDate, now)),
    );

  // "critical path" approximation until EPIC-008's real Gantt: a blocked task
  // that other tasks depend on is treated as path-blocking
  const [blockedRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(tasks)
    .innerJoin(taskDependencies, eq(taskDependencies.dependsOnTaskId, tasks.id))
    .where(and(eq(tasks.eventId, eventId), eq(tasks.status, "blocked")));

  return {
    overdueTasks: overdueRow?.count ?? 0,
    blockedOnCriticalPath: (blockedRow?.count ?? 0) > 0,
    ...budget,
  };
}

export async function recomputeEventHealth(eventId: string): Promise<void> {
  const signals = await gatherSignals(eventId);
  const health = computeHealth(signals);
  await db
    .update(events)
    .set({ health, updatedAt: new Date() })
    .where(eq(events.id, eventId));
}

export async function recomputeAllEventHealth(): Promise<number> {
  const active = await db
    .select({ id: events.id })
    .from(events)
    .where(isNull(events.archivedAt));
  for (const e of active) {
    await recomputeEventHealth(e.id);
  }
  return active.length;
}
