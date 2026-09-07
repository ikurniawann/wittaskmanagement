import { amountTier } from "./world/mapping";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { activityLog, handoffs, playProfiles, taskChecklistItems } from "@/db/schema";
import { listActiveEvents } from "@/lib/events/service";
import { unreadCount } from "@/lib/notifications";
import { listDivisions, listUsersWithMemberships } from "@/lib/org/service";
import { assertCan, PermissionError, type Actor } from "@/lib/permissions";
import { getDependencyBadges } from "@/lib/tasks/dependency-engine";
import { getTaskScoped, listEventTasks } from "@/lib/tasks/service";
import type { PlayDivision, PlayEvent, PlayHandoff, PlayPerson, PlayTask, PlayWorld } from "./types";
import { initialsOf } from "./util";
import { divisionLeaderboard, divisionPulse, myPlayProfile } from "./xp/admin";
import { generateQuestsFor } from "./xp/quests";
import { divisionColor } from "./world/layout";

// EPIC-024 T-242 — the world snapshot. One permission-scoped read that the
// engine turns into rooms, characters and objects. Every list here is
// assembled through the SAME service functions the app pages use
// (listActiveEvents, listEventTasks), so the office can never show a task or
// project the boards would hide. Dates cross into a client component, hence
// ISO strings throughout.

const CLOSED = new Set(["done", "cancelled"]);

type TaskRowLike = {
  id: string;
  title: string;
  status: PlayTask["status"];
  priority: PlayTask["priority"];
  divisionId: string;
  eventId: string;
  leadId: string | null;
  dueDate: Date | null;
  assigneeIds: string[];
};

/** Checklist counts + EPIC-012 badges on top of already-visible task rows. */
async function enrichTasks(rows: TaskRowLike[], now: Date): Promise<PlayTask[]> {
  const ids = rows.map((t) => t.id);
  const [checklist, badges] = await Promise.all([
    ids.length
      ? db
          .select({
            taskId: taskChecklistItems.taskId,
            total: sql<number>`count(*)::int`,
            done: sql<number>`count(*) filter (where ${taskChecklistItems.done})::int`,
          })
          .from(taskChecklistItems)
          .where(inArray(taskChecklistItems.taskId, ids))
          .groupBy(taskChecklistItems.taskId)
      : Promise.resolve([] as Array<{ taskId: string; total: number; done: number }>),
    getDependencyBadges(rows.map((t) => ({ id: t.id, status: t.status, dueDate: t.dueDate }))),
  ]);
  const checklistByTask = new Map(checklist.map((c) => [c.taskId, c]));
  return rows.map((t) => {
    const c = checklistByTask.get(t.id);
    const b = badges.get(t.id);
    return {
      id: t.id,
      title: t.title,
      status: t.status,
      priority: t.priority,
      divisionId: t.divisionId,
      eventId: t.eventId,
      assigneeIds: t.assigneeIds,
      leadId: t.leadId ?? null,
      dueDate: t.dueDate ? t.dueDate.toISOString() : null,
      overdue: !!t.dueDate && t.dueDate.getTime() < now.getTime() && !CLOSED.has(t.status),
      checklistTotal: c?.total ?? 0,
      checklistDone: c?.done ?? 0,
      waiters: b?.waiters ?? 0,
      critical: b?.critical ?? false,
    };
  });
}

/** One task, same visibility rule as the task page (null = not visible / gone). Closed tasks come back too, so the scene can fade them. */
export async function getPlayTask(actor: Actor, taskId: string): Promise<PlayTask | null> {
  assertCan(actor, "play.view");
  const t = await getTaskScoped(actor, taskId);
  if (!t) return null;
  const [pt] = await enrichTasks([{ ...t, assigneeIds: t.assigneeIds }], new Date());
  return pt ?? null;
}

