"use client";

import { useState } from "react";
import { UserAvatar } from "@/components/task-meta";
import { cn } from "@/lib/utils";

// Multi-user picker (Owner request): clickable avatar chips instead of a
// native multi-select. Each selected user submits as one `name` entry.
// LeadPicker below is its single-select sibling (one Lead/PIC per task).
export function AssigneePicker({
  name = "assignees",
  members,
}: {
  name?: string;
  members: Array<{ id: string; name: string }>;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (members.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No members in this division yet.
      </p>
    );
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {[...selected].map((id) => (
        <input key={id} type="hidden" name={name} value={id} />
      ))}
      {members.map((member) => {
        const active = selected.has(member.id);
        return (
          <button
            key={member.id}
            type="button"
            onClick={() => toggle(member.id)}
            aria-pressed={active}
            className={cn(
              "flex items-center gap-1.5 rounded-full border py-1 pl-1 pr-2.5 text-xs transition-colors",
              active
                ? "border-foreground bg-surface-2 font-medium"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <UserAvatar name={member.name} />
            {member.name}
            {active ? <span aria-hidden>✓</span> : null}
          </button>
        );
      })}
    </div>
  );
}

// Single-select variant for the Lead/PIC (Owner 2026-08-07). Submits one
// hidden `leadId`; clicking the active chip clears it.
export function LeadSelect({
  name = "leadId",
  members,
}: {
  name?: string;
  members: Array<{ id: string; name: string }>;
}) {
  const [selected, setSelected] = useState<string | null>(null);

  if (members.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No members in this division yet.
      </p>
    );
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {selected ? <input type="hidden" name={name} value={selected} /> : null}
      {members.map((member) => {
        const active = selected === member.id;
        return (
          <button
            key={member.id}
            type="button"
            onClick={() => setSelected(active ? null : member.id)}
            aria-pressed={active}
            className={cn(
              "flex items-center gap-1.5 rounded-full border py-1 pl-1 pr-2.5 text-xs transition-colors",
              active
                ? "border-foreground bg-surface-2 font-medium"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <UserAvatar name={member.name} />
            {member.name}
            {active ? <span aria-hidden>★</span> : null}
          </button>
        );
      })}
    </div>
  );
}
