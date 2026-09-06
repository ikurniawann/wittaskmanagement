"use client";

import { Loader2, Plug } from "lucide-react";
import { useState, useTransition } from "react";
import { Switch } from "@/components/ui/switch";
import { setIntegrationAction } from "./actions";

// The Integrations tab. Admin-only — the page decides that, not this
// component, but it is worth saying here too: every switch below changes what
// the whole organisation sees, not the person flicking it.

export interface IntegrationRow {
  key: string;
  name: string;
  summary: string;
  configuredAt: string;
  enabled: boolean;
}

function Row({ row }: { row: IntegrationRow }) {
  const [on, setOn] = useState(row.enabled);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const toggle = (next: boolean) => {
    setOn(next); // optimistic: the switch should not lag the finger
    setError(null);
    start(async () => {
      const result = await setIntegrationAction(row.key, next);
      if (result?.error) {
        setOn(!next); // put it back rather than lie about the state
        setError(result.error);
      }
    });
  };

  return (
    <li className="flex items-start gap-4 px-4 py-3.5">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-center gap-2 text-sm font-medium">
          {row.name}
          {pending ? <Loader2 className="size-3 animate-spin text-muted-foreground" /> : null}
        </span>
        <span className="text-xs text-muted-foreground">{row.summary}</span>
        <span className="text-[11px] text-muted-foreground">
          {on ? `Settings: ${row.configuredAt}` : "Hidden across the app while off"}
        </span>
        {error ? (
          <span role="alert" className="text-[11px] text-destructive">
            {error}
          </span>
        ) : null}
      </div>
      <Switch
        checked={on}
        onCheckedChange={toggle}
        disabled={pending}
        aria-label={`${on ? "Disable" : "Enable"} ${row.name}`}
      />
    </li>
  );
}

export function IntegrationsPanel({ rows }: { rows: IntegrationRow[] }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Plug className="size-4 text-muted-foreground" /> Integrations
        </h2>
        <p className="text-xs text-muted-foreground">
          Outside services this workspace talks to. Everything starts off —
          turning one on reveals it across the app, turning it off hides it
          again without deleting anything it has already synced.
        </p>
      </div>
      <ul className="flex flex-col divide-y rounded-md border bg-card">
        {rows.map((row) => (
          <Row key={row.key} row={row} />
        ))}
      </ul>
    </div>
  );
}