export async function getPlayWorld(actor: Actor): Promise<PlayWorld> {
  assertCan(actor, "play.view");
  const now = new Date();

  // ---- projects (visible per EPIC-021) ------------------------------------
  let eventRows: Awaited<ReturnType<typeof listActiveEvents>> = [];
  try {
    eventRows = await listActiveEvents(actor);
  } catch (error) {
    if (!(error instanceof PermissionError)) throw error;
  }
  const events: PlayEvent[] = eventRows.map((r) => ({
    id: r.id,
    name: r.name,
    showDate: r.showDate ? r.showDate.toISOString() : null,
    phase: r.phaseName ?? null,
    health: r.health ?? null,
  }));
  const eventIds = events.map((e) => e.id);

  // ---- tasks (visible per task rules, via the board's own list function) --
  const perEvent = await Promise.all(eventIds.map((id) => listEventTasks(actor, id)));
  const tasks = await enrichTasks(
    perEvent.flat().filter((t) => !CLOSED.has(t.status)).map((t) => ({ ...t, assigneeIds: t.assignees.map((a) => a.id) })),
    now,
  );

  // ---- org: rooms and characters ------------------------------------------
  const [divisionRows, users, playRows] = await Promise.all([listDivisions(), listUsersWithMemberships(), db.select({ userId: playProfiles.userId, level: playProfiles.level, cosmetics: playProfiles.cosmetics }).from(playProfiles)]);
  const playByUser = new Map(playRows.map((p) => [p.userId, p]));
  const active = users.filter((u) => u.isActive && u.role !== "external");
  const divisions: PlayDivision[] = divisionRows.map((d) => {
    const members = active.filter((u) => u.memberships.some((m) => m.divisionId === d.id));
    const head = members.find((u) => u.memberships.some((m) => m.divisionId === d.id && m.role === "head"));
    return {
      id: d.id,
      name: d.name,
      color: divisionColor(d.id),
      headId: head?.id ?? null,
      memberIds: members.map((u) => u.id),
    };
  });
  const people: PlayPerson[] = active.map((u) => {
    // primary division = the one they head, else their first membership
    const headOf = u.memberships.find((m) => m.role === "head");
    const primary = headOf ?? u.memberships[0];
    return {
      id: u.id,
      name: u.name,
      initials: initialsOf(u.name),
      avatarUrl: u.avatarPath ? `/api/files/${u.avatarPath}` : null,
      divisionId: primary?.divisionId ?? null,
      isHead: !!headOf,
      level: playByUser.get(u.id)?.level ?? 0,
      cosmetics: ((playByUser.get(u.id)?.cosmetics as PlayPerson["cosmetics"] | null) ?? {}),
    };
  });
  const me = people.find((p) => p.id === actor.id);

  // ---- couriers: pending handoffs in visible projects -----------------------
  const handoffRows = eventIds.length
    ? await db
        .select({
          id: handoffs.id,
          fromDivisionId: handoffs.fromDivisionId,
          toDivisionId: handoffs.toDivisionId,
          title: handoffs.title,
        })
        .from(handoffs)
        .where(and(eq(handoffs.status, "pending"), inArray(handoffs.eventId, eventIds)))
    : [];
  const handoffList: PlayHandoff[] = handoffRows;

  // ---- my queue, bell, cursor ---------------------------------------------
  let approvalsWaiting = 0;
  let approvalTiers: number[] = [];
  try {
    const { listMyQueue, getThresholds } = await import("@/lib/approvals/service");
    const [queue, thresholds] = await Promise.all([listMyQueue(actor), getThresholds()]);
    approvalsWaiting = queue.length;
    approvalTiers = queue.map((a) => amountTier(a.amount, thresholds));
  } catch (error) {
    if (!(error instanceof PermissionError)) throw error;
  }
  const [unread, [latest]] = await Promise.all([
    unreadCount(actor.id),
    db.select({ createdAt: activityLog.createdAt }).from(activityLog).orderBy(desc(activityLog.createdAt)).limit(1),
  ]);

  // EPIC-026: my progress, today's quests (generated on first sight), team pulse, leaderboard
  const myDivision = me?.divisionId ?? null;
  const [mine, quests, pulse, leaderboard] = await Promise.all([
    myPlayProfile(actor.id),
    generateQuestsFor(actor.id, now).catch(() => []),
    myDivision ? divisionPulse(myDivision) : Promise.resolve(null),
    myDivision ? divisionLeaderboard(myDivision) : Promise.resolve(null),
  ]);

  return {
    me: { id: actor.id, divisionId: myDivision, xp: mine.xp, level: mine.level, nextLevelXp: mine.nextLevelXp, todayXp: mine.today, leaderboardOptIn: mine.leaderboardOptIn },
    quests,
    pulse: pulse ? { divisionId: pulse.divisionId, weekXp: pulse.weekXp, onTimeRate: pulse.onTimeRate, activeMembers: pulse.activeMembers } : null,
    leaderboard,
    divisions,
    people,
    tasks,
    handoffs: handoffList,
    events,
    approvalsWaiting,
    approvalTiers,
    unreadNotifications: unread,
    cursor: latest?.createdAt ? latest.createdAt.toISOString() : null,
    generatedAt: now.toISOString(),
  };
}
