"use client";

import { Building2, Check, Pencil, Plus, Trash2, X } from "lucide-react";
import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  createDivisionAction,
  deleteDivisionAction,
  renameDivisionAction,
  type ActionState,
} from "./actions";

// Division master data (Owner 2026-08-12). The slug is shown but never
// editable: it is an identifier woven through tasks, folders and permission
// rules — renaming a display name is an edit, renaming a slug is a data
// migration wearing an edit's clothes.

export interface DivisionRow {
  id: string;
  name: string;
  memberCount: number;
  taskCount: number;
}

function Row({ division }: { division: DivisionRow }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(division.name);
  const [renameState, renameAction, renaming] = useActionState<ActionState, FormData>(
    renameDivisionAction,
    {},
  );
  const [deleteState, deleteAction, deleting] = useActionState<ActionState, FormData>(
    deleteDivisionAction,
    {},
  );
  const busy = renaming || deleting;
  const inUse = division.memberCount > 0 || division.taskCount > 0;

  return (
    <li className="flex flex-col gap-1 px-4 py-2.5">
      <div className="flex items-center gap-3">
        {editing ? (
          <form action={renameAction} className="flex flex-1 items-center gap-2">
            <input type="hidden" name="divisionId" value={division.id} />
            <Input
              name="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-8 text-sm"
              autoFocus
            />
            <Button type="submit" size="sm" variant="outline" disabled={busy} className="gap-1">
              <Check className="size-3.5" /> Save
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setEditing(false);
                setName(division.name);
              }}
            >
              <X className="size-3.5" />
            </Button>
          </form>
        ) : (
          <>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm font-medium">{division.name}</span>
              <span className="truncate font-mono text-[10px] text-muted-foreground">
                {division.id}
              </span>
            </span>
            <span className="shrink-0 text-xs text-muted-foreground">
              {division.memberCount} member{division.memberCount === 1 ? "" : "s"} ·{" "}
              {division.taskCount} task{division.taskCount === 1 ? "" : "s"}
            </span>
            <button
              type="button"
              aria-label={`Rename ${division.name}`}
              onClick={() => setEditing(true)}
              className="flex size-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground sm:size-7"
            >
              <Pencil className="size-3.5" />
            </button>
            <form action={deleteAction}>
              <input type="hidden" name="divisionId" value={division.id} />
              <button
                type="submit"
                aria-label={`Delete ${division.name}`}
                title={
                  inUse
                    ? "Still has members or tasks — the delete will refuse with the numbers"
                    : "Delete this division"
                }
                disabled={busy}
                className="flex size-9 sm:size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
              >
                <Trash2 className="size-3.5" />
              </button>
            </form>
          </>
        )}
      </div>
      {renameState.error ? (
        <p role="alert" className="text-xs text-destructive">{renameState.error}</p>
      ) : null}
      {deleteState.error ? (
        <p role="alert" className="text-xs text-destructive">{deleteState.error}</p>
      ) : null}
    </li>
  );
}

export function DivisionsCard({ divisions }: { divisions: DivisionRow[] }) {
  const [adding, setAdding] = useState(false);
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    createDivisionAction,
    {},
  );

  return (
    <div className="flex flex-col gap-3 rounded-md border bg-card p-4 elev">
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-0.5">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Building2 className="size-4 text-muted-foreground" /> Divisions
          </h2>
          <p className="text-xs text-muted-foreground">
            The org&apos;s master list — every task, folder and membership hangs
            off one of these. Deleting is refused while anything still does.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => setAdding((v) => !v)} className="gap-1.5">
          <Plus className="size-3.5" /> New division
        </Button>
      </div>

      {adding ? (
        <form action={formAction} className="flex items-end gap-2 rounded-md border border-dashed p-3">
          <div className="flex flex-1 flex-col gap-1.5">
            <label htmlFor="dv-name" className="text-xs text-muted-foreground">
              Name — the slug is derived and permanent
            </label>
            <Input id="dv-name" name="name" placeholder="Media & Press" autoFocus />
          </div>
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? "Creating…" : "Create"}
          </Button>
        </form>
      ) : null}
      {state.error ? (
        <p role="alert" className="text-xs text-destructive">{state.error}</p>
      ) : null}

      <ul className="flex flex-col divide-y rounded-md border">
        {divisions.map((division) => (
          <Row key={division.id} division={division} />
        ))}
      </ul>
    </div>
  );
}
