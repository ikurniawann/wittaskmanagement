import type { PlayDivision } from "../types";

/**
 * Deterministic office layout. Pure: same divisions in → same rectangles out.
 * Units are world metres on an XZ grid; `cell` is the coarse pathfinding cell.
 *
 * Plan: a central lobby; rooms arranged in two rows (north/south of the lobby),
 * ordered by a stable hash of the division id so adding members never reshuffles
 * rooms. Each room's floor area grows with member count (min 4 desks). Desks sit
 * on a grid inside the room; the head's desk is the corner nearest the lobby.
 * A corridor row runs between each room row and the lobby, so every desk has a
 * straight walkable path. The approval room sits east of the lobby; event boards
 * line the lobby's west wall.
 */
export type Rect = { x: number; z: number; w: number; d: number };

export type DeskSlot = {
  personId: string | null;
  x: number;
  z: number;
  /** Facing direction in radians (0 = +Z). */
  facing: number;
  isHead: boolean;
};

export type Room = {
  divisionId: string;
  name: string;
  color: string;
  rect: Rect;
  /** Which side of the lobby: -1 north (negative z), +1 south (positive z). */
  side: -1 | 1;
  desks: DeskSlot[];
  /** Position of the division whiteboard (unassigned-task fallback). */
  whiteboard: { x: number; z: number };
  /** Door position on the corridor edge. */
  door: { x: number; z: number };
};

export type OfficeLayout = {
  lobby: Rect;
  approvalRoom: Rect & { door: { x: number; z: number } };
  corridors: Rect[];
  rooms: Room[];
  eventBoards: { x: number; z: number; facing: number }[];
  bounds: Rect;
  cell: number;
  /** Walkable coarse grid (true = walkable), origin at bounds.x/bounds.z. */
  walkable: boolean[][];
};

export const DESK_PITCH = 3.2; // metres between desk centres
export const ROOM_PAD = 2.2; // wall to first desk
export const CORRIDOR_W = 4;
export const ROOM_GAP = 2.4;
export const CELL = 1;

