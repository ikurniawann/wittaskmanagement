// EPIC-026 T-261 / T-266 — the XP rule table and the pure scorer.
//
// Every number here comes from PRD-GAME.md "Gamification rules — authoritative".
// The scorer is a pure function of (facts, config): the same activity row with
// the same facts always yields the same ledger entries, which is what makes a
// full recompute from activity_log equal the incremental total.

export type RuleKey =
  | "task_done_on_time"
  | "task_done_late"
  | "unblock"
  | "handoff_fast"
  | "approval_fast"
  | "checklist"
  | "mention_reply"
  | "quest";

export type RulesConfig = {
  points: Record<RuleKey, number>;
  caps: { daily: number; checklistDaily: number; mentionDaily: number; unblockMax: number };
  guards: { minTaskAgeMin: number; waiterMinAgeHours: number; reopenCooldownDays: number; selfTaskMin: number; bulkFlips: number; bulkWindowMin: number; fastHours: number; mentionReplyHours: number };
};

export const DEFAULT_RULES: RulesConfig = {
  points: { task_done_on_time: 10, task_done_late: 3, unblock: 5, handoff_fast: 5, approval_fast: 5, checklist: 1, mention_reply: 2, quest: 15 },
  caps: { daily: 100, checklistDaily: 10, mentionDaily: 10, unblockMax: 30 },
  guards: { minTaskAgeMin: 30, waiterMinAgeHours: 1, reopenCooldownDays: 7, selfTaskMin: 5, bulkFlips: 10, bulkWindowMin: 10, fastHours: 24, mentionReplyHours: 4 },
};

/** Merge Owner overrides (T-265) over the defaults; unknown keys are ignored, NaN falls back. */
export function mergeRules(overrides: unknown): RulesConfig {
  const o = (overrides && typeof overrides === "object" ? overrides : {}) as Partial<{ points: Partial<Record<RuleKey, unknown>>; caps: Partial<Record<keyof RulesConfig["caps"], unknown>>; guards: Partial<Record<keyof RulesConfig["guards"], unknown>> }>;
  const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : d);
  const points = { ...DEFAULT_RULES.points };
  for (const k of Object.keys(points) as RuleKey[]) points[k] = num(o.points?.[k], points[k]);
  const caps = { ...DEFAULT_RULES.caps };
  for (const k of Object.keys(caps) as (keyof RulesConfig["caps"])[]) caps[k] = num(o.caps?.[k], caps[k]);
  const guards = { ...DEFAULT_RULES.guards };
  for (const k of Object.keys(guards) as (keyof RulesConfig["guards"])[]) guards[k] = num(o.guards?.[k], guards[k]);
  return { points, caps, guards };
}

/** Level curve: 100 × level² cumulative XP. */
export function levelFor(xp: number): number {
  return xp <= 0 ? 0 : Math.floor(Math.sqrt(xp / 100));
}
export function xpForLevel(level: number): number {
  return 100 * level * level;
}

/** WIB (UTC+7) calendar day, "YYYY-MM-DD". Daily caps and quests use this. */
export function wibDay(d: Date): string {
  return new Date(d.getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10);
}

export type ScoreFacts = {
  action: string;
  actorId: string;
  at: Date;
  entityType: string;
  entityId: string;
  detail: Record<string, unknown> | null;
  task?: {
    createdAt: Date;
    createdBy: string | null;
    dueDate: Date | null;
    hasChecklist: boolean;
    hasDescription: boolean;
    /** previous completions of this task by anyone, most recent first */
    previousDoneAt: Date[];
  };
  /** open tasks waiting on this one at completion time */
  waiters?: { count: number; oldestAgeHours: number };
  handoff?: { requestedAt: Date };
  approval?: { stepCreatedAt: Date };
  /** for a comment: when the actor was last @mentioned on this task before this comment */
  mentionedAt?: Date | null;
  /** the user's ledger totals for the WIB day of `at`, BEFORE this row */
  today: { total: number; checklist: number; mention: number; completionsInWindow: number };
};

export type LedgerEntry = {
  rule: RuleKey | `flag:${string}`;
  points: number;
  ref: string;
  flagged: boolean;
  reason: string | null;
};

const H = 3600 * 1000;

