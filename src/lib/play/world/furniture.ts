import { CORRIDOR_W, overlaps, type OfficeLayout, type Rect } from "./layout";

/**
 * EPIC-027 T-272 — furniture for the lobby and corridors. Pure and deterministic:
 * the same layout always yields the same placements, and nothing is ever put on
 * a walk lane, so couriers (T-252) never clip through a sofa.
 *
 * Walk lanes are: every room door's vertical lane (door x ± LANE_HALF, from the
 * north corridor down to the south corridor — couriers cross the lobby there),
 * each corridor's centre band, the strip in front of the approval-room door and
 * the event-board strip on the lobby's west wall.
 */
export type FurnitureKind =
  | "sofa" | "armchair" | "coffeeTable" | "rug" | "floorLamp"
  | "coffeeBar" | "stool" | "highTable"
  | "waterCooler" | "printer" | "bookshelf" | "bin" | "plant";

export type Placement = {
  kind: FurnitureKind;
  x: number;
  z: number;
  /** Rotation about Y (radians); kinds face +Z at ry = 0. */
  ry: number;
  /** Axis-aligned footprint used for lane checks and the walkable grid. */
  foot: Rect;
};

export const LANE_HALF = 1.3;
export const BOARD_STRIP_W = 3.4;

/** Footprint rect of size w×d centred on (x, z) — after a 90° turn the axes swap. */
export function footprint(x: number, z: number, w: number, d: number, ry: number): Rect {
  const turned = Math.abs(Math.sin(ry)) > 0.5;
  const fw = turned ? d : w, fd = turned ? w : d;
  return { x: x - fw / 2, z: z - fd / 2, w: fw, d: fd };
}

export function lanes(l: OfficeLayout): Rect[] {
  const [north, south] = l.corridors;
  const top = north.z, bottom = south.z + south.d;
  const out: Rect[] = [];
  for (const r of l.rooms) out.push({ x: r.door.x - LANE_HALF, z: top, w: LANE_HALF * 2, d: bottom - top });
  for (const c of l.corridors.slice(0, 2)) out.push({ x: c.x, z: c.z + c.d / 2 - 1.1, w: c.w, d: 2.2 });
  // approval door: a straight band from the lobby into the connecting corridor
  const a = l.approvalRoom.door;
  out.push({ x: l.lobby.x + l.lobby.w - 4, z: a.z - 2, w: 4 + (l.approvalRoom.x - (l.lobby.x + l.lobby.w)), d: 4 });
  out.push({ x: l.lobby.x, z: l.lobby.z, w: BOARD_STRIP_W, d: l.lobby.d });
  // couriers without a destination room wait on the lobby's east side: keep that column clear
  out.push({ x: l.lobby.x + l.lobby.w - 2 - LANE_HALF, z: top, w: LANE_HALF * 2, d: bottom - top });
  return out;
}

function inside(inner: Rect, outer: Rect): boolean {
  return inner.x >= outer.x - 1e-6 && inner.z >= outer.z - 1e-6 && inner.x + inner.w <= outer.x + outer.w + 1e-6 && inner.z + inner.d <= outer.z + outer.d + 1e-6;
}

