"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import type { PlayHandoff, PlayTask, PlayWorld } from "@/lib/play/types";
import type { OfficeScene, Pick } from "@/lib/play/scene/office";
import { STATUS_COLOUR } from "@/lib/play/world/mapping";
import { applyDiff, coalesce, type ActivityRow, type Intent } from "@/lib/play/world/diff";
import { setPlayActive } from "@/lib/play/active-store";
import { STATUS_LABELS, TASK_STATUS_ORDER, type TaskStatus } from "@/lib/tasks/status";
import { claimTaskAction, commentTaskAction, decideHandoffAction, recordPlaySessionAction, setLeaderboardOptInAction, setTaskStatusAction } from "./actions";

// The only client boundary for Play. The engine is imported lazily inside an
// effect so three.js never runs on the server; the WebGL2 check happens before
// any of it loads (T-256). Live updates (T-250) arrive over SSE as activity rows,
// go through the pure diff engine, and reach the scene as intents. Every write
// (T-251/T-252) goes through the server actions → the app's own services.

type Props = { world: PlayWorld; focusTask: string | null; focusMe: boolean };

const btn = "rounded bg-background/85 px-2 py-1 text-xs backdrop-blur hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring";
const panel = "flex flex-col gap-2 rounded-md border bg-card p-3 text-sm shadow-lg";
const rowBtn = "w-full truncate rounded px-1 py-0.5 text-left hover:bg-accent focus-visible:bg-accent";

