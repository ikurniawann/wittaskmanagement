"use client";

import { useActionState, useState } from "react";
import {
  setDivisionsAction,
  type EventActionState,
} from "@/app/(app)/events/actions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Per-event division roster (Owner request): the master 11 divisions live in
// /admin; HERE the owner picks which of them run this event — the board tabs
// follow this list.
export function DivisionsManager({
  eventId,
  allDivisions,
  activeIds,
}: {
  eventId: string;
  allDivisions: Array<{ id: string; name: string }>;
  activeIds: string[];
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set(activeIds));
  const [state, formAction, pending] = useActionState<
    EventActionState,
    FormData
  >(setDivisionsAction, {});

  if (!open) {
    return (
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        Manage divisions ({activeIds.length})
      </Button>
    );
  }

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <form
      action={formAction}
      className="flex w-full flex-col gap-3 rounded-md border bg-card p-4"
    >
      <input type="hidden" name="eventId" value={eventId} />
      {[...selected].map((id) => (
        <input key={id} type="hidden" name="divisionIds" value={id} />
      ))}
      <span className="text-xs font-semibold">
        Divisions on this project
      </span>
      <div className="flex flex-wrap gap-1.5">
        {allDivisions.map((division) => {
          const active = selected.has(division.id);
          return (
            <button
              key={division.id}
              type="button"
              onClick={() => toggle(division.id)}
              aria-pressed={active}
              className={cn(
                "rounded-sm border px-2.5 py-1 text-[11px] uppercase tracking-wider transition-colors",
                active
                  ? "border-foreground font-semibold"
                  : "text-muted-foreground opacity-60 hover:opacity-100",
              )}
            >
              {division.name}
            </button>
          );
        })}
      </div>
      {state.error ? (
        <p role="alert" className="text-sm text-destructive">{state.error}</p>
      ) : null}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Close
        </Button>
      </div>
    </form>
  );
}
