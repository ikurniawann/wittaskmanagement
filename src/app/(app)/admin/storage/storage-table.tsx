"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatBytes } from "@/lib/dataroom/quota";
import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";
import {
  setDefaultQuotaAction,
  setEventQuotaAction,
  type StorageActionState,
} from "./actions";

/** Client-side so an invalid figure reports itself instead of throwing. */
export function DefaultQuotaForm({ defaultGb }: { defaultGb: number }) {
  const [state, formAction, pending] = useActionState<StorageActionState, FormData>(
    setDefaultQuotaAction,
    {},
  );
  return (
    <form action={formAction} className="flex flex-col gap-1.5">
      <Label htmlFor="default-gb" className="text-xs">
        Default for every project without its own limit
      </Label>
      <span className="flex items-center gap-1.5">
        <Input
          id="default-gb"
          name="defaultGb"
          defaultValue={String(defaultGb)}
          inputMode="decimal"
          className="h-9 w-28"
        />
        <span className="text-sm text-muted-foreground">GB</span>
        <Button type="submit" size="sm" variant="outline" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
      </span>
      {state.error ? (
        <span role="alert" className="text-[11px] text-destructive">
          {state.error}
        </span>
      ) : null}
    </form>
  );
}

const GIB = 1024 ** 3;

export interface StorageRow {
  eventId: string;
  eventName: string;
  usedBytes: number;
  limitBytes: number;
  hasOverride: boolean;
  ratio: number;
  level: "ok" | "warning" | "full";
}

function QuotaCell({ row }: { row: StorageRow }) {
  const [value, setValue] = useState(
    row.hasOverride ? String(Math.round((row.limitBytes / GIB) * 10) / 10) : "",
  );
  const [state, formAction, pending] = useActionState<StorageActionState, FormData>(
    setEventQuotaAction,
    {},
  );

  return (
    <form action={formAction} className="flex flex-col gap-1">
      <input type="hidden" name="eventId" value={row.eventId} />
      <span className="flex items-center gap-1.5">
        <Input
          name="limitGb"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="default"
          inputMode="decimal"
          aria-label={`Storage limit for ${row.eventName}, in GB`}
          className="h-8 w-24 text-xs"
        />
        <span className="text-xs text-muted-foreground">GB</span>
        <Button type="submit" size="sm" variant="ghost" disabled={pending} className="h-7 text-xs">
          {pending ? "…" : "Save"}
        </Button>
      </span>
      {state.error ? (
        <span role="alert" className="text-[10px] text-destructive">
          {state.error}
        </span>
      ) : !row.hasOverride ? (
        <span className="text-[10px] text-muted-foreground">Following the default</span>
      ) : null}
    </form>
  );
}

export function StorageTable({ rows }: { rows: StorageRow[] }) {
  return (
    <div className="overflow-x-auto rounded-md border bg-card">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs uppercase tracking-wider text-muted-foreground">
            <th className="px-4 py-3 font-medium">Project</th>
            <th className="px-4 py-3 font-medium">Used</th>
            <th className="px-4 py-3 font-medium">Limit</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.eventId} className="border-b transition-colors last:border-0 hover:bg-accent/30">
              <td className="px-4 py-3 font-medium">{row.eventName}</td>
              <td className="px-4 py-3">
                <div className="flex min-w-40 flex-col gap-1">
                  <span
                    className={cn(
                      "text-xs",
                      row.level === "full"
                        ? "font-medium text-destructive"
                        : row.level === "warning"
                          ? "font-medium text-priority-high"
                          : "text-muted-foreground",
                    )}
                  >
                    {formatBytes(row.usedBytes)} of {formatBytes(row.limitBytes)}
                  </span>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className={cn(
                        "h-full",
                        row.level === "full"
                          ? "bg-destructive"
                          : row.level === "warning"
                            ? "bg-priority-high"
                            : "bg-foreground/60",
                      )}
                      style={{ width: `${Math.round(row.ratio * 100)}%` }}
                    />
                  </div>
                </div>
              </td>
              <td className="px-4 py-3">
                <QuotaCell row={row} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