/** Pure scorer. Returns zero or more entries for one activity row; never mutates `facts`. */
export function scoreActivity(f: ScoreFacts, cfg: RulesConfig = DEFAULT_RULES): LedgerEntry[] {
  const out: LedgerEntry[] = [];
  const ref = `${f.entityType}:${f.entityId}`;
  const add = (rule: RuleKey, points: number) => out.push({ rule, points, ref, flagged: false, reason: null });
  const flag = (reason: string) => out.push({ rule: `flag:${reason}`, points: 0, ref, flagged: true, reason });

  if (f.entityType === "task" && f.action === "task.status" && f.detail?.to === "done" && f.task) {
    const t = f.task;
    const ageMin = (f.at.getTime() - t.createdAt.getTime()) / 60000;
    if (t.createdBy === f.actorId && ageMin < cfg.guards.selfTaskMin) { flag("self_task_5min"); return capDaily(out, f, cfg); }
    const lastDone = t.previousDoneAt[0];
    if (lastDone && f.at.getTime() - lastDone.getTime() < cfg.guards.reopenCooldownDays * 24 * H) { flag("reopen_cooldown"); return capDaily(out, f, cfg); }
    if (f.today.completionsInWindow >= cfg.guards.bulkFlips) { flag("bulk_flips"); return capDaily(out, f, cfg); }
    const substantive = ageMin >= cfg.guards.minTaskAgeMin && (t.hasChecklist || t.hasDescription);
    if (substantive) {
      const onTime = !t.dueDate || f.at.getTime() <= endOfWibDay(t.dueDate);
      add(onTime ? "task_done_on_time" : "task_done_late", onTime ? cfg.points.task_done_on_time : cfg.points.task_done_late);
    } else {
      flag("trivial_task");
    }
    if (f.waiters && f.waiters.count > 0 && f.waiters.oldestAgeHours >= cfg.guards.waiterMinAgeHours) {
      add("unblock", Math.min(cfg.caps.unblockMax, cfg.points.unblock * f.waiters.count));
    }
    return capDaily(out, f, cfg);
  }

  if (f.entityType === "handoff" && (f.action === "handoff.accept" || f.action === "handoff.decline") && f.handoff) {
    if (f.at.getTime() - f.handoff.requestedAt.getTime() <= cfg.guards.fastHours * H) add("handoff_fast", cfg.points.handoff_fast);
    return capDaily(out, f, cfg);
  }

  if (f.entityType === "approval" && /^approval\.(approved|rejected|changes_requested)$/.test(f.action) && f.approval) {
    if (f.at.getTime() - f.approval.stepCreatedAt.getTime() <= cfg.guards.fastHours * H) add("approval_fast", cfg.points.approval_fast);
    return capDaily(out, f, cfg);
  }

  if (f.entityType === "task" && f.action === "task.checklist_done") {
    if (f.today.checklist < cfg.caps.checklistDaily) add("checklist", Math.min(cfg.points.checklist, cfg.caps.checklistDaily - f.today.checklist));
    return capDaily(out, f, cfg);
  }

  if (f.entityType === "task" && f.action === "comment.add") {
    if (f.mentionedAt && f.at.getTime() - f.mentionedAt.getTime() <= cfg.guards.mentionReplyHours * H && f.today.mention < cfg.caps.mentionDaily) {
      add("mention_reply", Math.min(cfg.points.mention_reply, cfg.caps.mentionDaily - f.today.mention));
    }
    return capDaily(out, f, cfg);
  }

  if (f.entityType === "quest" && f.action === "play.quest_complete") {
    add("quest", cfg.points.quest);
    return capDaily(out, f, cfg);
  }

  return out; // not a scored action
}

/** Daily cap: entries are clipped in order so the day never exceeds cfg.caps.daily. */
function capDaily(entries: LedgerEntry[], f: ScoreFacts, cfg: RulesConfig): LedgerEntry[] {
  let room = Math.max(0, cfg.caps.daily - f.today.total);
  for (const e of entries) {
    if (e.flagged) continue;
    const p = Math.min(e.points, room);
    room -= p;
    if (p < e.points) e.reason = e.reason ?? "daily_cap";
    e.points = p;
  }
  return entries;
}

/** A due date counts as met until the end of that WIB day. */
export function endOfWibDay(due: Date): number {
  const day = wibDay(due);
  return Date.parse(`${day}T23:59:59.999+07:00`);
}

/** Which rule buckets an entry affects for the day totals (used by incremental + recompute alike). */
export function foldTotals(today: ScoreFacts["today"], entries: LedgerEntry[], isCompletion: boolean): ScoreFacts["today"] {
  const next = { ...today };
  for (const e of entries) {
    next.total += e.points;
    if (e.rule === "checklist") next.checklist += e.points;
    if (e.rule === "mention_reply") next.mention += e.points;
  }
  if (isCompletion) next.completionsInWindow += 1;
  return next;
}
