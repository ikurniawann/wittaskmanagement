"use client";

import { useActionState, useState } from "react";
import {
  phaseManageAction,
  type EventActionState,
} from "@/app/(app)/events/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// Per-event workflow editor (Owner request): add / rename / delete / reorder
// phases. The current phase is protected from deletion.
export function WorkflowManager({
  eventId,
  phases,
  currentId,
}: {
  eventId: string;
  phases: Array<{ id: string; name: string }>;
  currentId: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [state, formAction, pending] = useActionState<
    EventActionState,
    FormData
  >(phaseManageAction, {});

  if (!open) {
    return (
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        Manage workflow ({phases.length})
      </Button>
    );
  }

  return (
    <div className="flex w-full flex-col gap-3 rounded-card bg-card shadow-card p-4">
      <span className="text-xs font-semibold">
        Workflow phases
      </span>
      <ol className="flex flex-col gap-1.5">
        {phases.map((phase, index) => (
          <li key={phase.id} className="flex items-center gap-2">
            <span className="w-5 text-right text-[10px] tabular-nums text-muted-foreground">
              {index + 1}.
            </span>
            {editing === phase.id ? (
              <form
                action={(fd) => {
                  formAction(fd);
                  setEditing(null);
                }}
                className="flex flex-1 items-center gap-2"
              >
                <input type="hidden" name="eventId" value={eventId} />
                <input type="hidden" name="phaseId" value={phase.id} />
                <input type="hidden" name="op" value="rename" />
                <Input
                  name="name"
                  defaultValue={phase.name}
                  autoFocus
                  className="h-8 max-w-56 text-xs"
                />
                <Button type="submit" size="sm" variant="outline" disabled={pending}>
                  Save
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(null)}>
                  ×
                </Button>
              </form>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => setEditing(phase.id)}
                  title="Rename"
                  className={cn(
                    "flex-1 rounded-sm px-2 py-1 text-left text-sm hover:bg-surface-2",
                    phase.id === currentId && "font-semibold",
                  )}
                >
                  {phase.name}
                  {phase.id === currentId ? (
                    <span className="ml-2 text-[10px] uppercase tracking-widest text-muted-foreground">
                      current
                    </span>
                  ) : null}
                </button>
                {(["up", "down"] as const).map((direction) => (
                  <form action={formAction} key={direction}>
                    <input type="hidden" name="eventId" value={eventId} />
                    <input type="hidden" name="phaseId" value={phase.id} />
                    <input type="hidden" name="op" value={direction} />
                    <button
                      type="submit"
                      disabled={
                        pending ||
                        (direction === "up" ? index === 0 : index === phases.length - 1)
                      }
                      aria-label={`Move ${phase.name} ${direction}`}
                      className="rounded-sm border px-1.5 py-0.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-30"
                    >
                      {direction === "up" ? "↑" : "↓"}
                    </button>
                  </form>
                ))}
                <form action={formAction}>
                  <input type="hidden" name="eventId" value={eventId} />
                  <input type="hidden" name="phaseId" value={phase.id} />
                  <input type="hidden" name="op" value="delete" />
                  <button
                    type="submit"
                    disabled={pending || phase.id === currentId}
                    title={
                      phase.id === currentId
                        ? "Cannot delete the current phase"
                        : "Delete phase"
                    }
                    className="rounded-sm border px-1.5 py-0.5 text-xs text-muted-foreground hover:border-destructive hover:text-destructive disabled:opacity-30"
                  >
                    ×
                  </button>
                </form>
              </>
            )}
          </li>
        ))}
      </ol>

      <form action={formAction} className="flex items-center gap-2">
        <input type="hidden" name="eventId" value={eventId} />
        <input type="hidden" name="op" value="add" />
        <Input
          name="name"
          placeholder="Add phase…"
          className="h-8 max-w-56 text-xs"
        />
        <Button type="submit" size="sm" variant="outline" disabled={pending}>
          Add
        </Button>
      </form>

      {state.error ? (
        <p role="alert" className="text-sm text-destructive">{state.error}</p>
      ) : null}
      <div>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Close
        </Button>
      </div>
    </div>
  );
}
