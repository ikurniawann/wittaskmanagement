"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { PlayWorld } from "@/lib/play/types";
import type { OfficeScene, Pick } from "@/lib/play/scene/office";
import { STATUS_COLOUR } from "@/lib/play/world/mapping";
import { setPlayActive } from "@/lib/play/active-store";
import { recordPlaySessionAction } from "./actions";

// The only client boundary for Play. The engine is imported lazily inside an
// effect so three.js never runs on the server, and the WebGL2 check happens
// before any of it loads (T-256 fallback lives here too).

type Props = { world: PlayWorld; focusTask: string | null };

export function PlayCanvas({ world, focusTask }: Props) {
  const router = useRouter();
  const host = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<OfficeScene | null>(null);
  const [hover, setHover] = useState<Pick>(null);
  const [person, setPerson] = useState<string | null>(null);
  const [unsupported, setUnsupported] = useState(false);
  const [ready, setReady] = useState(false);

  const peopleById = useMemo(() => new Map(world.people.map((p) => [p.id, p])), [world.people]);
  const tasksById = useMemo(() => new Map(world.tasks.map((t) => [t.id, t])), [world.tasks]);
  const divisionsById = useMemo(() => new Map(world.divisions.map((d) => [d.id, d])), [world.divisions]);

  useEffect(() => {
    setPlayActive(true);
    return () => setPlayActive(false);
  }, []);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let scene: OfficeScene | null = null;
    let cancelled = false;
    let timer = 0;
    (async () => {
      const { hasWebGL2 } = await import("@/lib/play/engine/renderer");
      if (!hasWebGL2()) { setUnsupported(true); return; }
      const { OfficeScene: Scene } = await import("@/lib/play/scene/office");
      if (cancelled) return;
      scene = new Scene(el, world, {
        onPick: (p) => {
          if (!p) { setPerson(null); return; }
          if (p.kind === "task") router.push(`/tasks/${p.id}`);
          else if (p.kind === "event") router.push(`/events/${p.id}`);
          else if (p.kind === "person") setPerson(p.id);
        },
        onHover: (p) => setHover(p),
      });
      sceneRef.current = scene;
      if (focusTask) scene.focusTask(focusTask);
      setReady(true);
      // T-247 telemetry: one row per session after 30 s with p50 fps + device class.
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
      scene?.dispose();
      sceneRef.current = null;
    };
    // the world is a server snapshot for this page load; a new snapshot is a new page
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [world]);

  const hoverLabel = (() => {
    if (!hover) return null;
    if (hover.kind === "task") { const t = tasksById.get(hover.id); return t ? `${t.title} · ${t.status.replace("_", " ")}` : null; }
    if (hover.kind === "person") return peopleById.get(hover.id)?.name ?? null;
    if (hover.kind === "event") return world.events.find((e) => e.id === hover.id)?.name ?? null;
    if (hover.kind === "room") return divisionsById.get(hover.id)?.name ?? null;
    return null;
  })();

  const selected = person ? peopleById.get(person) : null;
  const selectedTasks = person ? world.tasks.filter((t) => t.assigneeIds.includes(person) || (!t.assigneeIds.length && t.leadId === person)) : [];

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

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div ref={host} className="relative min-h-[60svh] flex-1 bg-[var(--surface-jet)]" aria-label="Backstage Play — 3D office. Use the sidebar pages for a list view." role="img" />
      {!ready ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">Building the office…</div>
      ) : null}
      <div className="pointer-events-none absolute left-3 top-3 flex flex-col gap-1 text-xs">
        <div data-testid="play-hint" className="rounded bg-background/85 px-2 py-1 font-medium backdrop-blur">
          {hoverLabel ?? "Drag to pan · wheel to zoom · Q/E rotate · click a desk or a stack"}
        </div>
      </div>
      <div className="pointer-events-auto absolute right-3 top-3 flex gap-1">
        <button type="button" className="rounded bg-background/85 px-2 py-1 text-xs backdrop-blur hover:bg-accent" onClick={() => sceneRef.current?.rotate(-1)} aria-label="Rotate left">⟲</button>
        <button type="button" className="rounded bg-background/85 px-2 py-1 text-xs backdrop-blur hover:bg-accent" onClick={() => sceneRef.current?.rotate(1)} aria-label="Rotate right">⟳</button>
        <button type="button" className="rounded bg-background/85 px-2 py-1 text-xs backdrop-blur hover:bg-accent" onClick={() => sceneRef.current?.focusPerson(world.me.id) || sceneRef.current?.focusLobby()}>My desk</button>
        <button type="button" className="rounded bg-background/85 px-2 py-1 text-xs backdrop-blur hover:bg-accent" onClick={() => sceneRef.current?.focusLobby()}>Lobby</button>
      </div>
      <div className="pointer-events-none absolute bottom-3 left-3 flex flex-wrap gap-2 rounded bg-background/85 px-2 py-1 text-[11px] backdrop-blur">
        {(["todo", "in_progress", "in_review", "blocked"] as const).map((s) => (
          <span key={s} className="flex items-center gap-1">
            <i className="inline-block size-2.5 rounded-sm" style={{ background: STATUS_COLOUR[s] }} />
            {s.replace("_", " ")}
          </span>
        ))}
        <span className="text-muted-foreground">smoke = overdue · ring = critical bottleneck · ghosts = waiting on it</span>
      </div>
      {selected ? (
        <div className="absolute bottom-3 right-3 flex w-72 flex-col gap-2 rounded-md border bg-card p-3 text-sm shadow-lg">
          <div className="flex items-start justify-between gap-2">
            <div className="flex flex-col">
              <span className="font-medium">{selected.name}</span>
              <span className="text-xs text-muted-foreground">
                {selected.divisionId ? divisionsById.get(selected.divisionId)?.name : "No division"}{selected.isHead ? " · head" : ""}
              </span>
            </div>
            <button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={() => setPerson(null)} aria-label="Close">✕</button>
          </div>
          {selectedTasks.length === 0 ? (
            <span className="text-xs text-muted-foreground">No open tasks you can see.</span>
          ) : (
            <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto">
              {selectedTasks.slice(0, 12).map((t) => (
                <li key={t.id}>
                  <Link href={`/tasks/${t.id}`} className="flex items-center gap-2 rounded px-1 py-0.5 hover:bg-accent">
                    <i className="inline-block size-2 shrink-0 rounded-sm" style={{ background: STATUS_COLOUR[t.status] }} />
                    <span className="truncate">{t.title}</span>
                    {t.waiters > 0 ? <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">{t.waiters} waiting</span> : null}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
