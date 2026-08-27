"use client";

import { useState } from "react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

// PIC + members for the EVENT itself, not tasks (Owner 2026-08-13). Chips,
// not native selects, per the project rule. Clicking the current PIC clears
// it; a member chip toggles. Someone picked as PIC drops out of the member
// row — one person, one hat.
export function EventPeoplePicker({
  people,
  defaultPicId = null,
  defaultMemberIds = [],
}: {
  people: Array<{ id: string; name: string }>;
  defaultPicId?: string | null;
  defaultMemberIds?: string[];
}) {
  const [picId, setPicId] = useState<string | null>(defaultPicId);
  const [memberIds, setMemberIds] = useState<string[]>(defaultMemberIds);

  const chip = (active: boolean) =>
    cn(
      "rounded-full border px-3 py-1.5 text-xs transition-all",
      active
        ? "border-foreground bg-foreground font-medium text-background"
        : "text-muted-foreground hover:border-foreground/40 hover:text-foreground",
    );

  return (
    <div className="flex flex-col gap-4">
      <input type="hidden" name="picId" value={picId ?? ""} />
      {memberIds
        .filter((id) => id !== picId)
        .map((id) => (
          <input key={id} type="hidden" name="memberIds" value={id} />
        ))}
      <div className="flex flex-col gap-2">
        <Label>PIC project</Label>
        <div className="flex flex-wrap gap-1.5">
          {people.map((person) => (
            <button
              key={person.id}
              type="button"
              aria-pressed={picId === person.id}
              onClick={() => setPicId((c) => (c === person.id ? null : person.id))}
              className={chip(picId === person.id)}
            >
              {person.name}
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <Label>Project members</Label>
        <div className="flex flex-wrap gap-1.5">
          {people
            .filter((person) => person.id !== picId)
            .map((person) => {
              const active = memberIds.includes(person.id);
              return (
                <button
                  key={person.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() =>
                    setMemberIds((ids) =>
                      active
                        ? ids.filter((id) => id !== person.id)
                        : [...ids, person.id],
                    )
                  }
                  className={chip(active)}
                >
                  {person.name}
                </button>
              );
            })}
        </div>
      </div>
    </div>
  );
}
