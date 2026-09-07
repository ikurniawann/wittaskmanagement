import { describe, expect, it } from "vitest";
import { applyDiff, coalesce, entityOf, type ActivityRow } from "./diff";

const row = (action: string, entity: string, detail: Record<string, unknown> | null = null, actorId: string | null = "u1"): ActivityRow =>
  ({ id: "a", action, entity, detail, actorId, eventId: null, createdAt: "2026-09-07T00:00:00Z" });

describe("applyDiff() — every activity kind the services emit", () => {
  const cases: Array<[string, string, Record<string, unknown> | null, string[]]> = [
    ["task.status", "task:t1", { from: "todo", to: "in_progress" }, ["task:restack"]],
    ["task.status", "task:t1", { from: "todo", to: "blocked" }, ["task:restack", "bubble"]],
    ["task.status", "task:t1", { from: "in_review", to: "done" }, ["task:complete", "bubble"]],
    ["task.status", "task:t1", { to: "cancelled" }, ["task:complete"]],
    ["task.create", "task:t1", null, ["task:spawn"]],
    ["task.update", "task:t1", null, ["task:restack"]],
    ["task.assign", "task:t1", null, ["task:restack"]],
    ["task.lead_set", "task:t1", null, ["task:restack"]],
    ["task.lead_clear", "task:t1", null, ["task:restack"]],
    ["task.dependency_add", "task:t1", null, ["task:restack"]],
    ["task.dependency_remove", "task:t1", null, ["task:restack"]],
    ["task.external_dep_add", "task:t1", null, ["task:restack"]],
    ["task.external_dep_resolve", "task:t1", null, ["task:restack"]],
    ["task.external_dep_reopen", "task:t1", null, ["task:restack"]],
    ["task.external_dep_delete", "task:t1", null, ["task:restack"]],
    ["task.priority_auto_bump", "task:t1", null, ["task:restack"]],
    ["task.priority_auto_revert", "task:t1", null, ["task:restack"]],
    ["task.something_new", "task:t1", null, ["task:restack"]],
    ["handoff.request", "handoff:h1", null, ["handoffs", "bubble"]],
    ["handoff.accept", "handoff:h1", null, ["handoffs", "bubble"]],
    ["handoff.decline", "handoff:h1", null, ["handoffs", "bubble"]],
    ["approval.create", "approval:a1", null, ["approvals", "bubble"]],
    ["approval.approved", "approval:a1", null, ["approvals", "bubble"]],
    ["approval.rejected", "approval:a1", null, ["approvals", "bubble"]],
    ["approval.changes_requested", "approval:a1", null, ["approvals", "bubble"]],
    ["comment.add", "task:t1", { commentId: "c1", mentions: [] }, ["bubble"]],
    ["task.checklist_done", "task:t1", { itemId: "i1" }, ["task:restack"]],
    ["play.level_up", "play:u1", { level: 2, xp: 400 }, ["levelup"]],
    ["play.badge", "play:u1", { badge: "first_handoff" }, ["bubble"]],
    ["play.quest_complete", "quest:q1", { kind: "unblock" }, ["bubble"]],
    ["auth.signin", "profile:u1", null, []],
    ["play.session", "play:office", null, []],
    ["play.enable", "setting:play_enabled", null, []],
    ["user.create", "profile:u9", null, []],
  ];
  for (const [action, entity, detail, expected] of cases) {
    it(`${action} → ${expected.join(",") || "nothing"}`, () => {
      const got = applyDiff(row(action, entity, detail)).map((i) => (i.kind === "task" ? `task:${i.effect}` : i.kind));
      expect(got).toEqual(expected);
    });
  }
  it("never bubbles for system rows (actorId null)", () => {
    expect(applyDiff(row("task.status", "task:t1", { to: "done" }, null)).every((i) => i.kind !== "bubble")).toBe(true);
  });
  it("entityOf splits on the first colon only", () => {
    expect(entityOf("task:abc:def")).toEqual({ type: "task", id: "abc:def" });
    expect(entityOf("play")).toEqual({ type: "play", id: "" });
  });
});

describe("coalesce()", () => {
  it("keeps one intent per task, complete wins, lists deduped, bubbles capped", () => {
    const batch = [
      ...applyDiff(row("task.update", "task:t1")),
      ...applyDiff(row("task.status", "task:t1", { to: "done" })),
      ...applyDiff(row("task.assign", "task:t2")),
      ...applyDiff(row("handoff.request", "handoff:h1")),
      ...applyDiff(row("handoff.accept", "handoff:h2")),
      ...Array.from({ length: 10 }, () => applyDiff(row("approval.approved", "approval:a1"))).flat(),
    ];
    const out = coalesce(batch);
    const tasks = out.filter((i) => i.kind === "task");
    expect(tasks).toHaveLength(2);
    expect(tasks.find((i) => i.kind === "task" && i.id === "t1")).toMatchObject({ effect: "complete" });
    expect(out.filter((i) => i.kind === "handoffs")).toHaveLength(1);
    expect(out.filter((i) => i.kind === "approvals")).toHaveLength(1);
    expect(out.filter((i) => i.kind === "bubble").length).toBeLessThanOrEqual(6);
  });
});
