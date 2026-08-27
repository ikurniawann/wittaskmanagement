"use client";

import { Check, Copy, Link2, Loader2, XCircle } from "lucide-react";
import { useActionState, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  createSummaryShareAction,
  listSummarySharesAction,
  revokeSummaryShareAction,
  type SummaryShareState,
} from "./actions";

// A read-only progress link (Owner 2026-08-27). Same gates as the dataroom's
// share dialog, minus the file-only ones (download, watermark) — there is no
// file here, only numbers.

interface Row {
  id: string;
  label: string | null;
  expiresAt: string;
  revokedAt: string | null;
  hasPasscode: boolean;
  requireEmail: boolean;
  allowedEmails: string[] | null;
  opens: number;
  lastViewedAt: string | null;
  expired: boolean;
}

const dt = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: "Asia/Jakarta",
});

export function SummaryShareDialog({
  kind,
  targetId,
  targetName,
  onClose,
}: {
  kind: "project" | "task";
  targetId: string;
  targetName: string;
  onClose: () => void;
}) {
  const [state, formAction, pending] = useActionState<SummaryShareState, FormData>(
    createSummaryShareAction,
    {},
  );
  const [links, setLinks] = useState<Row[]>([]);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    void listSummarySharesAction(kind, targetId).then((rows) => {
      if (!alive) return;
      setLinks(
        rows.map((r) => ({
          ...r,
          expiresAt: r.expiresAt.toISOString(),
          revokedAt: r.revokedAt ? r.revokedAt.toISOString() : null,
          lastViewedAt: r.lastViewedAt ? r.lastViewedAt.toISOString() : null,
        })),
      );
    });
    return () => {
      alive = false;
    };
  }, [kind, targetId, state.url]);

  const copy = async () => {
    if (!state.url) return;
    await navigator.clipboard.writeText(state.url);
    setCopied(true);
    toast.success("Link copied");
    setTimeout(() => setCopied(false), 1500);
  };

  // Portalled to <body> for the same reason EditTaskForm is: this dialog opens
  // from inside the task drawer, whose slide animation uses a CSS transform,
  // and a transformed ancestor becomes the containing block for
  // position:fixed descendants — so without the portal it centres on the
  // DRAWER and is clipped at its edge (Owner bug report 2026-08-27).
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[85svh] w-full max-w-lg flex-col gap-4 overflow-y-auto rounded-lg border bg-card p-5 shadow-lg">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-sm font-semibold">
            Share {kind === "task" ? "task" : "project"} progress
          </h2>
          <p className="text-xs text-muted-foreground">
            A read-only page for “{targetName}”. No budget figures, no names, no
            comments — progress only.
          </p>
        </div>

        {state.url ? (
          <div className="flex flex-col gap-2 rounded-md border bg-accent/30 p-3">
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
              The link is shown once
            </span>
            <div className="flex items-center gap-2">
              <Input readOnly value={state.url} className="h-8 flex-1 text-xs" />
              <Button size="sm" variant="outline" onClick={copy} className="h-8 gap-1.5">
                {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
          </div>
        ) : (
          <form action={formAction} className="flex flex-col gap-3">
            <input type="hidden" name="kind" value={kind} />
            <input type="hidden" name="targetId" value={targetId} />

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ss-label" className="text-xs">
                Label — who is this for?
              </Label>
              <Input id="ss-label" name="label" placeholder="Client PT Nusantara" className="h-8 text-xs" />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ss-expiry" className="text-xs">
                  Expires in (days)
                </Label>
                <Input
                  id="ss-expiry"
                  name="expiryDays"
                  type="number"
                  min={1}
                  max={365}
                  defaultValue={14}
                  className="h-8 text-xs"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ss-passcode" className="text-xs">
                  Passcode (optional)
                </Label>
                <Input id="ss-passcode" name="passcode" type="text" className="h-8 text-xs" />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ss-emails" className="text-xs">
                Only these emails (optional, comma separated)
              </Label>
              <Input
                id="ss-emails"
                name="allowedEmails"
                placeholder="klien@contoh.com, pm@contoh.com"
                className="h-8 text-xs"
              />
            </div>

            <label className="flex items-center gap-2 text-xs">
              <Switch name="requireEmail" defaultChecked />
              Ask who they are before the page opens
            </label>

            {state.error ? (
              <p role="alert" className="text-xs text-destructive">
                {state.error}
              </p>
            ) : null}

            <Button type="submit" size="sm" disabled={pending} className="gap-1.5">
              {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Link2 className="size-3.5" />}
              {pending ? "Creating…" : "Create link"}
            </Button>
          </form>
        )}

        {links.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
              Existing links
            </span>
            <ul className="flex flex-col divide-y rounded-md border">
              {links.map((l) => {
                const dead = l.revokedAt !== null || l.expired;
                return (
                  <li key={l.id} className="flex items-center gap-2 px-3 py-2 text-xs">
                    <span className="min-w-0 flex-1 truncate">
                      {l.label ?? "Untitled link"}
                      <span className="ml-1.5 text-muted-foreground">
                        {l.revokedAt
                          ? "· withdrawn"
                          : l.expired
                            ? "· expired"
                            : `· until ${dt.format(new Date(l.expiresAt))}`}
                      </span>
                    </span>
                    <span className="shrink-0 text-muted-foreground">
                      {l.opens} open{l.opens === 1 ? "" : "s"}
                    </span>
                    {dead ? null : (
                      <form action={revokeSummaryShareAction}>
                        <input type="hidden" name="kind" value={kind} />
                        <input type="hidden" name="targetId" value={targetId} />
                        <input type="hidden" name="linkId" value={l.id} />
                        <button
                          type="submit"
                          title="Withdraw this link"
                          className="flex items-center text-muted-foreground transition-colors hover:text-destructive"
                        >
                          <XCircle className="size-3.5" />
                        </button>
                      </form>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}

        <div className="flex justify-end">
          <Button size="sm" variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
