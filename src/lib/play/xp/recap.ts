import { and, eq, gte } from "drizzle-orm";
import { db } from "@/db";
import { playBadgeAwards, playQuests, playXpLedger } from "@/db/schema";
import { notify } from "@/lib/notifications";
import { playUserIds } from "./service";

// EPIC-026 T-264 — Monday 08:00 WIB recap: one in-app notification per active
// Play user summarising last week's XP, badges and quests. In-app only; the
// WhatsApp mirror is an Owner decision recorded in the epic (deferred).
export async function sendWeeklyRecaps(now = new Date()): Promise<number> {
  const since = new Date(now.getTime() - 7 * 86400000);
  const week = now.toISOString().slice(0, 10);
  let sent = 0;
  for (const userId of await playUserIds()) {
    const [ledger, badges, quests] = await Promise.all([
      db.select({ points: playXpLedger.points }).from(playXpLedger).where(and(eq(playXpLedger.userId, userId), gte(playXpLedger.createdAt, since))),
      db.select({ key: playBadgeAwards.badgeKey }).from(playBadgeAwards).where(and(eq(playBadgeAwards.userId, userId), gte(playBadgeAwards.awardedAt, since))),
      db.select({ done: playQuests.completedAt }).from(playQuests).where(and(eq(playQuests.userId, userId), gte(playQuests.createdAt, since))),
    ]);
    const xp = ledger.reduce((s, r) => s + r.points, 0);
    if (xp === 0 && badges.length === 0) continue; // nothing to say
    const questsDone = quests.filter((q) => q.done).length;
    await notify({
      userId,
      type: "play_recap",
      title: `Play recap: +${xp} XP last week` + (badges.length ? `, ${badges.length} badge${badges.length > 1 ? "s" : ""}` : "") + (questsDone ? `, ${questsDone} quest${questsDone > 1 ? "s" : ""} done` : ""),
      href: "/play?focus=me",
      dedupKey: `play_recap:${userId}:${week}`,
    });
    sent++;
  }
  return sent;
}
