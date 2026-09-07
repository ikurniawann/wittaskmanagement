import { describe, expect, it } from "vitest";
import { craneDist, easeInOutCubic, tourStops, yawDelta } from "./cinematic";
import { divisionColor, layout } from "../world/layout";
import type { PlayDivision } from "../types";

function divs(n: number): PlayDivision[] {
  return Array.from({ length: n }, (_, i) => {
    const ids = Array.from({ length: 3 + (i % 4) }, (_, k) => `u${i}-${k}`);
    return { id: `div-${i}`, name: `Division ${i}`, color: divisionColor(`div-${i}`), headId: ids[0], memberIds: ids };
  });
}

describe("cinematic camera (T-273)", () => {
  it("easing is monotonic, symmetric and clamped", () => {
    expect(easeInOutCubic(-1)).toBe(0);
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5);
    expect(easeInOutCubic(1)).toBe(1);
    expect(easeInOutCubic(2)).toBe(1);
    let prev = 0;
    for (let t = 0; t <= 1; t += 0.05) { const v = easeInOutCubic(t); expect(v).toBeGreaterThanOrEqual(prev); prev = v; }
    expect(easeInOutCubic(0.25) + easeInOutCubic(0.75)).toBeCloseTo(1);
  });
  it("crane rises mid-flight and lands exactly", () => {
    expect(craneDist(30, 60, 0, 0.3)).toBe(30);
    expect(craneDist(30, 60, 1, 0.3)).toBeCloseTo(60);
    expect(craneDist(30, 60, 0.5, 0.3)).toBeGreaterThan(45);
  });
  it("yawDelta takes the short way round", () => {
    expect(yawDelta(0, Math.PI / 2)).toBeCloseTo(Math.PI / 2);
    expect(yawDelta(0, Math.PI * 1.5)).toBeCloseTo(-Math.PI / 2);
    expect(yawDelta(Math.PI * 4, 0)).toBeCloseTo(0);
  });
  it("tour visits lobby, every room, approvals, then my desk", () => {
    const l = layout(divs(5));
    const stops = tourStops(l, "u2-1");
    expect(stops[0].kind).toBe("lobby");
    expect(stops.filter((s) => s.kind === "room").map((s) => s.divisionId).sort()).toEqual(l.rooms.map((r) => r.divisionId).sort());
    expect(stops[stops.length - 2].kind).toBe("approvals");
    expect(stops[stops.length - 1].kind).toBe("me");
    expect(stops.at(-1)!.hold).toBe(0);
    // no desk → ends in the lobby instead
    expect(tourStops(l, "nobody").at(-1)!.kind).toBe("lobby");
    expect(tourStops(l, "u2-1")).toEqual(stops);
  });
});
