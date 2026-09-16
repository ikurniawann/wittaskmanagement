"use client";

import { Globe, Lock, Trash2, UserPlus } from "lucide-react";
import { useActionState, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  shareAction,
  unshareAction,
  visibilityAction,
  type ShareActionState,
} from "../actions";

// Sharing controls for a standalone page (EPIC-016 T-160). Author-only —
// the parent renders this exclusively when access.canManage is true, and the
// service re-checks on every action regardless.

/** Single-pick chip list. Deliberately not a native <select> — the Owner's
 *  standing rule is styled chips everywhere. Starts with nothing chosen so
 *  sharing is never one accidental click away. */
function ChipPick({
  name,
  options,
}: {
  name: string;
  options: Array<{ value: string; label: string }>;
}) {
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <div className="flex flex-wrap gap-1.5">
      {selected ? <input type="hidden" name={name} value={selected} /> : null}
      {options.map((option) => {
        const active = selected === option.value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => setSelected(active ? null : option.value)}
            className={cn(
              "rounded-full border px-2.5 py-1 text-xs transition-all duration-150 active:scale-[0.97]",
              active
                ? "border-foreground bg-foreground text-background"
                : "hover:border-foreground/40 hover:bg-surface-2",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export interface ShareItem {
  id: string;
  canEdit: boolean;
  userName: string | null;
  divisionName: string | null;
}

export function SharePanel({
  pageId,
  visibility,
  shares,
  people,
  divisions,
}: {
  pageId: string;
  visibility: "private" | "organisation";
  shares: ShareItem[];
  people: Array<{ id: string; name: string }>;
  divisions: Array<{ id: string; name: string }>;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<ShareActionState, FormData>(
    shareAction,
    {},
  );
  const visibilityForm = useRef<HTMLFormElement>(null);

  const options = [
    ...people.map((p) => ({ value: `user:${p.id}`, label: p.name })),
    ...divisions.map((d) => ({
      value: `division:${d.id}`,
      label: `${d.name} (division)`,
    })),
  ];

  return (
    <div className="flex flex-col gap-3 rounded-card bg-card shadow-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-sm font-semibold">Sharing</h2>
          <p className="text-xs text-muted-foreground">
            {visibility === "organisation"
              ? "Everyone in the organisation can read this page."
              : shares.length > 0
                ? `Private, shared with ${shares.length} ${shares.length === 1 ? "recipient" : "recipients"}.`
                : "Private — only you can see this page."}
          </p>
        </div>
        <form ref={visibilityForm} action={visibilityAction}>
          <input type="hidden" name="pageId" value={pageId} />
          <input
            type="hidden"
            name="visibility"
            value={visibility === "organisation" ? "private" : "organisation"}
          />
          <Button
            type="submit"
            variant="outline"
            size="sm"
            className="gap-1.5"
          >
            {visibility === "organisation" ? (
              <>
                <Lock className="size-3.5" /> Make private
              </>
            ) : (
              <>
                <Globe className="size-3.5" /> Share with everyone
              </>
            )}
          </Button>
        </form>
      </div>

      {shares.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5">
          {shares.map((share) => (
            <li key={share.id}>
              <form action={unshareAction}>
                <input type="hidden" name="pageId" value={pageId} />
                <input type="hidden" name="shareId" value={share.id} />
                <button
                  type="submit"
                  title="Remove access"
                  className={cn(
                    "group inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-all duration-150",
                    "hover:border-destructive/60 hover:bg-destructive/10 active:scale-[0.97]",
                  )}
                >
                  {share.userName ?? share.divisionName}
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    {share.canEdit ? "edit" : "read"}
                  </span>
                  <Trash2 className="size-3 text-muted-foreground transition-colors group-hover:text-destructive" />
                </button>
              </form>
            </li>
          ))}
        </ul>
      ) : null}

      {open ? (
        <form action={formAction} className="flex flex-col gap-3 border-t pt-3">
          <input type="hidden" name="pageId" value={pageId} />
          <ChipPick name="target" options={options} />
          <label className="flex items-center gap-2 text-xs">
            <Switch name="canEdit" />
            Allow editing
          </label>
          {state.error ? (
            <p role="alert" className="text-xs text-destructive">
              {state.error}
            </p>
          ) : null}
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? "Sharing…" : "Share"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setOpen(false)}
              className="text-muted-foreground"
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setOpen(true)}
            className="gap-1.5"
          >
            <UserPlus className="size-3.5" /> Share with someone
          </Button>
        </div>
      )}
    </div>
  );
}
