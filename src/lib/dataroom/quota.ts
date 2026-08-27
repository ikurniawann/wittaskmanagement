// Dataroom quota arithmetic (EPIC-017 T-170). Pure — no filesystem, no
// database — so every branch is unit-testable and the numbers cannot drift
// from the rules written in the epic.
//
// Three rules decide whether a quota figure is honest, and all three live
// here rather than in the upload handler:
//   1. Old versions count. Otherwise re-uploading a 500 MB file ten times
//      still reads as 500 MB while the disk has lost 5 GB.
//   2. Trashed files count until they are really purged, so a quota does not
//      appear to recover before the bytes are actually gone.
//   3. A global disk floor overrides every per-event quota. Quotas protect
//      events from each other; the floor protects the server.

const GIB = 1024 ** 3;

/** Applied to any event without its own limit (Owner, 2026-08-10). */
export const DEFAULT_QUOTA_BYTES = 10 * GIB;

/** Warn the Owner/Admin once an event passes this share of its quota. */
export const WARN_RATIO = 0.8;

/** Uploads stop everywhere once free disk drops below this, whatever the
 *  event's own quota still says. */
export const DISK_FLOOR_BYTES = 50 * GIB;

export type UsageLevel = "ok" | "warning" | "full";

export interface Usage {
  usedBytes: number;
  limitBytes: number;
  /** 0–1, clamped; 1 when the limit is 0 to avoid a divide-by-zero lie */
  ratio: number;
  remainingBytes: number;
  level: UsageLevel;
}

/**
 * Where an event stands. `usedBytes` must already include every stored
 * version and everything still sitting in the trash — see rules 1 and 2.
 */
export function usage(usedBytes: number, limitBytes: number): Usage {
  const limit = Math.max(0, limitBytes);
  const used = Math.max(0, usedBytes);
  const ratio = limit === 0 ? 1 : Math.min(used / limit, 1);
  const remaining = Math.max(0, limit - used);
  return {
    usedBytes: used,
    limitBytes: limit,
    ratio,
    remainingBytes: remaining,
    level: used >= limit ? "full" : ratio >= WARN_RATIO ? "warning" : "ok",
  };
}

/** True only on the upload that carries an event past the warning line, so
 *  the alert fires once instead of on every subsequent upload. */
export function crossesWarningLine(
  usedBefore: number,
  usedAfter: number,
  limitBytes: number,
): boolean {
  if (limitBytes <= 0) return false;
  const line = limitBytes * WARN_RATIO;
  return usedBefore < line && usedAfter >= line;
}

export type UploadVerdict =
  | { ok: true; remainingAfter: number }
  | { ok: false; reason: "quota" | "disk" | "invalid"; message: string };

export interface UploadCheck {
  usedBytes: number;
  limitBytes: number;
  incomingBytes: number;
  /** free space on the storage disk right now */
  freeDiskBytes: number;
  floorBytes?: number;
}

/**
 * Decides an upload BEFORE any byte is written. The message is written for
 * the person uploading and states the actual numbers — "upload failed" tells
 * them nothing they can act on.
 */
export function decideUpload(input: UploadCheck): UploadVerdict {
  const incoming = input.incomingBytes;
  if (!Number.isFinite(incoming) || incoming <= 0) {
    return { ok: false, reason: "invalid", message: "That file is empty." };
  }

  const floor = input.floorBytes ?? DISK_FLOOR_BYTES;
  // the floor is checked first: when the server itself is nearly full, an
  // event's remaining quota is irrelevant
  if (input.freeDiskBytes - incoming < floor) {
    return {
      ok: false,
      reason: "disk",
      message: `Storage is nearly full on the server (${formatBytes(
        input.freeDiskBytes,
      )} free). Uploads are paused until space is freed.`,
    };
  }

  const state = usage(input.usedBytes, input.limitBytes);
  if (incoming > state.remainingBytes) {
    return {
      ok: false,
      reason: "quota",
      message: `This project has used ${formatBytes(state.usedBytes)} of ${formatBytes(
        state.limitBytes,
      )}. That file needs ${formatBytes(incoming)}, and only ${formatBytes(
        state.remainingBytes,
      )} is left. Delete files or ask an admin to raise the limit.`,
    };
  }

  return { ok: true, remainingAfter: state.remainingBytes - incoming };
}

/**
 * Lowering a limit below what an event already stores must never delete
 * anything — a settings change is not a reason to lose a contract. The event
 * simply cannot upload again until it is back under.
 */
export function isOverLimit(usedBytes: number, limitBytes: number): boolean {
  return usedBytes > Math.max(0, limitBytes);
}

const UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

/** Human-readable size. Used in refusals and in the admin table, so it is
 *  here rather than duplicated in each component. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = value >= 100 || unit === 0 ? Math.round(value) : Number(value.toFixed(1));
  return `${rounded} ${UNITS[unit]}`;
}
