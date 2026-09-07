// EPIC-026 T-263 — badge catalogue. Awards are decided from the ledger and the
// activity log by `evaluateBadges` (service.ts); this file is the pure list.
export type BadgeSpec = { key: string; name: string; description: string; icon: string; sortOrder: number };

export const BADGES: readonly BadgeSpec[] = [
  { key: "first_handoff", name: "First Handoff", description: "Decided your first cross-division handoff.", icon: "📦", sortOrder: 10 },
  { key: "unblocker_5", name: "Unblocker", description: "Finished five tasks other people were waiting on.", icon: "🔓", sortOrder: 20 },
  { key: "on_time_7", name: "Zero-Overdue Week", description: "Finished something on time on seven different days.", icon: "📅", sortOrder: 30 },
  { key: "show_day_hero", name: "Show-Day Hero", description: "Closed a task on a project's show day.", icon: "🎤", sortOrder: 40 },
  { key: "approval_sprinter", name: "Approval Sprinter", description: "Decided ten approvals within a day of being asked.", icon: "⚡", sortOrder: 50 },
  { key: "level_5", name: "Season Finisher", description: "Reached level 5.", icon: "🏁", sortOrder: 60 },
];

/** Cosmetic unlocks per level — purely visual (T-263). */
export type Cosmetics = { hat?: string; plant?: string; monitor?: string; chair?: string };
export const COSMETIC_UNLOCKS: { level: number; slot: keyof Cosmetics; value: string; label: string }[] = [
  { level: 1, slot: "hat", value: "cap", label: "Crew cap" },
  { level: 2, slot: "plant", value: "fern", label: "Desk fern" },
  { level: 3, slot: "monitor", value: "wide", label: "Wide monitor" },
  { level: 4, slot: "chair", value: "red", label: "Red chair" },
  { level: 5, slot: "hat", value: "crown", label: "Season crown" },
];

/** Everything unlocked at `level`, latest per slot wins. */
export function cosmeticsForLevel(level: number): Cosmetics {
  const out: Cosmetics = {};
  for (const u of COSMETIC_UNLOCKS) if (u.level <= level) out[u.slot] = u.value;
  return out;
}
