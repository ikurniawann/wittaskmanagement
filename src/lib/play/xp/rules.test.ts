import { describe, expect, it } from "vitest";
import { DEFAULT_RULES, endOfWibDay, foldTotals, levelFor, mergeRules, scoreActivity, wibDay, xpForLevel, type ScoreFacts } from "./rules";

const T0 = new Date("2026-09-07T03:00:00Z"); // 10:00 WIB
const h = (n: number) => new Date(T0.getTime() + n * 3600 * 1000);
const base = (over: Partial<ScoreFacts> = {}): ScoreFacts => ({
  action: "task.status",
  actorId: "u1",
  at: T0,
  entityType: "task",
  entityId: "t1",
  detail: { from: "in_progress", to: "done" },
  task: { createdAt: h(-48), createdBy: "u2", dueDate: h(24), hasChecklist: true, hasDescription: false, previousDoneAt: [] },
  today: { total: 0, checklist: 0, mention: 0, completionsInWindow: 0 },
  ...over,
});
const pts = (f: ScoreFacts) => scoreActivity(f).reduce((s, e) => s + e.points, 0);
const rules = (f: ScoreFacts) => scoreActivity(f).map((e) => e.rule);

describe("scoreActivity — PRD rule table", () => {
  it("task done on time → +10", () => { expect(rules(base())).toEqual(["task_done_on_time"]); expect(pts(base())).toBe(10); });
  it("task done late → +3", () => { const f = base({ task: { ...base().task!, dueDate: h(-30) } }); expect(rules(f)).toEqual(["task_done_late"]); expect(pts(f)).toBe(3); });
  it("no due date counts as on time", () => { expect(pts(base({ task: { ...base().task!, dueDate: null } }))).toBe(10); });
  it("due today (WIB) is still on time until midnight WIB", () => {
    const due = new Date("2026-09-06T17:00:00Z"); // 2026-09-07 00:00 WIB → due day is 07 Sep WIB
    expect(wibDay(due)).toBe("2026-09-07");
    expect(endOfWibDay(due)).toBe(Date.parse("2026-09-07T23:59:59.999+07:00"));
    expect(pts(base({ at: new Date("2026-09-07T16:30:00Z"), task: { ...base().task!, dueDate: due } }))).toBe(10);
  });
  it("unblocking N waiters (≥1 h old) → +5×N, max +30, on top of completion", () => {
    expect(pts(base({ waiters: { count: 2, oldestAgeHours: 3 } }))).toBe(20);
    expect(pts(base({ waiters: { count: 9, oldestAgeHours: 3 } }))).toBe(40);
    expect(pts(base({ waiters: { count: 2, oldestAgeHours: 0.5 } }))).toBe(10);
  });
  it("handoff decided within 24 h → +5, later → 0", () => {
    const f = base({ action: "handoff.accept", entityType: "handoff", entityId: "h1", detail: null, task: undefined, handoff: { requestedAt: h(-5) } });
    expect(pts(f)).toBe(5);
    expect(pts({ ...f, handoff: { requestedAt: h(-30) } })).toBe(0);
  });
  it("approval step decided within 24 h → +5", () => {
    const f = base({ action: "approval.approved", entityType: "approval", entityId: "a1", detail: null, task: undefined, approval: { stepCreatedAt: h(-2) } });
    expect(pts(f)).toBe(5);
    expect(pts({ ...f, action: "approval.changes_requested" })).toBe(5);
    expect(pts({ ...f, approval: { stepCreatedAt: h(-25) } })).toBe(0);
  });
  it("checklist item → +1, max +10/day", () => {
    const f = base({ action: "task.checklist_done", detail: null });
    expect(pts(f)).toBe(1);
    expect(pts({ ...f, today: { ...f.today, checklist: 10 } })).toBe(0);
  });
  it("reply to an @mention within 4 h → +2, max +10/day", () => {
    const f = base({ action: "comment.add", detail: null, mentionedAt: h(-1) });
    expect(pts(f)).toBe(2);
    expect(pts({ ...f, mentionedAt: h(-6) })).toBe(0);
    expect(pts({ ...f, mentionedAt: null })).toBe(0);
    expect(pts({ ...f, today: { ...f.today, mention: 10 } })).toBe(0);
  });
  it("quest complete → +15", () => { expect(pts(base({ action: "play.quest_complete", entityType: "quest", entityId: "q1", detail: null, task: undefined }))).toBe(15); });
  it("daily cap 100 clips in order", () => {
    const f = base({ waiters: { count: 6, oldestAgeHours: 3 }, today: { total: 90, checklist: 0, mention: 0, completionsInWindow: 0 } });
    const es = scoreActivity(f);
    expect(es.reduce((s, e) => s + e.points, 0)).toBe(10);
    expect(es[1].reason).toBe("daily_cap");
  });
  it("unrelated actions score nothing", () => {
    expect(scoreActivity(base({ action: "auth.signin", entityType: "profile", entityId: "u1", detail: null, task: undefined }))).toEqual([]);
    expect(scoreActivity(base({ detail: { to: "in_review" } }))).toEqual([]);
  });
});