/** FNV-1a 32-bit — stable across runtimes, used for ordering and colours. */
export function hashId(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Deterministic division colour when the org record has none (hue from the id hash). */
export function divisionColor(id: string): string {
  const h = hashId(id) % 360;
  // HSL → hex, fixed s/l so every division reads as a mid-saturated tint.
  const s = 0.58, l = 0.52;
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  const hex = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}`.toUpperCase();
}

function roomGrid(memberCount: number): { cols: number; rows: number } {
  const n = Math.max(4, memberCount);
  const cols = Math.ceil(Math.sqrt(n * 1.6));
  const rows = Math.ceil(n / cols);
  return { cols, rows };
}

export function layout(divisions: readonly PlayDivision[]): OfficeLayout {
  const ordered = [...divisions].sort((a, b) => hashId(a.id) - hashId(b.id) || a.id.localeCompare(b.id));
  const north: PlayDivision[] = [], south: PlayDivision[] = [];
  ordered.forEach((d, i) => (i % 2 === 0 ? north : south).push(d));

  const rowWidth = (list: PlayDivision[]) =>
    list.reduce((s, d) => s + (roomGrid(d.memberIds.length).cols - 1) * DESK_PITCH + ROOM_PAD * 2, 0) + Math.max(0, list.length - 1) * ROOM_GAP;
  const lobbyW = Math.max(24, rowWidth(north), rowWidth(south));
  const lobbyD = 16;
  const lobby: Rect = { x: 0, z: -lobbyD / 2, w: lobbyW, d: lobbyD };
  const corridors: Rect[] = [
    { x: 0, z: lobby.z - CORRIDOR_W, w: lobbyW, d: CORRIDOR_W },
    { x: 0, z: lobby.z + lobbyD, w: lobbyW, d: CORRIDOR_W },
  ];
  const approvalRoom = { x: lobbyW + ROOM_GAP, z: lobby.z + 2, w: 12, d: lobbyD - 4, door: { x: lobbyW + ROOM_GAP, z: 0 } };
  corridors.push({ x: lobbyW, z: -2, w: ROOM_GAP, d: 4 });

  const rooms: Room[] = [];
  const placeRow = (list: PlayDivision[], side: -1 | 1) => {
    let cx = 0;
    for (const d of list) {
      const { cols, rows } = roomGrid(d.memberIds.length);
      const w = (cols - 1) * DESK_PITCH + ROOM_PAD * 2;
      const depth = (rows - 1) * DESK_PITCH + ROOM_PAD * 2 + 2; // +2 for the whiteboard wall
      const corridor = side === -1 ? corridors[0] : corridors[1];
      const z = side === -1 ? corridor.z - depth : corridor.z + corridor.d;
      const rect: Rect = { x: cx, z, w, d: depth };
      const desks: DeskSlot[] = [];
      const members = [...d.memberIds].sort((a, b) => (a === d.headId ? -1 : b === d.headId ? 1 : a.localeCompare(b)));
      let k = 0;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          // Row 0 is the row nearest the corridor; head desk = first slot of that row.
          const zz = side === -1 ? rect.z + rect.d - 2 - ROOM_PAD - r * DESK_PITCH : rect.z + 2 + ROOM_PAD + r * DESK_PITCH;
          const personId = members[k] ?? null;
          desks.push({ personId, x: rect.x + ROOM_PAD + c * DESK_PITCH, z: zz, facing: side === -1 ? 0 : Math.PI, isHead: personId != null && personId === d.headId });
          k++;
        }
      }
      const whiteboard = { x: rect.x + rect.w / 2, z: side === -1 ? rect.z + 0.6 : rect.z + rect.d - 0.6 };
      const door = { x: rect.x + rect.w / 2, z: side === -1 ? rect.z + rect.d : rect.z };
      rooms.push({ divisionId: d.id, name: d.name, color: d.color, rect, side, desks, whiteboard, door });
      cx += w + ROOM_GAP;
    }
  };
  placeRow(north, -1);
  placeRow(south, 1);

  const eventBoards = [0, 1, 2, 3, 4, 5].map((i) => ({ x: 0.6, z: lobby.z + 2 + i * 2.2, facing: Math.PI / 2 }));

  const minX = 0, minZ = Math.min(...rooms.map((r) => r.rect.z), corridors[0].z) - 2;
  const maxX = approvalRoom.x + approvalRoom.w + 2;
  const maxZ = Math.max(...rooms.map((r) => r.rect.z + r.rect.d), corridors[1].z + corridors[1].d) + 2;
  const bounds: Rect = { x: minX, z: minZ, w: maxX - minX, d: maxZ - minZ };

  // Coarse walkable grid: lobby, corridors, room floors, approval room; desks block their cell.
  const gw = Math.ceil(bounds.w / CELL), gd = Math.ceil(bounds.d / CELL);
  const walkable: boolean[][] = Array.from({ length: gd }, () => Array<boolean>(gw).fill(false));
  const fill = (r: Rect, v: boolean) => {
    const x0 = Math.floor((r.x - bounds.x) / CELL), z0 = Math.floor((r.z - bounds.z) / CELL);
    const x1 = Math.ceil((r.x + r.w - bounds.x) / CELL), z1 = Math.ceil((r.z + r.d - bounds.z) / CELL);
    for (let z = Math.max(0, z0); z < Math.min(gd, z1); z++) for (let x = Math.max(0, x0); x < Math.min(gw, x1); x++) walkable[z][x] = v;
  };
  fill(lobby, true);
  corridors.forEach((c) => fill(c, true));
  fill(approvalRoom, true);
  rooms.forEach((r) => {
    fill(r.rect, true);
    r.desks.forEach((d) => fill({ x: d.x - 0.7, z: d.z - 0.4, w: 1.4, d: 0.8 }, false));
  });

  return { lobby, approvalRoom, corridors, rooms, eventBoards, bounds, cell: CELL, walkable };
}

export function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.z < b.z + b.d && b.z < a.z + a.d;
}

/** BFS reachability on the coarse grid between two world points. */
export function reachable(l: OfficeLayout, from: { x: number; z: number }, to: { x: number; z: number }): boolean {
  const toCell = (p: { x: number; z: number }) => ({ x: Math.floor((p.x - l.bounds.x) / l.cell), z: Math.floor((p.z - l.bounds.z) / l.cell) });
  const a = toCell(from), b = toCell(to);
  const gd = l.walkable.length, gw = l.walkable[0]?.length ?? 0;
  const inb = (x: number, z: number) => x >= 0 && z >= 0 && x < gw && z < gd;
  if (!inb(a.x, a.z) || !inb(b.x, b.z)) return false;
  // Allow starting/ending on a blocked cell (a desk) by seeding from its neighbours too.
  const seen = new Uint8Array(gw * gd);
  const queue: number[] = [];
  const push = (x: number, z: number) => { if (inb(x, z) && !seen[z * gw + x]) { seen[z * gw + x] = 1; queue.push(z * gw + x); } };
  push(a.x, a.z);
  for (let qi = 0; qi < queue.length; qi++) {
    const id = queue[qi], x = id % gw, z = (id - x) / gw;
    if (x === b.x && z === b.z) return true;
    const open = l.walkable[z][x] || qi === 0;
    if (!open) continue;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx, nz = z + dz;
      if (!inb(nx, nz)) continue;
      if (l.walkable[nz][nx] || (nx === b.x && nz === b.z)) push(nx, nz);
    }
  }
  return false;
}
