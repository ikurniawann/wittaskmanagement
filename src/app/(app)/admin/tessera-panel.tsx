"use client";

import { Loader2, Plug, RefreshCw, Ticket } from "lucide-react";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  saveTesseraAction,
  syncTesseraNowAction,
  testTesseraAction,
  type TesseraActionState,
} from "./tessera-actions";

// Tessera connection panel (Owner 2026-08-12). The token is write-only from
// here: once saved it never comes back to the browser — the panel shows only
// that one exists, its age against the ~5-day lifetime, and when it last
// worked.

export function TesseraPanel({
  configured,
  savedAt,
  lastOkAt,
  lastError,
  unreadableSample,
  daysLeft,
}: {
  configured: boolean;
  savedAt: string | null;
  lastOkAt: string | null;
  lastError: string | null;
  unreadableSample: string | null;
  /** estimated days before the ~5-day token dies; null when unknown */
  daysLeft: number | null;
}) {
  const [saveState, saveAction, saving] = useActionState<TesseraActionState, FormData>(
    saveTesseraAction,
    {},
  );
  const [testState, testAction, testing] = useActionState<TesseraActionState, FormData>(
    testTesseraAction,
    {},
  );
  const [syncState, syncAction, syncing] = useActionState<TesseraActionState, FormData>(
    syncTesseraNowAction,
    {},
  );

  const expiringSoon = daysLeft !== null && daysLeft <= 1;

  return (
    <div className="flex flex-col gap-4 rounded-md border bg-card p-4 elev">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Ticket className="size-4 text-muted-foreground" /> Tessera ticketing
          </h2>
          <p className="max-w-xl text-xs text-muted-foreground">
            Pulls ticket sales for mapped projects into the same daily snapshots
            the manual form writes — project health, the dashboard and the AI
            read on unchanged. Uses Tessera&apos;s dashboard endpoints (no
            public API yet), so it may break without notice.
          </p>
        </div>
        <span
          className={cn(
            "flex shrink-0 items-center gap-2 rounded-full border px-2.5 py-1 text-xs",
            lastError && "border-destructive/40 text-destructive",
          )}
        >
          <span
            className={cn(
              "size-2 rounded-full",
              !configured
                ? "bg-muted-foreground/50"
                : lastError
                  ? "bg-status-blocked"
                  : "bg-status-done",
            )}
          />
          {!configured ? "Not connected" : lastError ? "Failing" : "Connected"}
        </span>
      </div>

      {configured ? (
        <p className="text-xs text-muted-foreground">
          Token saved {savedAt ? new Date(savedAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" }) : "—"}
          {daysLeft !== null ? (
            <span className={cn("ml-1.5", expiringSoon && "font-semibold text-priority-high")}>
              · ~{Math.max(0, daysLeft)} day{daysLeft === 1 ? "" : "s"} of the ~5-day lifetime left
            </span>
          ) : null}
          {lastOkAt ? ` · last worked ${new Date(lastOkAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" })}` : null}
        </p>
      ) : null}

      {lastError ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {lastError}
        </p>
      ) : null}
      {unreadableSample ? (
        <details className="rounded-md border border-dashed p-2 text-xs">
          <summary className="cursor-pointer text-muted-foreground">
            The response could not be read — raw sample for debugging
          </summary>
          <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-all text-[10px]">
            {unreadableSample}
          </pre>
        </details>
      ) : null}

      <form action={saveAction} className="grid gap-3 sm:grid-cols-[1fr_240px_auto]">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ts-token" className="text-xs">
            Access token — from DevTools → Network → authorization header
          </Label>
          <Input
            id="ts-token"
            name="token"
            type="password"
            placeholder={configured ? "•••••• (paste a new one to replace)" : "Bearer eyJhbGci…"}
            autoComplete="off"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ts-org" className="text-xs">
            Organization id
          </Label>
          <Input id="ts-org" name="orgId" placeholder="from the dashboard URL" />
        </div>
        <div className="flex items-end">
          <Button type="submit" size="sm" disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </form>
      {saveState.error ? (
        <p role="alert" className="text-xs text-destructive">{saveState.error}</p>
      ) : null}
      {saveState.ok ? (
        <p className="text-xs text-status-done">Saved. Now run the connection test.</p>
      ) : null}

      {configured ? (
        <div className="flex flex-wrap items-center gap-2">
          <form action={testAction}>
            <Button type="submit" size="sm" variant="outline" disabled={testing} className="gap-1.5">
              {testing ? <Loader2 className="size-3.5 animate-spin" /> : <Plug className="size-3.5" />}
              Test connection
            </Button>
          </form>
          <form action={syncAction}>
            <Button type="submit" size="sm" variant="outline" disabled={syncing} className="gap-1.5">
              {syncing ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
              Sync now
            </Button>
          </form>
          {testState.eventCount !== undefined ? (
            <span className="text-xs text-status-done">
              {testState.eventCount} event(s) readable
              {testState.eventNames?.length ? ` — ${testState.eventNames.join(", ")}` : ""}
            </span>
          ) : null}
          {testState.error ? (
            <span role="alert" className="text-xs text-destructive">{testState.error}</span>
          ) : null}
          {syncState.ok ? (
            <span className="text-xs text-status-done">
              Synced {syncState.eventCount} event(s).
            </span>
          ) : null}
          {syncState.error ? (
            <span role="alert" className="text-xs text-destructive">{syncState.error}</span>
          ) : null}
        </div>
      ) : null}

      <p className="text-[11px] text-muted-foreground">
        The token expires after about five days; the sync then stops and every
        admin gets a notification. Sales land hourly against each mapped project
        — map an event from its Tickets page.
      </p>
    </div>
  );
}
