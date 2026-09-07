import { and, asc, desc, eq, gte, inArray, lt, notInArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  activityLog,
  appSettings,
  approvalSteps,
  approvals,
  comments,
  divisionMembers,
  events,
  handoffs,
  playBadgeAwards,
  playBadges,
  playProfiles,
  playQuests,
  playXpLedger,
  taskChecklistItems,
  taskDependencies,
  tasks,
} from "@/db/schema";
import { logActivity } from "@/lib/activity";
import { isPlayEnabled } from "@/lib/play/settings";
import { entityOf } from "@/lib/play/world/diff";
import { BADGES, cosmeticsForLevel } from "./badges";
import { DEFAULT_RULES, levelFor, mergeRules, scoreActivity, wibDay, type LedgerEntry, type RulesConfig, type ScoreFacts } from "./rules";

// EPIC-026 T-261 — scoring service. `onActivityLogged` is the incremental
// path (fire-and-forget from logActivity); `recompute` replays a user's
// activity from scratch and must land on the same total. Everything durable
// is derived: ledger ← activity_log, profile xp/level ← ledger, badges ←
// ledger + log, cosmetics ← level.

type ActivityRowDb = typeof activityLog.$inferSelect;

const SCORED = /^(task\.status|task\.checklist_done|comment\.add|handoff\.(accept|decline)|approval\.(approved|rejected|changes_requested)|play\.quest_complete)$/;
const CLOSED = ["done", "cancelled"] as const;

// ---- config -------------------------------------------------------------------
let rulesCache: { at: number; cfg: RulesConfig } | null = null;
export async function getRules(): Promise<RulesConfig> {
  if (rulesCache && Date.now() - rulesCache.at < 30000) return rulesCache.cfg;
  let cfg = DEFAULT_RULES;
  try {
    const [row] = await db.select().from(appSettings).where(eq(appSettings.key, "play_rules")).limit(1);
    cfg = mergeRules(row?.value);
  } catch { /* defaults */ }
  rulesCache = { at: Date.now(), cfg };
  return cfg;
}
export function invalidateRules(): void {
  rulesCache = null;
}
let enabledCache: { at: number; on: boolean } | null = null;
async function enabled(): Promise<boolean> {
  if (enabledCache && Date.now() - enabledCache.at < 60000) return enabledCache.on;
  const on = await isPlayEnabled();
  enabledCache = { at: Date.now(), on };
  return on;
}

// ---- incremental path ------------------------------------------------------------
export async function onActivityLogged(row: ActivityRowDb): Promise<void> {
  if (!row.actorId || !SCORED.test(row.action)) return;
  if (!(await enabled())) return;
  await scoreRow(row, await getRules());
}

/** Score one row into the ledger (idempotent on activity+rule) and refresh the profile. */
export async function scoreRow(row: ActivityRowDb, cfg: RulesConfig): Promise<LedgerEntry[]> {
  if (!row.actorId) return [];
  const facts = await gatherFacts(row);
  if (!facts) return [];
  const entries = scoreActivity(facts, cfg);
  if (entries.length === 0) return [];
  const day = wibDay(row.createdAt);
  const meta = await refMeta(facts);
  await db
    .insert(playXpLedger)
    .values(entries.map((e) => ({
      userId: row.actorId!,
      activityId: row.id,
      rule: e.rule,
      points: e.points,
      ref: e.ref,
      eventId: meta.eventId,
      divisionId: meta.divisionId,
      flagged: e.flagged,
      reason: e.reason,
      day,
      createdAt: row.createdAt,
    })))
    .onConflictDoNothing();
  await refreshProfile(row.actorId, row.createdAt);
  await progressQuests(row);
  return entries;
}

async function refMeta(f: ScoreFacts): Promise<{ eventId: string | null; divisionId: string | null }> {
  if (f.entityType === "task") {
    const [t] = await db.select({ eventId: tasks.eventId, divisionId: tasks.divisionId }).from(tasks).where(eq(tasks.id, f.entityId)).limit(1);
    return { eventId: t?.eventId ?? null, divisionId: t?.divisionId ?? null };
  }
  if (f.entityType === "handoff") {
    const [h] = await db.select({ eventId: handoffs.eventId, divisionId: handoffs.toDivisionId }).from(handoffs).where(eq(handoffs.id, f.entityId)).limit(1);
    return { eventId: h?.eventId ?? null, divisionId: h?.divisionId ?? null };
  }
  if (f.entityType === "approval") {
    const [a] = await db.select({ eventId: approvals.eventId, divisionId: approvals.divisionId }).from(approvals).where(eq(approvals.id, f.entityId)).limit(1);
    return { eventId: a?.eventId ?? null, divisionId: a?.divisionId ?? null };
  }
  return { eventId: null, divisionId: null };
}

