"use client";

import { Link2, Plus, Search, X } from "lucide-react";
import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import {
  dependencyAddAction,
  dependencyRemoveAction,
  externalDepAddAction,
  externalDepDeleteAction,
  externalDepToggleAction,
  type TaskActionState,
} from "../actions";
import { EventChip } from "@/components/event-chip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// Dependency section of the task drawer (EPIC-012 T-122).
// "Blocked by" = internal blockers + external waits (checkable);
// "Blocking"  = who waits on this task. Internal add goes through the
// permission-scoped /api/search, so you can only pick what you can open.

interface DepTask {
  id: string;
  title: string;
  status: string;
  eventId: string;
  eventName: string;
}

interface ExternalDep {
  id: string;
  label: string;
  party: string;
  resolvedAt: string | null;
}

interface SearchHit {
  id: string;
  title: string;
  subtitle: string;
}

function StatusDot({ status }: { status: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "size-2 shrink-0 rounded-full",
        status === "done"
          ? "bg-status-done"
          : status === "blocked"
            ? "bg-status-blocked"
            : status === "in_progress"
              ? "bg-status-in-progress"
              : "bg-muted-foreground/40",
      )}
    />
  );
}

function InternalDepPicker({ taskId }: { taskId: string }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [picked, setPicked] = useState<SearchHit | null>(null);
  const [state, formAction, pending] = useActionState<TaskActionState, FormData>(
    dependencyAddAction,
    {},
  );

  const trimmed = query.trim();
  // below the minimum length the visible list is DERIVED empty — no
  // setState-in-effect (react-hooks v7)
  const shownHits = trimmed.length < 2 ? [] : hits;

  useEffect(() => {
    if (trimmed.length < 2) return;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(trimmed)}`);
        if (res.ok) {
          const data = (await res.json()) as { tasks: SearchHit[] };
          setHits(data.tasks.filter((t) => t.id !== taskId).slice(0, 6));
        }
      } catch {
        // offline — leave previous hits
      }
    }, 220);
    return () => clearTimeout(timer);
  }, [trimmed, taskId]);

  if (!open) {
    return (
      <Button variant="ghost" size="sm" className="w-fit gap-1.5" onClick={() => setOpen(true)}>
        <Link2 className="size-3.5" /> Add “blocked by”
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border bg-card p-3">
      <div className="flex items-center gap-2">
        <Search className="size-3.5 shrink-0 text-muted-foreground" />
        <input
          autoFocus
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPicked(null);
          }}
          placeholder="Search a task — any division, any project…"
          className="h-8 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
        <button
          type="button"
          aria-label="Close"
          onClick={() => setOpen(false)}
          className="text-muted-foreground hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      </div>
      {shownHits.length > 0 && !picked ? (
        <div className="flex flex-col">
          {shownHits.map((hit) => (
            <button
              key={hit.id}
              type="button"
              onClick={() => setPicked(hit)}
              className="flex items-baseline gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
            >
              <span className="min-w-0 flex-1 truncate">{hit.title}</span>
              <span className="max-w-[45%] truncate text-xs text-muted-foreground">
                {hit.subtitle}
              </span>
            </button>
          ))}
        </div>
      ) : null}
      {picked ? (
        <form action={formAction} className="flex items-center gap-2">
          <input type="hidden" name="taskId" value={taskId} />
          <input type="hidden" name="dependsOnTaskId" value={picked.id} />
          <span className="min-w-0 flex-1 truncate text-sm">
            Blocked by: <span className="font-medium">{picked.title}</span>
          </span>
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? "Adding…" : "Add"}
          </Button>
        </form>
      ) : null}
      {state.error ? (
        <p role="alert" className="text-xs text-destructive">{state.error}</p>
      ) : null}
    </div>
  );
}

function ExternalDepForm({ taskId }: { taskId: string }) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<TaskActionState, FormData>(
    externalDepAddAction,
    {},
  );

  if (!open) {
    return (
      <Button variant="ghost" size="sm" className="w-fit gap-1.5" onClick={() => setOpen(true)}>
        <Plus className="size-3.5" /> Add external wait
      </Button>
    );
  }
  return (
    <form action={formAction} className="flex flex-col gap-2 rounded-md border bg-card p-3">
      <input type="hidden" name="taskId" value={taskId} />
      <Input name="label" placeholder="Waiting for… (e.g. Crowd permit issued)" autoFocus />
      <Input name="party" placeholder="From whom? (e.g. Polres Jakarta Pusat)" />
      {state.error ? (
        <p role="alert" className="text-xs text-destructive">{state.error}</p>
      ) : null}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Adding…" : "Add"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export function DependencySection({
  taskId,
  taskEventId,
  canEdit,
  blockers,
  dependents,
  externalDeps,
}: {
  taskId: string;
  taskEventId: string;
  canEdit: boolean;
  blockers: DepTask[];
  dependents: DepTask[];
  externalDeps: ExternalDep[];
}) {
  const openWaiters = dependents.filter(
    (d) => d.status !== "done" && d.status !== "cancelled",
  ).length;
  const waitingOn =
    blockers.filter((b) => b.status !== "done").length +
    externalDeps.filter((e) => e.resolvedAt === null).length;

  return (
    <div className="flex flex-col gap-3">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        Dependencies
        {waitingOn > 0 ? (
          <span className="rounded-full border px-2 py-0.5 text-[10px] font-medium normal-case tracking-normal text-muted-foreground">
            Waiting on {waitingOn}
          </span>
        ) : null}
        {openWaiters > 0 ? (
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-[10px] font-semibold normal-case tracking-normal",
              openWaiters >= 3
                ? "bg-status-blocked/15 text-status-blocked"
                : "border text-muted-foreground",
            )}
          >
            {openWaiters} waiting on this
          </span>
        ) : null}
      </h2>

      {/* blocked by — internal */}
      {blockers.length > 0 ? (
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">Blocked by</span>
          {blockers.map((b) => (
            <div key={b.id} className="flex items-center gap-2 text-sm">
              <StatusDot status={b.status} />
              <Link
                href={`/tasks/${b.id}`}
                className={cn(
                  "min-w-0 truncate hover:underline",
                  b.status === "done" && "text-muted-foreground line-through",
                )}
              >
                {b.title}
              </Link>
              {b.eventId !== taskEventId ? <EventChip name={b.eventName} /> : null}
              {canEdit ? (
                <form action={dependencyRemoveAction} className="ml-auto flex">
                  <input type="hidden" name="taskId" value={taskId} />
                  <input type="hidden" name="dependsOnTaskId" value={b.id} />
                  <button
                    type="submit"
                    aria-label={`Remove dependency on ${b.title}`}
                    className="text-muted-foreground/60 hover:text-destructive"
                  >
                    <X className="size-3.5" />
                  </button>
                </form>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {/* blocked by — external waits */}
      {externalDeps.length > 0 ? (
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">
            External waits (outside the system)
          </span>
          {externalDeps.map((dep) => {
            const resolved = dep.resolvedAt !== null;
            return (
              <div key={dep.id} className="flex items-center gap-2 text-sm">
                <form action={externalDepToggleAction} className="flex">
                  <input type="hidden" name="taskId" value={taskId} />
                  <input type="hidden" name="externalDepId" value={dep.id} />
                  <input type="hidden" name="resolved" value={String(!resolved)} />
                  <button
                    type="submit"
                    disabled={!canEdit}
                    aria-label={resolved ? "Reopen external wait" : "Mark received"}
                    className={cn(
                      "flex size-4.5 items-center justify-center rounded-full border transition-all disabled:pointer-events-none",
                      resolved
                        ? "border-status-done bg-status-done text-background"
                        : "hover:border-foreground/50",
                    )}
                  >
                    {resolved ? (
                      <span className="text-[10px] leading-none">✓</span>
                    ) : null}
                  </button>
                </form>
                <span
                  className={cn(
                    "min-w-0 truncate",
                    resolved && "text-muted-foreground line-through",
                  )}
                >
                  {dep.label}
                </span>
                {dep.party ? (
                  <span className="truncate text-xs text-muted-foreground">
                    — {dep.party}
                  </span>
                ) : null}
                {canEdit ? (
                  <form action={externalDepDeleteAction} className="ml-auto flex">
                    <input type="hidden" name="taskId" value={taskId} />
                    <input type="hidden" name="externalDepId" value={dep.id} />
                    <button
                      type="submit"
                      aria-label={`Delete external wait ${dep.label}`}
                      className="text-muted-foreground/60 hover:text-destructive"
                    >
                      <X className="size-3.5" />
                    </button>
                  </form>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}

      {/* blocking — who waits on this task */}
      {dependents.length > 0 ? (
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">
            Blocking ({openWaiters} open)
          </span>
          {dependents.map((d) => (
            <div key={d.id} className="flex items-center gap-2 text-sm">
              <StatusDot status={d.status} />
              <Link href={`/tasks/${d.id}`} className="min-w-0 truncate hover:underline">
                {d.title}
              </Link>
              {d.eventId !== taskEventId ? <EventChip name={d.eventName} /> : null}
            </div>
          ))}
        </div>
      ) : null}

      {canEdit ? (
        <div className="flex flex-wrap gap-2">
          <InternalDepPicker taskId={taskId} />
          <ExternalDepForm taskId={taskId} />
        </div>
      ) : null}
    </div>
  );
}
