"use client";

import { useState } from "react";
import { Segmented } from "@/components/segmented";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const ENTITY_TYPES = [
  "profile",
  "division",
  "event",
  "task",
  "handoff",
  "approval",
  "budget_line",
  "expense",
];

function ChipRow({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: Array<{ id: string; label: string }>;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      <button
        type="button"
        onClick={() => onChange("")}
        aria-pressed={value === ""}
        className={cn(
          "rounded-full border px-2.5 py-1 text-xs transition-all",
          value === ""
            ? "border-foreground bg-foreground font-medium text-background"
            : "text-muted-foreground hover:border-foreground/40 hover:text-foreground",
        )}
      >
        Any
      </button>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(o.id)}
          aria-pressed={value === o.id}
          className={cn(
            "rounded-full border px-2.5 py-1 text-xs transition-all",
            value === o.id
              ? "border-foreground bg-foreground font-medium text-background"
              : "text-muted-foreground hover:border-foreground/40 hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// Audit log filters (Owner directive: no native <select> for actions).
// Still a plain GET form — reload on submit, no client fetch — but every
// control is a styled chip/segmented row instead of a basic dropdown.
export function AuditFilterBar({
  users,
  events,
  defaults,
}: {
  users: Array<{ id: string; name: string }>;
  events: Array<{ id: string; name: string }>;
  defaults: { actor: string; entity: string; event: string; from: string; to: string };
}) {
  const [actor, setActor] = useState(defaults.actor);
  const [entity, setEntity] = useState(defaults.entity);
  const [eventId, setEventId] = useState(defaults.event);
  const hasFilter = Boolean(
    defaults.actor || defaults.entity || defaults.event || defaults.from || defaults.to,
  );

  return (
    <form method="GET" className="flex flex-col gap-3 rounded-md border bg-card p-3">
      <input type="hidden" name="actor" value={actor} />
      <input type="hidden" name="event" value={eventId} />
      <input type="hidden" name="entity" value={entity} />
      <div className="flex flex-col gap-1.5">
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
          Entity
        </span>
        <Segmented
          name="entity_ui"
          defaultValue={entity || "any"}
          onValueChange={(v) => setEntity(v === "any" ? "" : v)}
          options={[
            { value: "any", label: "Any" },
            ...ENTITY_TYPES.map((t) => ({ value: t, label: t })),
          ]}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
          Actor
        </span>
        <ChipRow
          value={actor}
          onChange={setActor}
          options={users.map((u) => ({ id: u.id, label: u.name }))}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
          Project
        </span>
        <ChipRow
          value={eventId}
          onChange={setEventId}
          options={events.map((e) => ({ id: e.id, label: e.name }))}
        />
      </div>
      <div className="flex flex-wrap items-end gap-2 pt-1">
        <div className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
            From
          </span>
          <Input type="date" name="from" defaultValue={defaults.from} className="h-8 w-36 text-xs" />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
            To
          </span>
          <Input type="date" name="to" defaultValue={defaults.to} className="h-8 w-36 text-xs" />
        </div>
        <Button type="submit" size="sm">
          Apply filters
        </Button>
        {hasFilter ? (
          <a
            href="/admin/audit"
            className="text-xs text-muted-foreground hover:underline"
          >
            Reset
          </a>
        ) : null}
      </div>
    </form>
  );
}