describe("T-266 anti-gaming guards (each documented exploit scores 0 and is flagged)", () => {
  it("reopen → close again within 7 days", () => {
    const es = scoreActivity(base({ task: { ...base().task!, previousDoneAt: [h(-24)] } }));
    expect(es).toHaveLength(1);
    expect(es[0]).toMatchObject({ points: 0, flagged: true, reason: "reopen_cooldown" });
    expect(pts(base({ task: { ...base().task!, previousDoneAt: [h(-24 * 8)] } }))).toBe(10);
  });
  it("task created and done within 5 min by the same person", () => {
    const es = scoreActivity(base({ task: { ...base().task!, createdAt: h(-0.05), createdBy: "u1" } }));
    expect(es[0]).toMatchObject({ points: 0, flagged: true, reason: "self_task_5min" });
    // someone else's 3-minute task is merely trivial (no checklist/description guard applies)
    expect(scoreActivity(base({ task: { ...base().task!, createdAt: h(-0.05), createdBy: "u2" } }))[0].reason).toBe("trivial_task");
  });
  it("bulk status flips beyond the window limit", () => {
    const es = scoreActivity(base({ today: { total: 0, checklist: 0, mention: 0, completionsInWindow: 10 } }));
    expect(es[0]).toMatchObject({ points: 0, flagged: true, reason: "bulk_flips" });
  });
  it("empty task younger than 30 min scores 0 (trivial) but still unblocks", () => {
    const es = scoreActivity(base({ task: { ...base().task!, createdAt: h(-0.2), hasChecklist: false, hasDescription: false }, waiters: { count: 1, oldestAgeHours: 2 } }));
    expect(es.map((e) => [e.rule, e.points])).toEqual([["flag:trivial_task", 0], ["unblock", 5]]);
  });
});

describe("levels, config, totals", () => {
  it("level curve is 100 × level²", () => {
    expect(levelFor(0)).toBe(0); expect(levelFor(99)).toBe(0); expect(levelFor(100)).toBe(1); expect(levelFor(399)).toBe(1); expect(levelFor(400)).toBe(2); expect(levelFor(2500)).toBe(5);
    expect(xpForLevel(3)).toBe(900);
  });
  it("mergeRules keeps defaults for missing/invalid keys and applies valid overrides", () => {
    const m = mergeRules({ points: { quest: 30, task_done_on_time: -4, bogus: 9 }, caps: { daily: "x" }, guards: { fastHours: 12 } });
    expect(m.points.quest).toBe(30);
    expect(m.points.task_done_on_time).toBe(DEFAULT_RULES.points.task_done_on_time);
    expect(m.caps.daily).toBe(100);
    expect(m.guards.fastHours).toBe(12);
    expect(mergeRules(null)).toEqual(DEFAULT_RULES);
  });
  it("foldTotals accumulates the buckets the caps read", () => {
    const t = foldTotals({ total: 0, checklist: 0, mention: 0, completionsInWindow: 0 }, [{ rule: "checklist", points: 1, ref: "x", flagged: false, reason: null }, { rule: "task_done_on_time", points: 10, ref: "x", flagged: false, reason: null }], true);
    expect(t).toEqual({ total: 11, checklist: 1, mention: 0, completionsInWindow: 1 });
  });
});