export function PlayCanvas({ world: initial, focusTask, focusMe }: Props) {
  const router = useRouter();
  const host = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<OfficeScene | null>(null);
  const selectRef = useRef<(p: Pick) => void>(() => {});
  const [world, setWorld] = useState(initial);
  const [hover, setHover] = useState<Pick>(null);
  const [selected, setSelected] = useState<Pick>(null);
  const [unsupported, setUnsupported] = useState(false);
  const [ready, setReady] = useState(false);
  const [live, setLive] = useState<"connecting" | "live" | "off">("connecting");
  const [cursor, setCursor] = useState(initial.cursor);
  const [trayOpen, setTrayOpen] = useState(true);

  const peopleById = useMemo(() => new Map(world.people.map((p) => [p.id, p])), [world.people]);
  const tasksById = useMemo(() => new Map(world.tasks.map((t) => [t.id, t])), [world.tasks]);
  const divisionsById = useMemo(() => new Map(world.divisions.map((d) => [d.id, d])), [world.divisions]);

  useEffect(() => {
    setPlayActive(true);
    return () => setPlayActive(false);
  }, []);

  // ---- scene lifecycle --------------------------------------------------------
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let scene: OfficeScene | null = null;
    let cancelled = false;
    let timer = 0;
    let clock = 0;
    let mq: MediaQueryList | null = null;
    const onMq = () => sceneRef.current?.setReducedMotion(!!mq?.matches);
    (async () => {
      const { hasWebGL2 } = await import("@/lib/play/engine/renderer");
      if (!hasWebGL2()) { setUnsupported(true); return; }
      const { OfficeScene: Scene } = await import("@/lib/play/scene/office");
      if (cancelled) return;
      scene = new Scene(el, initial, {
        onPick: (p) => selectRef.current(p),
        onHover: (p) => setHover(p),
      });
      sceneRef.current = scene;
      mq = window.matchMedia("(prefers-reduced-motion: reduce)");
      mq.addEventListener("change", onMq);
      onMq();
      const wib = () => (new Date().getUTCHours() + 7 + new Date().getUTCMinutes() / 60) % 24;
      scene.setTimeOfDay(wib());
      clock = window.setInterval(() => sceneRef.current?.setTimeOfDay(wib()), 60000);
      if (focusTask) scene.focusTask(focusTask);
      else if (focusMe) scene.focusPerson(initial.me.id);
      setReady(true);
      timer = window.setTimeout(() => {
        const s = sceneRef.current;
        if (!s) return;
        const sorted = [...s.fpsSamples].sort((a, b) => a - b);
        const p50 = sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
        void recordPlaySessionAction({ fpsP50: p50, drawCalls: s.drawCalls, touch: navigator.maxTouchPoints > 0, dpr: window.devicePixelRatio || 1 });
      }, 30000);
    })();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
      if (clock) window.clearInterval(clock);
      mq?.removeEventListener("change", onMq);
      scene?.dispose();
      sceneRef.current = null;
    };
    // the snapshot is fixed for this page load; live changes flow through the stream
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- live stream (T-250) --------------------------------------------------------
  const refetchTask = useCallback(async (id: string): Promise<PlayTask | null> => {
    const res = await fetch(`/api/play/task/${id}`, { cache: "no-store" });
    if (!res.ok) return null;
    const json = (await res.json()) as { ok: boolean; task: PlayTask | null };
    return json.ok ? json.task : null;
  }, []);
  const refetchWorld = useCallback(async (): Promise<PlayWorld | null> => {
    const res = await fetch("/api/play/world", { cache: "no-store" });
    if (!res.ok) return null;
    const json = (await res.json()) as { ok: boolean; world: PlayWorld };
    return json.ok ? json.world : null;
  }, []);

  const mergeTask = useCallback((id: string, task: PlayTask | null) => {
    setWorld((w) => {
      const rest = w.tasks.filter((t) => t.id !== id);
      const keep = task && task.status !== "done" && task.status !== "cancelled";
      return { ...w, tasks: keep ? [...rest, task] : rest };
    });
  }, []);

  const runIntents = useCallback(async (intents: Intent[]) => {
    const scene = sceneRef.current;
    let needWorld = false;
    for (const i of intents) {
      if (i.kind === "task") {
        const task = await refetchTask(i.id);
        scene?.applyTask(task, i.effect, i.id);
        mergeTask(i.id, task);
      } else if (i.kind === "handoffs" || i.kind === "approvals") needWorld = true;
      else if (i.kind === "bubble") scene?.bubble(i.personId, i.text);
      else if (i.kind === "levelup") { scene?.levelUp(i.personId, i.level); needWorld = true; }
    }
    if (needWorld) {
      const fresh = await refetchWorld();
      if (fresh) {
        scene?.setHandoffs(fresh.handoffs);
        scene?.setApprovalsWaiting(fresh.approvalsWaiting, fresh.approvalTiers);
        setWorld((w) => ({ ...w, handoffs: fresh.handoffs, approvalsWaiting: fresh.approvalsWaiting, approvalTiers: fresh.approvalTiers, unreadNotifications: fresh.unreadNotifications, me: fresh.me, quests: fresh.quests, pulse: fresh.pulse, leaderboard: fresh.leaderboard }));
      }
    }
  }, [mergeTask, refetchTask, refetchWorld]);

  useEffect(() => {
    let es: EventSource | null = null;
    let last = initial.cursor ?? new Date().toISOString();
    let stopped = false;
    let retry = 0;
    const seen = new Set<string>();
    const open = () => {
      if (stopped) return;
      es = new EventSource(`/api/play/stream?cursor=${encodeURIComponent(last)}`);
      es.onopen = () => { setLive("live"); retry = 0; };
      es.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data) as { cursor: string; rows: ActivityRow[] };
          last = data.cursor;
          setCursor(data.cursor);
          const rows = data.rows.filter((r) => !seen.has(r.id));
          rows.forEach((r) => seen.add(r.id));
          if (seen.size > 2000) seen.clear();
          const intents = coalesce(rows.flatMap(applyDiff));
          if (intents.length) void runIntents(intents);
        } catch { /* malformed frame: ignore */ }
      };
      es.onerror = () => {
        es?.close();
        es = null;
        setLive("off");
        // the server closes streams after 15 min; reconnect from the last cursor with backoff
        retry = Math.min(retry + 1, 6);
        window.setTimeout(open, 1000 * 2 ** retry);
      };
    };
    open();
    return () => { stopped = true; es?.close(); };
  }, [initial.cursor, runIntents]);

  // ---- quick actions (T-251 / T-252) --------------------------------------------------
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  /** Selection entry point: boards and the approval table navigate, everything else opens a panel. */
  const select = useCallback((p: Pick) => {
    setError(null);
    setComment("");
    if (p?.kind === "approvals") { router.push("/approvals"); setSelected(null); return; }
    if (p?.kind === "event") { router.push(`/events/${p.id}`); setSelected(null); return; }
    setSelected(p);
  }, [router]);
  useEffect(() => { selectRef.current = select; }, [select]);
  const selectedTask = selected?.kind === "task" ? tasksById.get(selected.id) ?? null : null;
  const selectedPerson = selected?.kind === "person" ? peopleById.get(selected.id) ?? null : null;
  const selectedHandoff: PlayHandoff | null = selected?.kind === "handoff" ? world.handoffs.find((h) => h.id === selected.id) ?? null : null;

  const applyResult = (taskId: string, r: Awaited<ReturnType<typeof setTaskStatusAction>>, effect: "restack" | "complete") => {
    if (!r.ok) { setError(r.error); return; }
    setError(null);
    sceneRef.current?.applyTask(r.task, effect, taskId);
    mergeTask(taskId, r.task);
    if (!r.task || r.task.status === "done" || r.task.status === "cancelled") setSelected(null);
    // XP and quests are scored just after the row lands; pick them up shortly after
    window.setTimeout(() => { void refetchWorld().then((fresh) => { if (fresh) setWorld((w) => ({ ...w, me: fresh.me, quests: fresh.quests, pulse: fresh.pulse, leaderboard: fresh.leaderboard })); }); }, 1500);
  };
  const changeStatus = (status: TaskStatus) => {
    if (!selectedTask) return;
    const id = selectedTask.id;
    start(async () => applyResult(id, await setTaskStatusAction(id, status), status === "done" || status === "cancelled" ? "complete" : "restack"));
  };
  const sendComment = () => {
    if (!selectedTask || !comment.trim()) return;
    const id = selectedTask.id;
    start(async () => {
      const r = await commentTaskAction(id, comment);
      if (r.ok) { setComment(""); sceneRef.current?.bubble(world.me.id, "Commented"); }
      applyResult(id, r, "restack");
    });
  };
  const claim = () => {
    if (!selectedTask) return;
    const id = selectedTask.id;
    start(async () => applyResult(id, await claimTaskAction(id), "restack"));
  };
  const decide = (accept: boolean) => {
    if (!selectedHandoff) return;
    const id = selectedHandoff.id;
    start(async () => {
      const r = await decideHandoffAction(id, accept);
      if (!r.ok) { setError(r.error); return; }
      setError(null);
      setSelected(null);
      const fresh = await refetchWorld();
      if (fresh) { sceneRef.current?.setHandoffs(fresh.handoffs); setWorld((w) => ({ ...w, handoffs: fresh.handoffs })); }
    });
  };

  // ---- my day (T-254) -------------------------------------------------------------------------
  const me = world.me.id;
  const myDivision = peopleById.get(me)?.divisionId ?? null;
  const isHead = peopleById.get(me)?.isHead ?? false;
  const today = new Date().toISOString().slice(0, 10);
  const mine = world.tasks.filter((t) => t.assigneeIds.includes(me) || (!t.assigneeIds.length && t.leadId === me));
  const dueToday = mine.filter((t) => t.dueDate?.slice(0, 10) === today && !t.overdue);
  const overdue = mine.filter((t) => t.overdue);
  const waitingOnMe = mine.filter((t) => t.waiters > 0);
  const handoffsForMe = isHead && myDivision ? world.handoffs.filter((h) => h.toDivisionId === myDivision) : [];
  const trayEmpty = overdue.length + dueToday.length + waitingOnMe.length + handoffsForMe.length + world.approvalsWaiting === 0;

  const hoverLabel = (() => {
    if (!hover) return null;
    if (hover.kind === "task") { const t = tasksById.get(hover.id); return t ? `${t.title} · ${STATUS_LABELS[t.status]}` : null; }
    if (hover.kind === "person") return peopleById.get(hover.id)?.name ?? null;
    if (hover.kind === "event") return world.events.find((e) => e.id === hover.id)?.name ?? null;
    if (hover.kind === "room") return divisionsById.get(hover.id)?.name ?? null;
    if (hover.kind === "handoff") { const h = world.handoffs.find((x) => x.id === hover.id); return h ? `Handoff: ${h.title}` : null; }
    if (hover.kind === "approvals") return `${world.approvalsWaiting} approval${world.approvalsWaiting === 1 ? "" : "s"} waiting on you`;
    return null;
  })();

  if (unsupported) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
        <h1 className="text-xl font-semibold">Play needs WebGL2</h1>
        <p className="max-w-md text-sm text-muted-foreground">
          This browser or device cannot render the 3D office. Everything it shows is also on the classic pages.
        </p>
        <Link href="/dashboard" className="text-sm underline underline-offset-4">Open the dashboard</Link>
      </div>
    );
  }

  const focusTaskFromTray = (id: string) => { sceneRef.current?.focusTask(id); select({ kind: "task", id }); };
  const dot = (s: TaskStatus) => <i className="mr-1 inline-block size-2 rounded-sm" style={{ background: STATUS_COLOUR[s] }} />;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col" data-cursor={cursor ?? ""} data-live={live}>
      <div ref={host} className="relative min-h-[60svh] flex-1 bg-[var(--surface-jet)]" aria-label="Backstage Play — 3D office. Use the Today tray or the sidebar pages for a list view." role="img" />
      {!ready ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">Building the office…</div>
      ) : null}

      <div className="pointer-events-none absolute left-3 top-3 flex flex-col gap-1 text-xs">
        <div data-testid="play-hint" className="rounded bg-background/85 px-2 py-1 font-medium backdrop-blur">
          {hoverLabel ?? "Drag to pan · wheel to zoom · Q/E rotate · click a desk, a stack or a courier"}
        </div>
      </div>

      <div className="absolute right-3 top-3 flex flex-wrap justify-end gap-1">
        <button type="button" className={btn} onClick={() => sceneRef.current?.rotate(-1)} aria-label="Rotate left">⟲</button>
        <button type="button" className={btn} onClick={() => sceneRef.current?.rotate(1)} aria-label="Rotate right">⟳</button>
        <button type="button" className={btn} onClick={() => sceneRef.current?.focusPerson(me) || sceneRef.current?.focusLobby()}>My desk</button>
        <button type="button" className={btn} onClick={() => sceneRef.current?.focusLobby()}>Lobby</button>
        <button type="button" className={btn} onClick={() => sceneRef.current?.focusApprovals()}>Approvals</button>
        <span data-testid="play-live" className={`self-center rounded px-1.5 py-0.5 text-[10px] ${live === "live" ? "bg-emerald-600/80 text-white" : "bg-muted text-muted-foreground"}`} title="Live updates from the activity log">
          {live === "live" ? "LIVE" : live === "off" ? "RECONNECTING" : "…"}
        </span>
      </div>

      <div className="pointer-events-none absolute bottom-3 left-3 hidden flex-wrap gap-2 rounded bg-background/85 px-2 py-1 text-[11px] backdrop-blur sm:flex">
        {(["todo", "in_progress", "in_review", "blocked"] as const).map((s) => (
          <span key={s} className="flex items-center gap-1">{dot(s)}{STATUS_LABELS[s]}</span>
        ))}
        <span className="text-muted-foreground">smoke = overdue · ring = critical bottleneck · ghosts = waiting on it · yellow = courier</span>
      </div>

      {/* Today tray (T-254) */}
      <div data-testid="play-tray" className={`absolute left-3 top-14 ${panel} w-64 max-sm:left-2 max-sm:top-12 max-sm:w-[calc(100%-1rem)]`}>
        <button type="button" className="flex items-center justify-between gap-2 text-left font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring" onClick={() => setTrayOpen((v) => !v)} aria-expanded={trayOpen}>
          <span>Today <span data-testid="play-level" className="ml-1 rounded bg-accent px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground" title={`${world.me.xp} XP · next level at ${world.me.nextLevelXp}`}>Lv {world.me.level} · {world.me.xp} XP{world.me.todayXp ? ` · +${world.me.todayXp} today` : ""}</span></span>
          <span data-testid="play-tray-summary" className="text-xs text-muted-foreground">
            {overdue.length} overdue · {dueToday.length} due · {world.unreadNotifications} unread{world.approvalsWaiting ? ` · ${world.approvalsWaiting} approvals` : ""}
          </span>
        </button>
        {trayOpen ? (
          <ul className="flex max-h-56 flex-col gap-0.5 overflow-y-auto text-xs">
            {overdue.map((t) => <li key={t.id}><button type="button" className={rowBtn} onFocus={() => sceneRef.current?.focusTask(t.id)} onClick={() => focusTaskFromTray(t.id)}>{dot(t.status)}Overdue · {t.title}</button></li>)}
            {dueToday.map((t) => <li key={t.id}><button type="button" className={rowBtn} onFocus={() => sceneRef.current?.focusTask(t.id)} onClick={() => focusTaskFromTray(t.id)}>{dot(t.status)}Due today · {t.title}</button></li>)}
            {waitingOnMe.map((t) => <li key={t.id}><button type="button" className={rowBtn} onFocus={() => sceneRef.current?.focusTask(t.id)} onClick={() => focusTaskFromTray(t.id)}>{t.waiters} waiting · {t.title}</button></li>)}
            {handoffsForMe.map((h) => <li key={h.id}><button type="button" className={rowBtn} onFocus={() => sceneRef.current?.focusHandoff(h.id)} onClick={() => { sceneRef.current?.focusHandoff(h.id); select({ kind: "handoff", id: h.id }); }}>Handoff · {h.title}</button></li>)}
            {world.approvalsWaiting > 0 ? <li><button type="button" className={rowBtn} onFocus={() => sceneRef.current?.focusApprovals()} onClick={() => router.push("/approvals")}>{world.approvalsWaiting} approval{world.approvalsWaiting === 1 ? "" : "s"} waiting</button></li> : null}
            {trayEmpty ? <li className="text-muted-foreground">Nothing urgent. Walk the office.</li> : null}
          </ul>
        ) : null}
        {trayOpen && world.quests.length ? (
          <div data-testid="play-quests" className="flex flex-col gap-0.5 border-t pt-2 text-xs">
            <span className="font-medium">Quests</span>
            {world.quests.map((q) => (
              <button key={q.id} type="button" className={rowBtn} onClick={() => { const id = q.targetIds[0]; if (id && tasksById.has(id)) focusTaskFromTray(id); }}>
                <span className={q.completedAt ? "line-through text-muted-foreground" : ""}>{q.title}</span>
                <span className="ml-1 text-muted-foreground">{q.progress}/{q.targetCount}{q.completedAt ? " · +15" : ""}</span>
              </button>
            ))}
          </div>
        ) : null}
        {trayOpen && world.pulse ? (
          <div data-testid="play-pulse" className="flex flex-col gap-0.5 border-t pt-2 text-xs">
            <span className="font-medium">Team pulse · {divisionsById.get(world.pulse.divisionId)?.name}</span>
            <span className="text-muted-foreground">{world.pulse.weekXp} XP this week · {world.pulse.onTimeRate == null ? "no completions yet" : `${Math.round(world.pulse.onTimeRate * 100)}% on time`} · {world.pulse.activeMembers} active</span>
            {world.leaderboard ? (
              <ol className="mt-1 flex flex-col gap-0.5">
                {world.leaderboard.slice(0, 5).map((l, i) => <li key={l.userId} className="flex justify-between"><span>{i + 1}. {l.name}</span><span className="text-muted-foreground">Lv {l.level} · {l.xp}</span></li>)}
                {world.leaderboard.length === 0 ? <li className="text-muted-foreground">Nobody has opted in yet.</li> : null}
              </ol>
            ) : null}
            {world.leaderboard ? (
              <label className="mt-1 flex items-center gap-1 text-muted-foreground"><input type="checkbox" checked={world.me.leaderboardOptIn} onChange={(e) => { const on = e.target.checked; setWorld((w) => ({ ...w, me: { ...w.me, leaderboardOptIn: on } })); void setLeaderboardOptInAction(on).then(() => refetchWorld()).then((fresh) => { if (fresh) setWorld((w) => ({ ...w, leaderboard: fresh.leaderboard })); }); }} /> Show me on the leaderboard</label>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* quick actions (T-251) */}
      {selectedTask ? (
        <div data-testid="play-task-panel" className={`absolute bottom-3 right-3 ${panel} w-80 max-sm:inset-x-2 max-sm:bottom-2 max-sm:w-auto`}>
          <div className="flex items-start justify-between gap-2">
            <div className="flex min-w-0 flex-col">
              <span className="truncate font-medium">{selectedTask.title}</span>
              <span className="text-xs text-muted-foreground">{divisionsById.get(selectedTask.divisionId)?.name} · {STATUS_LABELS[selectedTask.status]}{selectedTask.waiters ? ` · ${selectedTask.waiters} waiting` : ""}{selectedTask.overdue ? " · overdue" : ""}</span>
            </div>
            <button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={() => setSelected(null)} aria-label="Close">✕</button>
          </div>
          <div className="flex flex-wrap gap-1">
            {TASK_STATUS_ORDER.map((s) => (
              <button key={s} type="button" disabled={pending || s === selectedTask.status} onClick={() => changeStatus(s)}
                className={`rounded border px-2 py-0.5 text-xs disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring ${s === selectedTask.status ? "bg-accent" : "hover:bg-accent"}`}>
                {dot(s)}{STATUS_LABELS[s]}
              </button>
            ))}
          </div>
          <div className="flex gap-1">
            <input value={comment} onChange={(e) => setComment(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") sendComment(); }} placeholder="Comment…" aria-label="Comment" className="min-w-0 flex-1 rounded border bg-background px-2 py-1 text-xs" />
            <button type="button" className="rounded border px-2 py-1 text-xs hover:bg-accent disabled:opacity-50" disabled={pending || !comment.trim()} onClick={sendComment}>Send</button>
          </div>
          <div className="flex items-center justify-between gap-2 text-xs">
            {!selectedTask.assigneeIds.includes(me) ? <button type="button" className="rounded border px-2 py-1 hover:bg-accent disabled:opacity-50" disabled={pending} onClick={claim}>Claim</button> : <span className="text-muted-foreground">Assigned to you</span>}
            <Link href={`/tasks/${selectedTask.id}`} className="underline underline-offset-4">Open full task</Link>
          </div>
          {error ? <span role="alert" className="text-[11px] text-destructive">{error}</span> : null}
        </div>
      ) : null}

      {/* person card */}
      {selectedPerson ? (
        <div className={`absolute bottom-3 right-3 ${panel} w-72 max-sm:inset-x-2 max-sm:bottom-2 max-sm:w-auto`}>
          <div className="flex items-start justify-between gap-2">
            <div className="flex flex-col">
              <span className="font-medium">{selectedPerson.name}</span>
              <span className="text-xs text-muted-foreground">{selectedPerson.divisionId ? divisionsById.get(selectedPerson.divisionId)?.name : "No division"}{selectedPerson.isHead ? " · head" : ""}</span>
            </div>
            <button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={() => setSelected(null)} aria-label="Close">✕</button>
          </div>
          {(() => {
            const theirs = world.tasks.filter((t) => t.assigneeIds.includes(selectedPerson.id) || (!t.assigneeIds.length && t.leadId === selectedPerson.id));
            return theirs.length === 0 ? <span className="text-xs text-muted-foreground">No open tasks you can see.</span> : (
              <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto">
                {theirs.slice(0, 12).map((t) => (
                  <li key={t.id}>
                    <button type="button" onClick={() => focusTaskFromTray(t.id)} className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left hover:bg-accent focus-visible:bg-accent">
                      {dot(t.status)}
                      <span className="truncate">{t.title}</span>
                      {t.waiters > 0 ? <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">{t.waiters} waiting</span> : null}
                    </button>
                  </li>
                ))}
              </ul>
            );
          })()}
        </div>
      ) : null}

      {/* handoff card (T-252) */}
      {selectedHandoff ? (
        <div data-testid="play-handoff-panel" className={`absolute bottom-3 right-3 ${panel} w-80 max-sm:inset-x-2 max-sm:bottom-2 max-sm:w-auto`}>
          <div className="flex items-start justify-between gap-2">
            <div className="flex min-w-0 flex-col">
              <span className="truncate font-medium">Handoff · {selectedHandoff.title}</span>
              <span className="text-xs text-muted-foreground">{divisionsById.get(selectedHandoff.fromDivisionId)?.name} → {divisionsById.get(selectedHandoff.toDivisionId)?.name}</span>
            </div>
            <button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={() => setSelected(null)} aria-label="Close">✕</button>
          </div>
          <div className="flex flex-wrap gap-1 text-xs">
            <button type="button" className="rounded border px-2 py-1 hover:bg-accent disabled:opacity-50" disabled={pending} onClick={() => decide(true)}>Accept</button>
            <button type="button" className="rounded border px-2 py-1 hover:bg-accent disabled:opacity-50" disabled={pending} onClick={() => decide(false)}>Decline</button>
            <span className="self-center text-muted-foreground">Only the receiving division&apos;s head can decide.</span>
          </div>
          {error ? <span role="alert" className="text-[11px] text-destructive">{error}</span> : null}
        </div>
      ) : null}
    </div>
  );
}
