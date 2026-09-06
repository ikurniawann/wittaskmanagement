"use client";

import { Crown, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { setLeadAction } from "../actions";
import { UserAvatar } from "@/components/task-meta";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// Single Lead/PIC picker (Owner 2026-08-07) — same popover language as the
// assignee manager, but radio semantics: picking someone replaces the lead.
export function LeadPicker({
  taskId,
  members,
  leadId,
  canAssign,
}: {
  taskId: string;
  members: Array<{ id: string; name: string }>;
  leadId: string | null;
  canAssign: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [, startTransition] = useTransition();
  // optimistic current lead while the action round-trips
  const [current, setCurrent] = useState<string | null>(leadId);
  const ref = useRef<HTMLDivElement>(null);

  // adjust-state-when-props-change (no effect)
  const [prevLead, setPrevLead] = useState(leadId);
  if (prevLead !== leadId) {
    setPrevLead(leadId);
    setCurrent(leadId);
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

  const commit = (userId: string | null) => {
    setCurrent(userId);
    setOpen(false);
    const formData = new FormData();
    formData.set("taskId", taskId);
    formData.set("userId", userId ?? "");
    startTransition(async () => {
      await setLeadAction(formData);
    });
  };

  const lead = members.find((m) => m.id === current);

  return (
    <div ref={ref} className="relative flex flex-wrap items-center gap-2">
      {lead ? (
        <span className="flex items-center gap-1.5 rounded-full border border-foreground/40 py-1 pl-1 pr-2.5 text-xs font-medium">
          <UserAvatar name={lead.name} />
          <Crown className="size-3 text-muted-foreground" aria-hidden />
          {lead.name}
          {canAssign ? (
            <button
              type="button"
              aria-label="Clear lead"
              onClick={() => commit(null)}
              className="ml-0.5 text-muted-foreground/60 hover:text-destructive"
            >
              <X className="size-3" />
            </button>
          ) : null}
        </span>
      ) : (
        <span className="text-xs text-muted-foreground">No lead yet</span>
      )}
      {canAssign ? (
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 text-xs"
          onClick={() => setOpen((o) => !o)}
        >
          <Crown className="size-3.5" />
          {lead ? "Change" : "Set lead"}
        </Button>
      ) : null}

      {open ? (
        <div className="absolute left-0 top-9 z-30 flex w-64 max-w-[calc(100vw-2rem)] flex-col gap-1 rounded-md border bg-popover p-2 shadow-md">
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search member…"
            className="h-8 text-xs"
          />
          <div className="flex max-h-56 flex-col overflow-y-auto">
            {filtered.map((member) => (
              <button
                key={member.id}
                type="button"
                onClick={() => commit(member.id)}
                className={cn(
                  "flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent",
                  member.id === current && "font-semibold",
                )}
              >
                <UserAvatar name={member.name} />
                <span className="min-w-0 flex-1 truncate">{member.name}</span>
                {member.id === current ? <Crown className="size-3.5" /> : null}
              </button>
            ))}
            {filtered.length === 0 ? (
              <p className="px-2 py-3 text-xs text-muted-foreground">
                No member matches.
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