export function furnish(l: OfficeLayout): Placement[] {
  const L = lanes(l);
  const floors = [l.lobby, ...l.corridors.slice(0, 2)];
  const out: Placement[] = [];
  const taken: Rect[] = [];
  const free = (r: Rect) => floors.some((f) => inside(r, f)) && !L.some((x) => overlaps(x, r)) && !taken.some((x) => overlaps(x, r));
  const put = (kind: FurnitureKind, x: number, z: number, w: number, d: number, ry = 0): boolean => {
    const foot = footprint(x, z, w, d, ry);
    if (!free(foot)) return false;
    out.push({ kind, x, z, ry, foot });
    taken.push(foot);
    return true;
  };
  /** First x (scanning from `from` outward in 0.5 m steps) where a w×d block centred at (x, z) is free. */
  const findX = (z: number, w: number, d: number, from: number, dir: 1 | -1 | 0 = 0): number | null => {
    for (let k = 0; k < 80; k++) {
      const cands = dir === 0 ? [from + k * 0.5, from - k * 0.5] : [from + dir * k * 0.5];
      for (const x of cands) if (free(footprint(x, z, w, d, 0))) return x;
    }
    return null;
  };

  const lobby = l.lobby;
  const cz = lobby.z + lobby.d / 2;

  // 1. lounge island in the middle of the lobby (falls back to a smaller set if lanes are tight)
  const big = findX(cz, 7.6, 5.6, lobby.x + lobby.w / 2);
  const cx = big ?? findX(cz, 5.4, 4.6, lobby.x + lobby.w / 2);
  if (cx != null) {
    const wide = big != null;
    put("rug", cx, cz, wide ? 7.6 : 5.4, wide ? 5.6 : 4.6);
    taken.pop(); // the rug is flat: furniture may sit on it
    put("coffeeTable", cx, cz, 1.4, 0.8);
    put("sofa", cx, cz - 1.75, 2.4, 1.0, 0);
    put("sofa", cx, cz + 1.75, 2.4, 1.0, Math.PI);
    if (wide) {
      put("armchair", cx - 2.9, cz, 1.0, 1.0, Math.PI / 2);
      put("armchair", cx + 2.9, cz, 1.0, 1.0, -Math.PI / 2);
      put("floorLamp", cx + 3.2, cz - 2.3, 0.5, 0.5);
    }
  }

  // 2. coffee bar along the lobby's north edge: counter + machine, stools in front, a high table beside it
  const barZ = lobby.z + 1.9;
  const barX = findX(barZ, 5.0, 3.6, lobby.x + lobby.w * 0.72, -1);
  if (barX != null) {
    put("coffeeBar", barX, barZ, 3.6, 1.2);
    for (const dx of [-1.1, 0, 1.1]) put("stool", barX + dx, barZ + 1.3, 0.5, 0.5);
    put("bin", barX + 2.15, barZ, 0.5, 0.5);
    const htX = findX(barZ + 0.4, 1.6, 1.6, barX - 3.6, -1);
    if (htX != null) put("highTable", htX, barZ + 0.4, 1.2, 1.2);
  }

  // 3. printer corner + water cooler along the south edge, bookshelf further west
  const svcZ = lobby.z + lobby.d - 1.3;
  const svcX = findX(svcZ, 4.2, 1.8, lobby.x + lobby.w * 0.72, -1);
  if (svcX != null) {
    put("printer", svcX - 1.3, svcZ, 1.1, 0.8, Math.PI);
    put("waterCooler", svcX + 0.2, svcZ, 0.5, 0.5);
    put("bin", svcX + 1.0, svcZ, 0.5, 0.5);
  }
  const shelfX = findX(svcZ, 3.0, 1.0, (svcX ?? lobby.x + lobby.w * 0.6) - 5.0, -1);
  if (shelfX != null) put("bookshelf", shelfX, svcZ + 0.3, 2.4, 0.5, Math.PI);

  // 4. plants: corridor wall side between doors, and the lobby's east corners
  const [north, south] = l.corridors;
  const doorsN = l.rooms.filter((r) => r.side === -1).map((r) => r.door.x).sort((a, b) => a - b);
  const doorsS = l.rooms.filter((r) => r.side === 1).map((r) => r.door.x).sort((a, b) => a - b);
  const between = (xs: number[]) => xs.slice(1).map((x, i) => (xs[i] + x) / 2);
  // corridors are 4 m with a 2.2 m centre band, so a plant hugs the room wall (0.8 m footprint at 0.45 m)
  for (const x of [north.x + 0.7, ...between(doorsN)]) put("plant", x, north.z + 0.45, 0.8, 0.8);
  for (const x of [south.x + 0.7, ...between(doorsS)]) put("plant", x, south.z + south.d - 0.45, 0.8, 0.8);
  put("plant", lobby.x + BOARD_STRIP_W + 0.6, lobby.z + 0.8, 0.9, 0.9);
  put("plant", lobby.x + BOARD_STRIP_W + 0.6, lobby.z + lobby.d - 0.8, 0.9, 0.9);

  return out;
}

/** A copy of the layout's walkable grid with every furniture footprint (rugs excluded) blocked. */
export function blockFurniture(l: OfficeLayout, placements: readonly Placement[]): boolean[][] {
  const grid = l.walkable.map((row) => row.slice());
  const gw = grid[0]?.length ?? 0, gd = grid.length;
  for (const p of placements) {
    if (p.kind === "rug") continue;
    const r = p.foot;
    const x0 = Math.floor((r.x - l.bounds.x) / l.cell), z0 = Math.floor((r.z - l.bounds.z) / l.cell);
    const x1 = Math.ceil((r.x + r.w - l.bounds.x) / l.cell), z1 = Math.ceil((r.z + r.d - l.bounds.z) / l.cell);
    for (let z = Math.max(0, z0); z < Math.min(gd, z1); z++) for (let x = Math.max(0, x0); x < Math.min(gw, x1); x++) grid[z][x] = false;
  }
  return grid;
}

/** Corridor centre z for a side, shared with the courier path so lanes and paths agree. */
export function corridorCentreZ(l: OfficeLayout, side: -1 | 1): number {
  const c = side === -1 ? l.corridors[0] : l.corridors[1];
  return c.z + (c.d || CORRIDOR_W) / 2;
}
