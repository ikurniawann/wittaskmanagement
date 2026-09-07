import { describe, expect, it } from "vitest";
import { divisionColor, hashId, layout, overlaps, reachable } from "./layout";
import { amountTier, ENVELOPE_SCALE, GHOST_CAP, mapTask, personClip, STATUS_COLOUR } from "./mapping";
import type { PlayDivision, PlayTask } from "../types";

function divs(n: number, members = (i: number) => 3 + (i % 5)): PlayDivision[] {
  return Array.from({ length: n }, (_, i) => {
    const ids = Array.from({ length: members(i) }, (_, k) => `u${i}-${k}`);
    return { id: `div-${i}`, name: `Division ${i}`, color: divisionColor(`div-${i}`), headId: ids[0] ?? null, memberIds: ids };
  });
}

describe("layout()", () => {
  it("is deterministic", () => {
    const a = layout(divs(11)), b = layout(divs(11));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
  it("is stable when a member count changes but the division set does not", () => {
    const a = layout(divs(6));
    const b = layout(divs(6, (i) => 3 + (i % 5) + (i === 2 ? 1 : 0)));
    expect(a.rooms.map((r) => r.divisionId)).toEqual(b.rooms.map((r) => r.divisionId));
    expect(a.rooms.map((r) => r.side)).toEqual(b.rooms.map((r) => r.side));
  });
  for (const n of [1, 3, 11, 25]) {
    it(`fits ${n} divisions with no overlapping rectangles`, () => {
      const l = layout(divs(n));
      const rects = [l.lobby, l.approvalRoom, ...l.rooms.map((r) => r.rect)];
      for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) expect(overlaps(rects[i], rects[j]), `${i} vs ${j}`).toBe(false);
      expect(l.rooms.length).toBe(n);
    });
    it(`every desk of ${n} divisions can reach the lobby`, () => {
      const l = layout(divs(n));
      const lobbyCentre = { x: l.lobby.x + l.lobby.w / 2, z: l.lobby.z + l.lobby.d / 2 };
      for (const r of l.rooms) for (const d of r.desks) expect(reachable(l, d, lobbyCentre), `${r.divisionId}`).toBe(true);
      expect(reachable(l, { x: l.approvalRoom.x + 2, z: l.approvalRoom.z + 2 }, lobbyCentre)).toBe(true);
    });
  }
  it("seats every member, head first, with at least 4 desks per room", () => {
    const l = layout(divs(5));
    for (const r of l.rooms) {
      expect(r.desks.length).toBeGreaterThanOrEqual(4);
      const seated = r.desks.filter((d) => d.personId).map((d) => d.personId);
      expect(new Set(seated).size).toBe(seated.length);
      expect(r.desks[0].isHead).toBe(true);
    }
  });
  it("hashId and divisionColor are stable", () => {
    expect(hashId("talent")).toBe(hashId("talent"));
    expect(divisionColor("talent")).toMatch(/^#[0-9A-F]{6}$/);
    expect(divisionColor("talent")).not.toBe(divisionColor("finance"));
  });
});

const base: PlayTask = {
  id: "t1", title: "x", status: "todo", priority: "medium", divisionId: "d1", eventId: "e1", assigneeIds: ["u1"], leadId: "u2",
  dueDate: null, overdue: false, checklistTotal: 0, checklistDone: 0, waiters: 0, critical: false,
};

describe("mapTask()", () => {
  const statuses: PlayTask["status"][] = ["backlog", "todo", "in_progress", "in_review", "blocked", "done", "cancelled"];
  for (const status of statuses) for (const overdue of [false, true]) for (const waiters of [0, 2, 9]) for (const critical of [false, true]) {
    it(`${status} overdue=${overdue} waiters=${waiters} critical=${critical}`, () => {
      const v = mapTask({ ...base, status, overdue, waiters, critical });
      const hidden = status === "done" || status === "cancelled";
      expect(v.visible).toBe(!hidden);
      expect(v.colour).toBe(STATUS_COLOUR[status]);
      expect(v.smoke).toBe(!hidden && overdue);
      expect(v.chain).toBe(!hidden && status === "blocked");
      expect(v.aura).toBe(!hidden && critical);
      expect(v.urgentSign).toBe(!hidden && critical);
      expect(v.ghosts).toBe(hidden ? 0 : Math.min(GHOST_CAP, waiters));
      expect(v.overflow).toBe(!hidden && waiters > GHOST_CAP ? `+${waiters - GHOST_CAP}` : null);
      if (!hidden) expect(v.ownerClip).toBe(critical || (overdue && status === "blocked") ? "panic" : status === "in_progress" ? "work" : "idle");
    });
  }
  it("falls back assignee → lead → whiteboard", () => {
    expect(mapTask(base).target).toEqual({ kind: "person", personId: "u1" });
    expect(mapTask({ ...base, assigneeIds: [] }).target).toEqual({ kind: "person", personId: "u2" });
    expect(mapTask({ ...base, assigneeIds: [], leadId: null }).target).toEqual({ kind: "whiteboard", divisionId: "d1" });
  });
  it("buckets stack height by checklist size", () => {
    expect(mapTask({ ...base, checklistTotal: 0 }).stackHeight).toBe(1);
    expect(mapTask({ ...base, checklistTotal: 3 }).stackHeight).toBe(2);
    expect(mapTask({ ...base, checklistTotal: 8 }).stackHeight).toBe(3);
  });
  it("personClip prefers panic over work over idle", () => {
    const idle = mapTask(base), work = mapTask({ ...base, status: "in_progress" }), panic = mapTask({ ...base, critical: true });
    expect(personClip([idle])).toBe("idle");
    expect(personClip([idle, work])).toBe("work");
    expect(personClip([work, panic, idle])).toBe("panic");
    expect(personClip([mapTask({ ...base, status: "done", critical: true })])).toBe("idle");
  });
  it("amountTier follows the approval thresholds and grows the envelope", () => {
    const t = { a: 10_000_000, b: 100_000_000 };
    expect(amountTier(null, t)).toBe(0);
    expect(amountTier(0, t)).toBe(0);
    expect(amountTier(10_000_000, t)).toBe(0);
    expect(amountTier(10_000_001, t)).toBe(1);
    expect(amountTier(100_000_000, t)).toBe(1);
    expect(amountTier(100_000_001, t)).toBe(2);
    expect(ENVELOPE_SCALE[0]).toBeLessThan(ENVELOPE_SCALE[1]);
    expect(ENVELOPE_SCALE[1]).toBeLessThan(ENVELOPE_SCALE[2]);
  });
});
