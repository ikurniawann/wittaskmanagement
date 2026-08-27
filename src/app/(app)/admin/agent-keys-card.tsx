"use client";

import { Bot, Copy, Loader2 } from "lucide-react";
import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  createAgentKeyAction,
  revokeAgentKeyAction,
  type AgentKeyActionState,
} from "./agent-actions";

// Agent API keys (EPIC-023). The plaintext appears exactly once — in the
// response of the create action — and is rendered until the page reloads.
// After that only the name, tail and usage stamps exist anywhere.

export function AgentKeysCard({
  keys,
}: {
  keys: Array<{
    id: string;
    name: string;
    tokenTail: string;
    createdAt: string;
    lastUsedAt: string | null;
    revokedAt: string | null;
  }>;
}) {
  const [state, createAction, creating] = useActionState<AgentKeyActionState, FormData>(
    createAgentKeyAction,
    {},
  );
  const [copied, setCopied] = useState(false);

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
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <Bot className="size-4" /> Agent API keys
      </h2>
      <p className="text-xs text-muted-foreground">
        For external agents (OpenClaw / Hermes / n8n). A key only proves which
        agent is calling — every request must also carry{" "}
        <code className="rounded bg-muted px-1">X-On-Behalf-Of: &lt;nomor WA&gt;</code>{" "}
        naming the person speaking, and runs with that person&apos;s permissions.
        A key alone can read nothing.
      </p>

      {state.token ? (
        <div className="flex flex-col gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3">
          <span className="text-xs font-medium">
            Copy this now — it will never be shown again:
          </span>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded bg-background px-2 py-1.5 font-mono text-xs">
              {state.token}
            </code>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={() => {
                navigator.clipboard.writeText(state.token ?? "");
                setCopied(true);
              }}
            >
              <Copy className="size-3.5" /> {copied ? "Copied" : "Copy"}
            </Button>
          </div>
        </div>
      ) : null}

      <form action={createAction} className="flex flex-wrap items-end gap-2">
        <div className="flex min-w-56 flex-1 flex-col gap-1.5">
          <label htmlFor="agent-key-name" className="text-xs font-medium">
            New key name
          </label>
          <Input id="agent-key-name" name="name" required placeholder="openclaw-wa" />
        </div>
        <Button type="submit" size="sm" disabled={creating} className="gap-1.5">
          {creating ? <Loader2 className="size-3.5 animate-spin" /> : null}
          Create key
        </Button>
      </form>
      {state.error ? (
        <p role="alert" className="text-xs text-destructive">
          {state.error}
        </p>
      ) : null}

      {keys.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          {keys.map((key) => (
            <div
              key={key.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-xs"
            >
              <span className="flex items-center gap-2">
                <span className="font-medium">{key.name}</span>
                <code className="text-muted-foreground">…{key.tokenTail}</code>
                {key.revokedAt ? (
                  <span className="rounded-full border border-destructive/40 px-1.5 text-[10px] uppercase text-destructive">
                    revoked
                  </span>
                ) : null}
              </span>
              <span className="flex items-center gap-3 text-muted-foreground">
                <span>
                  {key.lastUsedAt
                    ? `last used ${stamp(key.lastUsedAt)} WIB`
                    : "never used"}
                </span>
                {!key.revokedAt ? (
                  <form action={revokeAgentKeyAction}>
                    <input type="hidden" name="keyId" value={key.id} />
                    <button
                      type="submit"
                      className="text-muted-foreground underline-offset-4 hover:text-destructive hover:underline"
                    >
                      Revoke
                    </button>
                  </form>
                ) : null}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