describe("property: recompute from the stream equals the incremental total", () => {
  it("holds for a generated week of activity", () => {
    // deterministic pseudo-random stream
    let seed = 7;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const stream: ScoreFacts[] = [];
    let at = new Date("2026-09-01T01:00:00Z");
    const doneAt = new Map<string, Date[]>();
    for (let i = 0; i < 400; i++) {
      at = new Date(at.getTime() + Math.floor(rnd() * 90) * 60000);
      const kind = rnd();
      const taskId = "t" + Math.floor(rnd() * 40);
      if (kind < 0.55) {
        const prev = doneAt.get(taskId) ?? [];
        stream.push({ action: "task.status", actorId: "u1", at, entityType: "task", entityId: taskId, detail: { to: "done" },
          task: { createdAt: new Date(at.getTime() - Math.floor(rnd() * 72) * 3600000), createdBy: rnd() < 0.2 ? "u1" : "u2", dueDate: rnd() < 0.3 ? null : new Date(at.getTime() + (rnd() - 0.4) * 96 * 3600000), hasChecklist: rnd() < 0.6, hasDescription: rnd() < 0.5, previousDoneAt: [...prev].reverse() },
          waiters: rnd() < 0.3 ? { count: 1 + Math.floor(rnd() * 8), oldestAgeHours: rnd() * 5 } : undefined,
          today: { total: 0, checklist: 0, mention: 0, completionsInWindow: 0 } });
        doneAt.set(taskId, [...prev, at]);
      } else if (kind < 0.7) stream.push({ action: "task.checklist_done", actorId: "u1", at, entityType: "task", entityId: taskId, detail: null, today: { total: 0, checklist: 0, mention: 0, completionsInWindow: 0 } });
      else if (kind < 0.85) stream.push({ action: "comment.add", actorId: "u1", at, entityType: "task", entityId: taskId, detail: null, mentionedAt: rnd() < 0.5 ? new Date(at.getTime() - rnd() * 6 * 3600000) : null, today: { total: 0, checklist: 0, mention: 0, completionsInWindow: 0 } });
      else stream.push({ action: "handoff.accept", actorId: "u1", at, entityType: "handoff", entityId: "h" + i, detail: null, handoff: { requestedAt: new Date(at.getTime() - rnd() * 40 * 3600000) }, today: { total: 0, checklist: 0, mention: 0, completionsInWindow: 0 } });
    }
    // "incremental": score as rows arrive, folding day totals
    const run = (rows: ScoreFacts[]) => {
      let day = "", totals = { total: 0, checklist: 0, mention: 0, completionsInWindow: 0 };
      const window: Date[] = [];
      let sum = 0, flagged = 0;
      for (const r of rows) {
        const d = wibDay(r.at);
        if (d !== day) { day = d; totals = { total: 0, checklist: 0, mention: 0, completionsInWindow: 0 }; }
        while (window.length && r.at.getTime() - window[0].getTime() > 10 * 60000) window.shift();
        const isCompletion = r.action === "task.status";
        const es = scoreActivity({ ...r, today: { ...totals, completionsInWindow: window.length } });
        sum += es.reduce((s, e) => s + e.points, 0);
        flagged += es.filter((e) => e.flagged).length;
        totals = foldTotals(totals, es, false);
        if (isCompletion) window.push(r.at);
      }
      return { sum, flagged };
    };
    const a = run(stream);
    const b = run(stream); // "recompute" = the same stream replayed from scratch
    expect(b).toEqual(a);
    expect(a.sum).toBeGreaterThan(0);
    expect(a.flagged).toBeGreaterThan(0);
    // and never above the daily cap on any day
    const byDay = new Map<string, number>();
    let day = "", totals = { total: 0, checklist: 0, mention: 0, completionsInWindow: 0 };
    for (const r of stream) {
      const d = wibDay(r.at);
      if (d !== day) { day = d; totals = { total: 0, checklist: 0, mention: 0, completionsInWindow: 0 }; }
      const es = scoreActivity({ ...r, today: totals });
      totals = foldTotals(totals, es, r.action === "task.status");
      byDay.set(d, totals.total);
    }
    for (const v of byDay.values()) expect(v).toBeLessThanOrEqual(DEFAULT_RULES.caps.daily);
  });
});