/** Everything the pure scorer needs, read from the database as of now (plus the log for history). */
export async function gatherFacts(row: ActivityRowDb): Promise<ScoreFacts | null> {
  if (!row.actorId) return null;
  const { type, id } = entityOf(row.entity);
  const detail = (row.detail as Record<string, unknown> | null) ?? null;
  const today = await dayTotals(row.actorId, row.createdAt, row.id);
  const f: ScoreFacts = { action: row.action, actorId: row.actorId, at: row.createdAt, entityType: type, entityId: id, detail, today };

  if (type === "task" && id) {
    const [t] = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1);
    if (!t) return null;
    const [[cl], prev] = await Promise.all([
      db.select({ n: sql<number>`count(*)::int` }).from(taskChecklistItems).where(eq(taskChecklistItems.taskId, id)),
      db
        .select({ createdAt: activityLog.createdAt })
        .from(activityLog)
        .where(and(eq(activityLog.entity, row.entity), eq(activityLog.action, "task.status"), sql`${activityLog.detail}->>'to' = 'done'`, lt(activityLog.createdAt, row.createdAt)))
        .orderBy(desc(activityLog.createdAt))
        .limit(5),
    ]);
    f.task = {
      createdAt: t.createdAt,
      createdBy: t.createdBy ?? null,
      dueDate: t.dueDate,
      hasChecklist: (cl?.n ?? 0) > 0,
      hasDescription: t.description.trim().length >= 20,
      previousDoneAt: prev.map((p) => p.createdAt),
    };
    if (row.action === "task.status" && detail?.to === "done") {
      // dependency links carry no timestamp: the waiting task's own age is the proxy
      const waiters = await db
        .select({ createdAt: tasks.createdAt })
        .from(taskDependencies)
        .innerJoin(tasks, eq(taskDependencies.taskId, tasks.id))
        .where(and(eq(taskDependencies.dependsOnTaskId, id), notInArray(tasks.status, [...CLOSED])));
      const oldest = waiters.reduce((m, w) => Math.max(m, row.createdAt.getTime() - w.createdAt.getTime()), 0);
      f.waiters = { count: waiters.length, oldestAgeHours: oldest / 3600000 };
    }
    if (row.action === "comment.add") {
      const [m] = await db
        .select({ createdAt: comments.createdAt })
        .from(comments)
        .where(and(eq(comments.taskId, id), lt(comments.createdAt, row.createdAt), sql`${comments.mentions} @> ${JSON.stringify([row.actorId])}::jsonb`))
        .orderBy(desc(comments.createdAt))
        .limit(1);
      f.mentionedAt = m?.createdAt ?? null;
    }
    return f;
  }
  if (type === "handoff" && id) {
    const [h] = await db.select({ createdAt: handoffs.createdAt }).from(handoffs).where(eq(handoffs.id, id)).limit(1);
    if (!h) return null;
    f.handoff = { requestedAt: h.createdAt };
    return f;
  }
  if (type === "approval" && id) {
    // the step this actor decided: the most recent decided step on the approval at/before this row
    const [s] = await db
      .select({ decidedAt: approvalSteps.decidedAt })
      .from(approvalSteps)
      .where(and(eq(approvalSteps.approvalId, id), eq(approvalSteps.decidedBy, row.actorId)))
      .orderBy(desc(approvalSteps.decidedAt))
      .limit(1);
    const [a] = await db.select({ createdAt: approvals.createdAt }).from(approvals).where(eq(approvals.id, id)).limit(1);
    if (!a) return null;
    // steps carry no creation stamp: the request time is the best available "asked at"
    f.approval = { stepCreatedAt: a.createdAt };
    void s;
    return f;
  }
  if (type === "quest") return f;
  return null;
}

