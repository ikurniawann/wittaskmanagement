import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { activityLog } from "./activity";
import { profiles } from "./org";

// Backstage Play — gamification (EPIC-026 T-260). Reviewed schema change.
//
// Design rule from PRD-GAME.md: the XP ledger is APPEND-ONLY and DERIVED from
// activity_log. `play_xp_ledger` is unique on (activity, rule) so replays and
// recomputes are idempotent, and a full recompute from the log must equal the
// incremental total. Nothing here changes tasks, priorities or permissions.

/** One row per person who has ever earned XP or changed a Play preference. */
export const playProfiles = pgTable("play_profiles", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => profiles.id, { onDelete: "cascade" }),
  xp: integer("xp").notNull().default(0),
  level: integer("level").notNull().default(0),
  /** { hat?: string; plant?: string; monitor?: string; chair?: string } — visual only */
  cosmetics: jsonb("cosmetics").notNull().default({}),
  /** the person agreed to appear on their division's leaderboard */
  leaderboardOptIn: boolean("leaderboard_opt_in").notNull().default(false),
  seasonId: uuid("season_id").references(() => playSeasons.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Append-only. `points` may be 0 for a guarded/flagged entry (kept for the Owner report). */
export const playXpLedger = pgTable(
  "play_xp_ledger",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    activityId: uuid("activity_id")
      .notNull()
      .references(() => activityLog.id, { onDelete: "cascade" }),
    /** rule key from src/lib/play/xp/rules.ts, or "flag:<reason>" for a guarded entry */
    rule: text("rule").notNull(),
    points: integer("points").notNull(),
    /** "task:<uuid>" | "handoff:<uuid>" | "approval:<uuid>" | "quest:<uuid>" */
    ref: text("ref"),
    eventId: uuid("event_id"),
    divisionId: text("division_id"),
    flagged: boolean("flagged").notNull().default(false),
    reason: text("reason"),
    /** WIB calendar day the entry counts towards (daily caps) */
    day: date("day").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("play_xp_ledger_activity_rule_idx").on(t.activityId, t.rule),
    index("play_xp_ledger_user_created_idx").on(t.userId, t.createdAt),
    index("play_xp_ledger_user_day_idx").on(t.userId, t.day),
  ],
);

export const playBadges = pgTable("play_badges", {
  key: text("key").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  icon: text("icon").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const playBadgeAwards = pgTable(
  "play_badge_awards",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    badgeKey: text("badge_key")
      .notNull()
      .references(() => playBadges.key, { onDelete: "cascade" }),
    awardedAt: timestamp("awarded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("play_badge_awards_user_badge_idx").on(t.userId, t.badgeKey)],
);

/** Generated daily from REAL work; never invents a task. Completion is detected from the ledger. */
export const playQuests = pgTable(
  "play_quests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    /** WIB calendar day */
    day: date("day").notNull(),
    kind: text("kind").notNull(), // clear_overdue | unblock | decide | refresh_stale
    title: text("title").notNull(),
    /** task/handoff/approval ids the quest is about — all visible to the user at generation time */
    targetIds: jsonb("target_ids").notNull().default([]),
    targetCount: integer("target_count").notNull().default(1),
    progress: integer("progress").notNull().default(0),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("play_quests_user_day_kind_idx").on(t.userId, t.day, t.kind)],
);

export const playSeasons = pgTable("play_seasons", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull().defaultNow(),
  endsAt: timestamp("ends_at", { withTimezone: true }),
  /** { userId: { xp, level } } snapshot taken when the season closed */
  archive: jsonb("archive").notNull().default({}),
});
