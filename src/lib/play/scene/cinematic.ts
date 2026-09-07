import type { OfficeLayout } from "../world/layout";

// EPIC-027 T-273 — pure pieces of the cinematic camera: easing, the crane
// curve and the guided-tour stop list. No three.js here so it unit-tests dry.

export function easeInOutCubic(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

/** Distance along a flight: lerp plus a rise in the middle so a move reads as a crane shot, not a slide. */
export function craneDist(from: number, to: number, s: number, crane: number): number {
  return from + (to - from) * s + Math.sin(s * Math.PI) * crane * Math.max(from, to);
}

/** Shortest signed yaw delta from `a` to `b` in (-π, π]. */
export function yawDelta(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d <= -Math.PI) d += Math.PI * 2;
  return d;
}

export type TourStop = {
  kind: "lobby" | "room" | "approvals" | "me";
  divisionId?: string;
  x: number;
  z: number;
  dist: number;
  yaw: number;
  /** Seconds to linger once the camera has arrived. */
  hold: number;
};

/** Lobby → every division room (alternating angles) → approval room → your desk. */
export function tourStops(l: OfficeLayout, meId: string | null): TourStop[] {
  const base = Math.PI / 4;
  const lobby = { x: l.lobby.x + l.lobby.w / 2, z: l.lobby.z + l.lobby.d / 2 };
  const stops: TourStop[] = [{ kind: "lobby", ...lobby, dist: 78, yaw: base - 0.55, hold: 3.2 }];
  l.rooms.forEach((r, i) => {
    stops.push({
      kind: "room",
      divisionId: r.divisionId,
      x: r.rect.x + r.rect.w / 2,
      z: r.rect.z + r.rect.d / 2,
      dist: Math.max(26, Math.max(r.rect.w, r.rect.d) * 1.7),
      yaw: base + (i % 2 ? 0.38 : -0.38),
      hold: 3.0,
    });
  });
  const A = l.approvalRoom;
  stops.push({ kind: "approvals", x: A.x + A.w / 2, z: A.z + A.d / 2, dist: 30, yaw: base + 0.25, hold: 2.6 });
  const mine = meId ? l.rooms.flatMap((r) => r.desks).find((d) => d.personId === meId) : undefined;
  stops.push(mine ? { kind: "me", x: mine.x, z: mine.z, dist: 34, yaw: base, hold: 0 } : { kind: "lobby", ...lobby, dist: 60, yaw: base, hold: 0 });
  return stops;
}
