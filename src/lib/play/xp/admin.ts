import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { activityLog, appSettings, divisionMembers, playBadgeAwards, playBadges, playProfiles, playSeasons, playXpLedger, profiles } from "@/db/schema";
import { logActivity } from "@/lib/activity";
import { assertCan, can, type Actor } from "@/lib/permissions";
import { DEFAULT_RULES, mergeRules, wibDay, type RulesConfig } from "./rules";
import { invalidateRules } from "./service";

// EPIC-026 T-264 / T-265 — Owner controls, team pulse, leaderboard policy,
// seasons and the flagged-activity report. Every write asserts org.manage in
// here, not in the UI: a server action is a public endpoint.

export type LeaderboardPolicy = "off" | "head_opt_in" | "on";

async function setting<T>(key: string, fallback: T): Promise<T> {
  try {
    const [row] = await db.select().from(appSettings).where(eq(appSettings.key, key)).limit(1);
    return (row?.value as T | undefined) ?? fallback;
  } catch {
    return fallback;
  }
}
async function putSetting(key: string, value: unknown): Promise<void> {
  await db
    .insert(appSettings)
    .values({ key, value })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });
}

export async function getLeaderboardPolicy(): Promise<LeaderboardPolicy> {
  const v = await setting<string>("play_leaderboard", "off");
  return v === "on" || v === "head_opt_in" ? v : "off";
}
/** A division head may switch their own division on when the policy allows it. */
export async function isDivisionLeaderboardOn(divisionId: string): Promise<boolean> {
  const policy = await getLeaderboardPolicy();
  if (policy === "on") return true;
  if (policy === "off") return false;
  return (await setting<boolean>(`play_leaderboard_${divisionId}`, false)) === true;
}
export async function setDivisionLeaderboard(actor: Actor, divisionId: string, on: boolean): Promise<void> {
  const head = actor.memberships.some((m) => m.divisionId === divisionId && m.role === "head");
  if (!head && !can(actor, "org.manage")) assertCan(actor, "org.manage");
  await putSetting(`play_leaderboard_${divisionId}`, on);
  await logActivity({ actorId: actor.id, action: "play.settings_changed", entity: `division:${divisionId}`, detail: { leaderboard: on } });
}

export type PlayAdminView = {
  rules: RulesConfig;
  overrides: unknown;
  policy: LeaderboardPolicy;
  season: { id: string; name: string; startsAt: string } | null;
  flagged: Array<{ id: string; userName: string; reason: string | null; rule: string; ref: string | null; at: string }>;
  totals: { users: number; xp: number; entries: number };
};

export async function getPlayAdminView(actor: Actor): Promise<PlayAdminView> {
  assertCan(actor, "org.manage");
  const overrides = await setting<unknown>("play_rules", null);
  const [policy, season, flagged, totals] = await Promise.all([
    getLeaderboardPolicy(),
    db.select().from(playSeasons).where(sql`${playSeasons.endsAt} is null`).orderBy(desc(playSeasons.startsAt)).limit(1),
    db
      .select({ id: playXpLedger.id, userName: profiles.name, reason: playXpLedger.reason, rule: playXpLedger.rule, ref: playXpLedger.ref, at: playXpLedger.createdAt })
      .from(playXpLedger)
      .innerJoin(profiles, eq(playXpLedger.userId, profiles.id))
      .where(eq(playXpLedger.flagged, true))
      .orderBy(desc(playXpLedger.createdAt))
      .limit(50),
    db.select({ users: sql<number>`count(distinct ${playXpLedger.userId})::int`, xp: sql<number>`coalesce(sum(${playXpLedger.points}),0)::int`, entries: sql<number>`count(*)::int` }).from(playXpLedger),
  ]);
  return {
    rules: mergeRules(overrides),
    overrides,
    policy,
    season: season[0] ? { id: season[0].id, name: season[0].name, startsAt: season[0].startsAt.toISOString() } : null,
    flagged: flagged.map((f) => ({ ...f, at: f.at.toISOString() })),
    totals: totals[0] ?? { users: 0, xp: 0, entries: 0 },
  };
}

/** Points/caps/guards overrides; validated by mergeRules (negative/NaN fall back to defaults). */
export async function savePlayRules(actor: Actor, overrides: unknown): Promise<RulesConfig> {
  assertCan(actor, "org.manage");
  const merged = mergeRules(overrides);
  await putSetting("play_rules", { points: merged.points, caps: merged.caps, guards: merged.guards });
  invalidateRules();
  await logActivity({ actorId: actor.id, action: "play.settings_changed", entity: "setting:play_rules", detail: { points: merged.points, caps: merged.caps, guards: merged.guards } });
  return merged;
}
export async function resetPlayRules(actor: Actor): Promise<RulesConfig> {
  assertCan(actor, "org.manage");
  await putSetting("play_rules", null);
  invalidateRules();
  await logActivity({ actorId: actor.id, action: "play.settings_changed", entity: "setting:play_rules", detail: { reset: true } });
  return DEFAULT_RULES;
}
export async function setLeaderboardPolicy(actor: Actor, policy: LeaderboardPolicy): Promise<void> {
  assertCan(actor, "org.manage");
  await putSetting("play_leaderboard", policy);
  await logActivity({ actorId: actor.id, action: "play.settings_changed", entity: "setting:play_leaderboard", detail: { policy } });
}

