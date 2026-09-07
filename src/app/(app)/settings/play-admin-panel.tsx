"use client";

import { Loader2, Trophy } from "lucide-react";
import { useState, useTransition } from "react";
import type { PlayAdminView } from "@/lib/play/xp/admin";
import { resetPlayRulesAction, resetPlaySeasonAction, savePlayRulesAction, setPlayLeaderboardPolicyAction } from "./actions";

// EPIC-026 T-265 — Owner controls for Backstage Play. Admin-only (the page
// decides; every action re-checks). Changes apply on the next scored activity;
// no deploy.
export function PlayAdminPanel({ view }: { view: PlayAdminView }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [points, setPoints] = useState<Record<string, number>>({ ...view.rules.points });
  const [caps, setCaps] = useState<Record<string, number>>({ ...view.rules.caps });
  const [policy, setPolicy] = useState(view.policy);
  const [seasonName, setSeasonName] = useState("");

  const run = (fn: () => Promise<{ error?: string; archived?: number } | void>, okText: string) =>
    start(async () => {
      setError(null); setNotice(null);
      const r = await fn();
      if (r && "error" in r && r.error) setError(r.error);
      else setNotice(okText + (r && "archived" in r && r.archived != null ? ` (${r.archived} profiles archived)` : ""));
    });
  const num = (v: string) => Math.max(0, Number(v) || 0);
  const field = (label: string, value: number, onChange: (n: number) => void) => (
    <label key={label} className="flex items-center justify-between gap-2 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <input type="number" min={0} value={value} onChange={(e) => onChange(num(e.target.value))} className="w-20 rounded border bg-background px-2 py-0.5 text-right" />
    </label>
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Trophy className="size-4 text-muted-foreground" /> Play — XP rules &amp; season
          {pending ? <Loader2 className="size-3 animate-spin text-muted-foreground" /> : null}
        </h2>
        <p className="text-xs text-muted-foreground">
          {view.totals.users} people scored · {view.totals.xp} XP in the ledger · {view.totals.entries} entries.
          Weights apply to the next scored activity; the ledger is recomputed nightly from the activity log.
        </p>
      </div>
      <div className="grid gap-4 rounded-md border bg-card p-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium">Points</span>
          {field("Task done on time", points.task_done_on_time, (n) => setPoints({ ...points, task_done_on_time: n }))}
          {field("Task done late", points.task_done_late, (n) => setPoints({ ...points, task_done_late: n }))}
          {field("Per waiter unblocked", points.unblock, (n) => setPoints({ ...points, unblock: n }))}
          {field("Handoff decided ≤ 24 h", points.handoff_fast, (n) => setPoints({ ...points, handoff_fast: n }))}
          {field("Approval decided ≤ 24 h", points.approval_fast, (n) => setPoints({ ...points, approval_fast: n }))}
          {field("Checklist item", points.checklist, (n) => setPoints({ ...points, checklist: n }))}
          {field("Reply to a mention ≤ 4 h", points.mention_reply, (n) => setPoints({ ...points, mention_reply: n }))}
          {field("Daily quest", points.quest, (n) => setPoints({ ...points, quest: n }))}
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium">Caps</span>
          {field("Daily cap", caps.daily, (n) => setCaps({ ...caps, daily: n }))}
          {field("Checklist / day", caps.checklistDaily, (n) => setCaps({ ...caps, checklistDaily: n }))}
          {field("Mention replies / day", caps.mentionDaily, (n) => setCaps({ ...caps, mentionDaily: n }))}
          {field("Unblock max per task", caps.unblockMax, (n) => setCaps({ ...caps, unblockMax: n }))}
          <div className="mt-2 flex gap-2">
            <button type="button" disabled={pending} className="rounded border px-2 py-1 text-xs hover:bg-accent disabled:opacity-50" onClick={() => run(() => savePlayRulesAction({ points, caps }), "Rules saved.")}>Save rules</button>
            <button type="button" disabled={pending} className="rounded border px-2 py-1 text-xs hover:bg-accent disabled:opacity-50" onClick={() => run(async () => { const r = await resetPlayRulesAction(); if (!r) { setPoints({ 
              task_done_on_time: 10, task_done_late: 3, unblock: 5, handoff_fast: 5, approval_fast: 5, checklist: 1, mention_reply: 2, quest: 15 }); setCaps({ daily: 100, checklistDaily: 10, mentionDaily: 10, unblockMax: 30 }); } return r; }, "Defaults restored.")}>Defaults</button>
          </div>
        </div>
      </div>
      <div className="grid gap-4 rounded-md border bg-card p-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs">
          <span className="font-medium">Leaderboard policy</span>
          <select value={policy} onChange={(e) => { const p = e.target.value as typeof policy; setPolicy(p); run(() => setPlayLeaderboardPolicyAction(p), "Policy saved."); }} className="rounded border bg-background px-2 py-1">
            <option value="off">Off — aggregates only (default)</option>
            <option value="head_opt_in">Division head may opt their division in</option>
            <option value="on">On for every division</option>
          </select>
          <span className="text-muted-foreground">People still choose individually whether they appear.</span>
        </label>
        <div className="flex flex-col gap-1 text-xs">
          <span className="font-medium">Season {view.season ? `· ${view.season.name} since ${view.season.startsAt.slice(0, 10)}` : "· none started"}</span>
          <div className="flex gap-1">
            <input value={seasonName} onChange={(e) => setSeasonName(e.target.value)} placeholder="Next season name" className="min-w-0 flex-1 rounded border bg-background px-2 py-1" />
            <button type="button" disabled={pending} className="rounded border px-2 py-1 hover:bg-accent disabled:opacity-50" onClick={() => { if (window.confirm("Archive everyone's XP and start a new season? Badges stay.")) run(() => resetPlaySeasonAction(seasonName), "Season reset."); }}>Reset season</button>
          </div>
          <span className="text-muted-foreground">Archives every profile&apos;s XP and level, zeroes the counters, keeps badges.</span>
        </div>
      </div>
      <div className="flex flex-col gap-1 rounded-md border bg-card p-4 text-xs">
        <span className="font-medium">Flagged activity (scored 0)</span>
        {view.flagged.length === 0 ? <span className="text-muted-foreground">Nothing flagged.</span> : (
          <ul className="flex max-h-56 flex-col gap-0.5 overflow-y-auto">
            {view.flagged.map((f) => <li key={f.id} className="flex justify-between gap-2"><span className="truncate">{f.userName} · {f.reason ?? f.rule} · {f.ref}</span><span className="shrink-0 text-muted-foreground">{f.at.slice(0, 16).replace("T", " ")}</span></li>)}
          </ul>
        )}
      </div>
      {error ? <span role="alert" className="text-[11px] text-destructive">{error}</span> : null}
      {notice ? <span className="text-[11px] text-muted-foreground">{notice}</span> : null}
    </div>
  );
}