/** The user's ledger totals for the WIB day of `at`, excluding this activity (idempotent replays). */
async function dayTotals(userId: string, at: Date, excludeActivityId: string): Promise<ScoreFacts["today"]> {
  const day = wibDay(at);
  const rows = await db
    .select({ rule: playXpLedger.rule, points: playXpLedger.points, createdAt: playXpLedger.createdAt, activityId: playXpLedger.activityId })
    .from(playXpLedger)
    .where(and(eq(playXpLedger.userId, userId), eq(playXpLedger.day, day), lt(playXpLedger.createdAt, at)));
  const t = { total: 0, checklist: 0, mention: 0, completionsInWindow: 0 };
  for (const r of rows) {
    if (r.activityId === excludeActivityId) continue;
    t.total += r.points;
    if (r.rule === "checklist") t.checklist += r.points;
    if (r.rule === "mention_reply") t.mention += r.points;
  }
  const [[w]] = await Promise.all([
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(activityLog)
      .where(and(eq(activityLog.actorId, userId), eq(activityLog.action, "task.status"), sql`${activityLog.detail}->>'to' = 'done'`, gte(activityLog.createdAt, new Date(at.getTime() - 10 * 60000)), lt(activityLog.createdAt, at))),
  ]);
  t.completionsInWindow = w?.n ?? 0;
  return t;
}

// ---- profile, level-ups, badges ------------------------------------------------
export async function refreshProfile(userId: string, at = new Date()): Promise<{ xp: number; level: number; leveledUp: boolean }> {
  const [[sum], [prev]] = await Promise.all([
    db.select({ xp: sql<number>`coalesce(sum(${playXpLedger.points}), 0)::int` }).from(playXpLedger).where(eq(playXpLedger.userId, userId)),
    db.select({ level: playProfiles.level, cosmetics: playProfiles.cosmetics }).from(playProfiles).where(eq(playProfiles.userId, userId)).limit(1),
  ]);
  const xp = sum?.xp ?? 0;
  const level = levelFor(xp);
  const prevLevel = prev?.level ?? 0;
  const cosmetics = { ...cosmeticsForLevel(level), ...((prev?.cosmetics as Record<string, string> | null) ?? {}) };
  await db
    .insert(playProfiles)
    .values({ userId, xp, level, cosmetics, updatedAt: at })
    .onConflictDoUpdate({ target: playProfiles.userId, set: { xp, level, cosmetics, updatedAt: at } });
  const leveledUp = level > prevLevel;
  if (leveledUp) {
    await logActivity({ actorId: userId, action: "play.level_up", entity: `play:${userId}`, detail: { level, xp } });
  }
  await evaluateBadges(userId);
  return { xp, level, leveledUp };
}

export async function ensureBadgeCatalogue(): Promise<void> {
  await db
    .insert(playBadges)
    .values(BADGES.map((b) => ({ key: b.key, name: b.name, description: b.description, icon: b.icon, sortOrder: b.sortOrder })))
    .onConflictDoNothing();
}

export async function evaluateBadges(userId: string): Promise<string[]> {
  await ensureBadgeCatalogue();
  const ledger = await db.select({ rule: playXpLedger.rule, day: playXpLedger.day, ref: playXpLedger.ref, points: playXpLedger.points }).from(playXpLedger).where(eq(playXpLedger.userId, userId));
  const count = (rule: string) => ledger.filter((l) => l.rule === rule && l.points > 0).length;
  const [profile] = await db.select({ level: playProfiles.level }).from(playProfiles).where(eq(playProfiles.userId, userId)).limit(1);
  const earned: string[] = [];
  if (count("handoff_fast") >= 1) earned.push("first_handoff");
  if (count("unblock") >= 5) earned.push("unblocker_5");
  if (new Set(ledger.filter((l) => l.rule === "task_done_on_time").map((l) => l.day)).size >= 7) earned.push("on_time_7");
  if (count("approval_fast") >= 10) earned.push("approval_sprinter");
  if ((profile?.level ?? 0) >= 5) earned.push("level_5");
  // show-day hero: an on-time completion on the project's show day (WIB)
  const doneRefs = ledger.filter((l) => l.rule === "task_done_on_time" || l.rule === "task_done_late").map((l) => l.ref?.split(":")[1]).filter((x): x is string => !!x);
  if (doneRefs.length) {
    const rows = await db.select({ completedAt: tasks.completedAt, showDate: events.showDate }).from(tasks).innerJoin(events, eq(tasks.eventId, events.id)).where(inArray(tasks.id, doneRefs));
    if (rows.some((r) => r.completedAt && wibDay(r.completedAt) === wibDay(r.showDate))) earned.push("show_day_hero");
  }
  if (earned.length) {
    const inserted = await db
      .insert(playBadgeAwards)
      .values(earned.map((badgeKey) => ({ userId, badgeKey })))
      .onConflictDoNothing()
      .returning({ badgeKey: playBadgeAwards.badgeKey });
    for (const b of inserted) {
      await logActivity({ actorId: userId, action: "play.badge", entity: `play:${userId}`, detail: { badge: b.badgeKey } });
    }
    return inserted.map((b) => b.badgeKey);
  }
  return [];
}

