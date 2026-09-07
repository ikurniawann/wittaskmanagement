import { describe, expect, it } from "vitest";
import { divisionColor, layout, overlaps, reachable, type OfficeLayout } from "./layout";
import { blockFurniture, furnish, lanes } from "./furniture";
import type { PlayDivision } from "../types";

function divs(n: number, members = (i: number) => 3 + (i % 5)): PlayDivision[] {
  return Array.from({ length: n }, (_, i) => {
    const ids = Array.from({ length: members(i) }, (_, k) => `u${i}-${k}`);
    return { id: `div-${i}`, name: `Division ${i}`, color: divisionColor(`div-${i}`), headId: ids[0] ?? null, memberIds: ids };
  });
}

const cases: [string, OfficeLayout][] = [
  ["10 divisions", layout(divs(10))],
  ["2 divisions", layout(divs(2))],
  ["1 big division", layout(divs(1, () => 14))],
  ["7 uneven", layout(divs(7, (i) => 2 + (i * 5) % 9))],
];

describe("furnish (T-272)", () => {
  it("is deterministic", () => {
    const l = layout(divs(6));
    expect(JSON.stringify(furnish(l))).toBe(JSON.stringify(furnish(l)));
  });

  it.each(cases)("%s: furnishes the lobby with a lounge, coffee bar and services", (_, l) => {
    const kinds = [...new Set(furnish(l).map((p) => p.kind))];
    for (const k of ["sofa", "coffeeTable", "coffeeBar", "stool", "waterCooler", "printer", "plant"]) expect(kinds, `missing ${k}`).toContain(k);
  });

  it.each(cases)("%s: nothing sits on a walk lane or outside lobby/corridors, and nothing overlaps", (_, l) => {
    const ps = furnish(l);
    const L = lanes(l);
    const floors = [l.lobby, l.corridors[0], l.corridors[1]];
    for (const p of ps) {
      expect(L.some((x) => overlaps(x, p.foot))).toBe(false);
      expect(floors.some((f) => p.foot.x >= f.x - 1e-6 && p.foot.z >= f.z - 1e-6 && p.foot.x + p.foot.w <= f.x + f.w + 1e-6 && p.foot.z + p.foot.d <= f.z + f.d + 1e-6)).toBe(true);
    }
    const solid = ps.filter((p) => p.kind !== "rug");
    for (let i = 0; i < solid.length; i++) for (let j = i + 1; j < solid.length; j++) expect(overlaps(solid[i].foot, solid[j].foot)).toBe(false);
  });

  it.each(cases)("%s: every door still reaches every other door and every desk with furniture blocked", (_, l) => {
    const blocked: OfficeLayout = { ...l, walkable: blockFurniture(l, furnish(l)) };
    const doors = l.rooms.map((r) => r.door);
    for (const a of doors) for (const b of doors) expect(reachable(blocked, a, b)).toBe(true);
    for (const r of l.rooms) for (const d of r.desks) expect(reachable(blocked, l.approvalRoom.door, d)).toBe(true);
  });
});