/** Close the current season: archive every profile's xp/level, then zero xp (badges stay). */
export async function resetSeason(actor: Actor, nextName: string): Promise<{ archived: number }> {
  assertCan(actor, "org.manage");
  const profilesNow = await db.select({ userId: playProfiles.userId, xp: playProfiles.xp, level: playProfiles.level }).from(playProfiles);
  const archive: Record<string, { xp: number; level: number }> = {};
  for (const p of profilesNow) archive[p.userId] = { xp: p.xp, level: p.level };
  const now = new Date();
  const [open] = await db.select().from(playSeasons).where(sql`${playSeasons.endsAt} is null`).limit(1);
  if (open) await db.update(playSeasons).set({ endsAt: now, archive }).where(eq(playSeasons.id, open.id));
  else await db.insert(playSeasons).values({ name: "Season 0", startsAt: new Date(0), endsAt: now, archive });
  const [next] = await db.insert(playSeasons).values({ name: nextName.trim() || `Season ${now.getFullYear()}`, startsAt: now }).returning();
  // the ledger is the record: keep it, but points before the reset no longer count → mark by season via profile xp recompute from `now`
  await db.update(playXpLedger).set({ points: 0, reason: sql`coalesce(${playXpLedger.reason}, 'archived_season')` }).where(and(sql`${playXpLedger.createdAt} < ${now}`, sql`${playXpLedger.points} > 0`));
  await db.update(playProfiles).set({ xp: 0, level: 0, seasonId: next.id, updatedAt: now });
  await logActivity({ actorId: actor.id, action: "play.season_reset", entity: `play:season`, detail: { archived: profilesNow.length, season: next.name } });
  return { archived: profilesNow.length };
}

// ---- team pulse & leaderboard (T-264) -------------------------------------------
export type Pulse = { divisionId: string; weekXp: number; onTimeRate: number | null; openWaiters: number; activeMembers: number };
export type LeaderRow = { userId: string; name: string; xp: number; level: number };

export async function divisionPulse(divisionId: string): Promise<Pulse> {
  const since = new Date(Date.now() - 7 * 86400000);
  const members = (await db.select({ userId: divisionMembers.userId }).from(divisionMembers).where(eq(divisionMembers.divisionId, divisionId))).map((m) => m.userId);
  if (!members.length) return { divisionId, weekXp: 0, onTimeRate: null, openWaiters: 0, activeMembers: 0 };
  const rows = await db
    .select({ userId: playXpLedger.userId, rule: playXpLedger.rule, points: playXpLedger.points })
    .from(playXpLedger)
    .where(and(inArray(playXpLedger.userId, members), gte(playXpLedger.createdAt, since)));
  const weekXp = rows.reduce((s, r) => s + r.points, 0);
  const onTime = rows.filter((r) => r.rule === "task_done_on_time").length, late = rows.filter((r) => r.rule === "task_done_late").length;
  const onTimeRate = onTime + late ? onTime / (onTime + late) : null;
  const [w] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(activityLog)
    .where(and(inArray(activityLog.actorId, members), gte(activityLog.createdAt, since)));
  void w;
  return { divisionId, weekXp, onTimeRate, openWaiters: 0, activeMembers: new Set(rows.map((r) => r.userId)).size };
}

/** Ranking for a division — only when the policy + head opt-in (+ member opt-in) allow it; else null. */
export async function divisionLeaderboard(divisionId: string): Promise<LeaderRow[] | null> {
  if (!(await isDivisionLeaderboardOn(divisionId))) return null;
  const rows = await db
    .select({ userId: playProfiles.userId, name: profiles.name, xp: playProfiles.xp, level: playProfiles.level, optIn: playProfiles.leaderboardOptIn })
    .from(playProfiles)
    .innerJoin(profiles, eq(playProfiles.userId, profiles.id))
    .innerJoin(divisionMembers, eq(divisionMembers.userId, playProfiles.userId))
    .where(eq(divisionMembers.divisionId, divisionId))
    .orderBy(desc(playProfiles.xp))
    .limit(10);
  return rows.filter((r) => r.optIn).map(({ userId, name, xp, level }) => ({ userId, name, xp, level }));
}

export async function setMyLeaderboardOptIn(actor: Actor, on: boolean): Promise<void> {
  await db
    .insert(playProfiles)
    .values({ userId: actor.id, leaderboardOptIn: on })
    .onConflictDoUpdate({ target: playProfiles.userId, set: { leaderboardOptIn: on, updatedAt: new Date() } });
}

export type MyPlayProfile = { xp: number; level: number; nextLevelXp: number; badges: Array<{ key: string; name: string; icon: string; description: string; awardedAt: string }>; cosmetics: Record<string, string>; leaderboardOptIn: boolean; today: number };

export async function myPlayProfile(userId: string): Promise<MyPlayProfile> {
  const [[p], awards, [today]] = await Promise.all([
    db.select().from(playProfiles).where(eq(playProfiles.userId, userId)).limit(1),
    db
      .select({ key: playBadges.key, name: playBadges.name, icon: playBadges.icon, description: playBadges.description, awardedAt: playBadgeAwards.awardedAt })
      .from(playBadgeAwards)
      .innerJoin(playBadges, eq(playBadgeAwards.badgeKey, playBadges.key))
      .where(eq(playBadgeAwards.userId, userId))
      .orderBy(desc(playBadgeAwards.awardedAt)),
    db.select({ n: sql<number>`coalesce(sum(${playXpLedger.points}),0)::int` }).from(playXpLedger).where(and(eq(playXpLedger.userId, userId), eq(playXpLedger.day, wibDay(new Date())))),
  ]);
  const level = p?.level ?? 0;
  return {
    xp: p?.xp ?? 0,
    level,
    nextLevelXp: 100 * (level + 1) * (level + 1),
    badges: awards.map((a) => ({ ...a, awardedAt: a.awardedAt.toISOString() })),
    cosmetics: ((p?.cosmetics as Record<string, string> | null) ?? {}),
    leaderboardOptIn: p?.leaderboardOptIn ?? false,
    today: today?.n ?? 0,
  };
}
