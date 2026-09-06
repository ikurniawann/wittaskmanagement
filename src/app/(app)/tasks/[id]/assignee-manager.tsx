"use client";

import { Check, UserPlus } from "lucide-react";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { assignAction, unassignAction } from "../actions";
import { UserAvatar } from "@/components/task-meta";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// Assignee popover (Owner request — better UX than select+button): one
// searchable member list, click to toggle on/off, instant server sync.
export function AssigneeManager({
  taskId,
  members,
  assignedIds,
  canAssign,
}: {
  taskId: string;
  members: Array<{ id: string; name: string }>;
  assignedIds: string[];
  canAssign: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [pending, startTransition] = useTransition();
  // optimistic view of assignments while the action round-trips
  const [assigned, setAssigned] = useState<Set<string>>(new Set(assignedIds));
  const ref = useRef<HTMLDivElement>(null);

  // reconcile with fresh server data during render (React's documented
  // "adjust state when props change" pattern — no effect needed)
  const [prevIds, setPrevIds] = useState(assignedIds);
  if (prevIds !== assignedIds) {
    setPrevIds(assignedIds);
    setAssigned(new Set(assignedIds));
  }

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    return members.filter((m) => m.name.toLowerCase().includes(q));
  }, [members, query]);

  const toggle = (userId: string) => {
    const isAssigned = assigned.has(userId);
    setAssigned((prev) => {
      const next = new Set(prev);
      if (isAssigned) next.delete(userId);
      else next.add(userId);
      return next;
    });
    const formData = new FormData();
    formData.set("taskId", taskId);
    formData.set("userId", userId);
    startTransition(async () => {
      await (isAssigned ? unassignAction(formData) : assignAction(formData));
    });
  };

  const assignedMembers = members.filter((m) => assigned.has(m.id));

  return (
    <div className="flex flex-wrap items-center gap-2">
      {assignedMembers.length === 0 ? (
        <span className="text-xs text-muted-foreground">Unassigned</span>
      ) : (
        assignedMembers.map((m) => (
          <span
            key={m.id}
            className="flex items-center gap-1.5 rounded-full border py-1 pl-1 pr-2.5 text-xs"
          >
            <UserAvatar name={m.name} />
            {m.name}
            {canAssign ? (
              <button
                type="button"
                onClick={() => toggle(m.id)}
                aria-label={`Unassign ${m.name}`}
                className="text-muted-foreground transition-colors hover:text-destructive"
              >
                ×
              </button>
            ) : null}
          </span>
        ))
      )}

      {canAssign ? (
        <div className="relative" ref={ref}>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setOpen((o) => !o)}
            className="gap-1.5 text-xs"
          >
            <UserPlus className="size-3.5" />
            Assign
          </Button>
          {open ? (
            <div className="absolute left-0 top-9 z-50 flex w-64 max-w-[calc(100vw-2rem)] flex-col gap-1 rounded-lg border bg-popover p-2 shadow-lg">
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search members…"
                autoFocus
                className="h-8 text-xs"
              />
              <ul className="flex max-h-56 flex-col overflow-y-auto">
                {filtered.length === 0 ? (
                  <li className="px-2 py-3 text-center text-xs text-muted-foreground">
                    No members match.
                  </li>
                ) : (
                  filtered.map((m) => {
                    const isAssigned = assigned.has(m.id);
                    return (
                      <li key={m.id}>
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => toggle(m.id)}
                          className={cn(
                            "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent",
                            isAssigned && "font-medium",
                          )}
                        >
                          <UserAvatar name={m.name} />
                          <span className="flex-1 truncate">{m.name}</span>
                          <Check
                            className={cn(
                              "size-3.5 transition-opacity",
                              isAssigned ? "opacity-100" : "opacity-0",
                            )}
                          />
                        </button>
                      </li>
                    );
                  })
                )}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
