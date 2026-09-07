import Link from "next/link";
import { isPlayEnabled } from "@/lib/play/settings";

// EPIC-026 T-262/T-263 — Play progress outside the office: the profile shows
// level, XP and badges; My Tasks shows today's quests. Server component; it
// renders nothing while the org flag is off, so the classic pages are unchanged.
export async function PlayProgress({ userId, compact = false }: { userId: string; compact?: boolean }) {
  if (!(await isPlayEnabled())) return null;
  const [{ myPlayProfile }, { todaysQuests }] = await Promise.all([import("@/lib/play/xp/admin"), import("@/lib/play/xp/quests")]);
  const [me, quests] = await Promise.all([myPlayProfile(userId), todaysQuests(userId)]);
  if (compact) {
    if (quests.length === 0) return null;
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-md border bg-card px-3 py-2 text-xs">
        <span className="font-medium">Today&apos;s quests</span>
        {quests.map((q) => (
          <span key={q.id} className={`rounded border px-2 py-0.5 ${q.completedAt ? "line-through text-muted-foreground" : ""}`}>{q.title} · {q.progress}/{q.targetCount}</span>
        ))}
        <Link href="/play?focus=me" className="ml-auto underline underline-offset-4">Open the office</Link>
      </div>
    );
  }
  const pct = Math.min(100, Math.round((me.xp - 100 * me.level * me.level) / (me.nextLevelXp - 100 * me.level * me.level) * 100));
  return (
    <div className="flex flex-col gap-3 rounded-md border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Backstage Play</h2>
        <Link href="/play?focus=me" className="text-xs underline underline-offset-4">Open the office</Link>
      </div>
      <div className="flex items-center gap-3 text-sm">
        <span className="rounded bg-accent px-2 py-1 font-medium">Level {me.level}</span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="h-1.5 w-full overflow-hidden rounded bg-muted"><div className="h-full bg-foreground" style={{ width: `${pct}%` }} /></div>
          <span className="text-xs text-muted-foreground">{me.xp} XP · next level at {me.nextLevelXp}{me.today ? ` · +${me.today} today` : ""}</span>
        </div>
      </div>
      {me.badges.length ? (
        <ul className="flex flex-wrap gap-2 text-xs">
          {me.badges.map((b) => <li key={b.key} className="rounded border px-2 py-1" title={b.description}>{b.icon} {b.name}</li>)}
        </ul>
      ) : <span className="text-xs text-muted-foreground">No badges yet. Finishing on time and unblocking others earns them.</span>}
      {quests.length ? (
        <ul className="flex flex-col gap-0.5 text-xs">
          {quests.map((q) => <li key={q.id} className={q.completedAt ? "line-through text-muted-foreground" : ""}>{q.title} · {q.progress}/{q.targetCount}</li>)}
        </ul>
      ) : null}
    </div>
  );
}