// ---- recompute (the tripwire) ----------------------------------------------------
/** Replay a user's activity from scratch. Returns the drift against the incremental total. */
export async function recompute(userId: string): Promise<{ before: number; after: number; drift: number }> {
  const cfg = await getRules();
  const [[before]] = await Promise.all([
    db.select({ xp: sql<number>`coalesce(sum(${playXpLedger.points}), 0)::int` }).from(playXpLedger).where(eq(playXpLedger.userId, userId)),
  ]);
  await db.delete(playXpLedger).where(eq(playXpLedger.userId, userId));
  const rows = await db.select().from(activityLog).where(eq(activityLog.actorId, userId)).orderBy(asc(activityLog.createdAt));
  for (const row of rows) {
    if (!SCORED.test(row.action)) continue;
    await scoreRow(row, cfg);
  }
  const [after] = await db.select({ xp: sql<number>`coalesce(sum(${playXpLedger.points}), 0)::int` }).from(playXpLedger).where(eq(playXpLedger.userId, userId));
  await refreshProfile(userId);
  return { before: before?.xp ?? 0, after: after?.xp ?? 0, drift: (after?.xp ?? 0) - (before?.xp ?? 0) };
}

/** Nightly: recompute everyone who has a ledger; log drift. */
export async function nightlyDriftCheck(): Promise<{ users: number; drifted: number }> {
  const users = await db.selectDistinct({ userId: playXpLedger.userId }).from(playXpLedger);
  let drifted = 0;
  for (const u of users) {
    const r = await recompute(u.userId);
    if (r.drift !== 0) {
      drifted++;
      console.warn(`[play] XP drift for ${u.userId}: ${r.before} → ${r.after}`);
    }
  }
  return { users: users.length, drifted };
}

// ---- quests (T-262) — progress hook lives here so scoring and quests share one path ----
async function progressQuests(row: ActivityRowDb): Promise<void> {
  if (!row.actorId) return;
  const { type, id } = entityOf(row.entity);
  const day = wibDay(row.createdAt);
  const open = await db.select().from(playQuests).where(and(eq(playQuests.userId, row.actorId), eq(playQuests.day, day), sql`${playQuests.completedAt} is null`));
  for (const q of open) {
    const targets = (q.targetIds as string[]) ?? [];
    let hit = false;
    if (q.kind === "clear_overdue" || q.kind === "unblock") hit = type === "task" && row.action === "task.status" && (row.detail as { to?: string } | null)?.to === "done" && targets.includes(id);
    else if (q.kind === "decide") hit = (type === "handoff" || type === "approval") && /\.(accept|decline|approved|rejected|changes_requested)$/.test(row.action) && targets.includes(id);
    else if (q.kind === "refresh_stale") hit = type === "task" && targets.includes(id) && (row.action === "task.status" || row.action === "comment.add" || row.action === "task.checklist_done");
    if (!hit) continue;
    const progress = Math.min(q.targetCount, q.progress + 1);
    const done = progress >= q.targetCount;
    await db.update(playQuests).set({ progress, completedAt: done ? row.createdAt : null }).where(eq(playQuests.id, q.id));
    if (done) {
      // the quest completion is itself an activity row → scored (+15) through the normal path
      // (logActivity, not a raw insert, so the scoring hook fires)
      await logActivity({ actorId: row.actorId, action: "play.quest_complete", entity: `quest:${q.id}`, detail: { kind: q.kind, title: q.title } });
    }
  }
}

/** Members eligible for Play (active, internal). */
export async function playUserIds(): Promise<string[]> {
  const rows = await db.selectDistinct({ userId: divisionMembers.userId }).from(divisionMembers);
  return rows.map((r) => r.userId);
}
