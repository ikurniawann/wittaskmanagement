"use client";

import { Loader2, Plug, RefreshCw, Ticket, Trash2 } from "lucide-react";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  clearMegatixAction,
  saveMegatixAction,
  syncMegatixNowAction,
  testMegatixAction,
  type MegatixActionState,
} from "./megatix-actions";

// Megatix connection panel (Owner 2026-08-17), the second ticketing channel.
//
// Unlike Tessera there is no token to re-paste: Megatix issues an ~8-hour
// token from an email + password login, and the server logs in again by
// itself. The password is write-only from here — once saved it never returns
// to a browser, and this panel shows only which email is connected.

export function MegatixPanel({
  configured,
  email,
  baseUrl,
  savedAt,
  tokenValidUntil,
  tokenLive,
  lastOkAt,
  lastError,
  unreadableSample,
}: {
  configured: boolean;
  email: string | null;
  baseUrl: string;
  savedAt: string | null;
  tokenValidUntil: string | null;
  /** computed server-side: Date.now() during render is impure */
  tokenLive: boolean;
  lastOkAt: string | null;
  lastError: string | null;
  unreadableSample: string | null;
}) {
  const [saveState, saveAction, saving] = useActionState<MegatixActionState, FormData>(
    saveMegatixAction,
    {},
  );
  const [testState, testAction, testing] = useActionState<MegatixActionState, FormData>(
    testMegatixAction,
    {},
  );
  const [syncState, syncAction, syncing] = useActionState<MegatixActionState, FormData>(
    syncMegatixNowAction,
    {},
  );
  const [clearState, clearAction, clearing] = useActionState<MegatixActionState, FormData>(
    clearMegatixAction,
    {},
  );

  const stamp = (iso: string | null) =>
    iso
      ? new Date(iso).toLocaleString("en-GB", {
          day: "numeric",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
          timeZone: "Asia/Jakarta",
        })
      : null;

  return (
    <section className="flex flex-col gap-4 rounded-md border bg-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Ticket className="size-4" /> Megatix ticketing
        </h2>
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium",
            !configured
              ? "border-border bg-muted/40 text-muted-foreground"
              : lastError
                ? "border-destructive/40 bg-destructive/10 text-destructive"
                : "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
          )}
        >
          <span
            aria-hidden
            className={cn(
              "size-1.5 rounded-full",
              !configured
                ? "bg-muted-foreground/50"
                : lastError
                  ? "bg-destructive"
                  : "bg-emerald-500",
            )}
          />
          {!configured ? "Not connected" : lastError ? "Last call failed" : "Connected"}
        </span>
      </div>

      <p className="text-xs text-muted-foreground">
        Megatix signs in with an email and password and issues a token that
        lasts about eight hours, so this connection renews itself — there is
        nothing to re-paste every few days.{" "}
        <strong className="font-medium text-foreground">
          Use a dedicated Megatix login for this, not a personal admin account:
        </strong>{" "}
        the password is stored on this server, and anything that can read the
        database could act as that user on Megatix.
      </p>

      {configured ? (
        <div className="flex flex-col gap-1 rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          <span>
            Connected as <span className="font-medium text-foreground">{email}</span>{" "}
            · {baseUrl}
          </span>
          {savedAt ? <span>Saved {stamp(savedAt)} WIB</span> : null}
          <span>
            {tokenLive
              ? `Session token valid until ${stamp(tokenValidUntil)} WIB — renewed automatically.`
              : "No live session token — the next sync will sign in again."}
          </span>
          {lastOkAt ? <span>Last successful call {stamp(lastOkAt)} WIB</span> : null}
        </div>
      ) : null}

      <form action={saveAction} className="flex flex-col gap-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="mgx-email">Megatix email</Label>
            <Input
              id="mgx-email"
              name="email"
              type="email"
              required
              defaultValue={email ?? ""}
              placeholder="api@yourcompany.com"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="mgx-password">Password</Label>
            <Input
              id="mgx-password"
              name="password"
              type="password"
              required
              autoComplete="new-password"
              placeholder={configured ? "•••••••• (re-enter to change)" : ""}
            />
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="mgx-base">API base URL</Label>
          <Input
            id="mgx-base"
            name="baseUrl"
            defaultValue={baseUrl}
            placeholder="https://megatix.com.au"
          />
          <span className="text-[11px] text-muted-foreground">
            Verified default. Change it only if your Megatix account lives on
            a different regional host.
          </span>
        </div>
        {saveState.error ? (
          <p role="alert" className="text-xs text-destructive">
            {saveState.error}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" size="sm" disabled={saving}>
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : null}
            {configured ? "Update credentials" : "Connect"}
          </Button>
        </div>
      </form>

      <div className="flex flex-wrap items-center gap-2 border-t pt-3">
        <form action={testAction}>
          <Button type="submit" size="sm" variant="outline" disabled={testing} className="gap-1.5">
            {testing ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Plug className="size-3.5" />
            )}
            Test connection
          </Button>
        </form>
        <form action={syncAction}>
          <Button type="submit" size="sm" variant="outline" disabled={syncing} className="gap-1.5">
            {syncing ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <RefreshCw className="size-3.5" />
            )}
            Sync now
          </Button>
        </form>
        {configured ? (
          <form action={clearAction}>
            <Button
              type="submit"
              size="sm"
              variant="ghost"
              disabled={clearing}
              className="gap-1.5 text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="size-3.5" /> Disconnect
            </Button>
          </form>
        ) : null}
      </div>

      {testState.error || syncState.error || clearState.error ? (
        <p role="alert" className="text-xs text-destructive">
          {testState.error ?? syncState.error ?? clearState.error}
        </p>
      ) : null}
      {testState.ok ? (
        <p className="text-xs text-muted-foreground">
          {testState.presenterCount} presenter(s) readable
          {testState.presenterNames?.length
            ? ` — ${testState.presenterNames.join(", ")}`
            : ""}
          .
        </p>
      ) : null}
      {syncState.ok ? (
        <p className="text-xs text-muted-foreground">
          Synced {syncState.syncedCount ?? 0} connected event(s).
        </p>
      ) : null}
      {lastError ? (
        <p className="text-xs text-destructive">Last error: {lastError}</p>
      ) : null}
      {unreadableSample ? (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">
            What Megatix actually returned (truncated)
          </summary>
          <pre className="mt-1 overflow-x-auto rounded bg-muted/50 p-2 text-[10px]">
            {unreadableSample}
          </pre>
        </details>
      ) : null}
    </section>
  );
}
