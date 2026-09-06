"use client";

import { Lock, Pencil, UserPlus, X } from "lucide-react";
import { useActionState, useState } from "react";
import { UserSingleSelect } from "@/components/choice-chips";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  addMemberAction,
  removeMemberAction,
  type DataroomActionState,
} from "./actions";

// Member list for a sealed folder (EPIC-017 T-173). Only shown to someone who
// can manage the folder — and, because a sealed folder admits nobody but its
// list, that means someone already on it.

export interface MemberView {
  userId: string;
  name: string;
  email: string;
  canEdit: boolean;
}

export function SealedMembers({
  eventId,
  folderId,
  folderName,
  members,
  people,
}: {
  eventId: string;
  folderId: string;
  folderName: string;
  members: MemberView[];
  people: Array<{ id: string; name: string }>;
}) {
  const [adding, setAdding] = useState(false);
  const [addState, addAction, addPending] = useActionState<DataroomActionState, FormData>(
    addMemberAction,
    {},
  );
  const [removeState, removeAction] = useActionState<DataroomActionState, FormData>(
    removeMemberAction,
    {},
  );

  const alreadyIn = new Set(members.map((m) => m.userId));
  const candidates = people.filter((p) => !alreadyIn.has(p.id));

  return (
    <div className="flex flex-col gap-3 rounded-md border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Lock className="size-3.5 text-muted-foreground" />
            Who can open “{folderName}”
          </h2>
          <p className="text-xs text-muted-foreground">
            Nobody else sees this folder — not division heads, and not the
            Owner unless they are on this list.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setAdding((v) => !v)}
          disabled={candidates.length === 0}
          className="gap-1.5"
        >
          <UserPlus className="size-3.5" />
          Add person
        </Button>
      </div>

      <ul className="flex flex-col gap-1">
        {members.map((member) => (
          <li
            key={member.userId}
            className="flex items-center justify-between gap-3 rounded-md border px-3 py-2"
          >
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-sm">{member.name}</span>
              <span className="truncate text-[11px] text-muted-foreground">
                {member.email}
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-2">
              <span
                className={cn(
                  "flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider",
                  member.canEdit ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {member.canEdit ? <Pencil className="size-3" /> : null}
                {member.canEdit ? "Can edit" : "Read only"}
              </span>
              <form action={removeAction}>
                <input type="hidden" name="eventId" value={eventId} />
                <input type="hidden" name="folderId" value={folderId} />
                <input type="hidden" name="userId" value={member.userId} />
                <button
                  type="submit"
                  aria-label={`Remove ${member.name}`}
                  className="flex size-9 sm:size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-destructive"
                >
                  <X className="size-3.5" />
                </button>
              </form>
            </span>
          </li>
        ))}
      </ul>

      {removeState.error ? (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {removeState.error}
        </p>
      ) : null}

      {adding && candidates.length > 0 ? (
        <form action={addAction} className="flex flex-col gap-3 rounded-md border border-dashed p-3">
          <input type="hidden" name="eventId" value={eventId} />
          <input type="hidden" name="folderId" value={folderId} />
          <div className="flex flex-col gap-2">
            <Label className="text-xs">Person</Label>
            <UserSingleSelect name="userId" users={candidates} />
          </div>
          <label className="flex items-center gap-2.5 text-xs">
            <Switch name="canEdit" />
            Can upload and manage, not only read
          </label>
          {addState.error ? (
            <p role="alert" className="text-xs text-destructive">
              {addState.error}
            </p>
          ) : null}
          <Button type="submit" size="sm" disabled={addPending} className="self-start">
            {addPending ? "Adding…" : "Add to folder"}
          </Button>
        </form>
      ) : null}
    </div>
  );
}
