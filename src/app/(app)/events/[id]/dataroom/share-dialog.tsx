"use client";

import { Check, Copy, Link2, Loader2, Share2, XCircle } from "lucide-react";
import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  createFolderShareAction,
  createShareAction,
  listFolderSharesAction,
  listSharesAction,
  revokeFolderShareAction,
  revokeShareAction,
  type ShareActionState,
} from "./actions";

// Share a document — or a whole folder (Owner 2026-08-27) — with someone
// outside the system (EPIC-018 T-182). The plaintext link exists once, right
// here; it is stored only as a hash.
//
// One dialog serves both because every gate is identical: the target only
// decides which action pair it talks to.

interface ShareRow {
  id: string;
  label: string | null;
  expiresAt: string;
  revokedAt: string | null;
  hasPasscode: boolean;
  allowDownload: boolean;
  allowedEmails: string[] | null;
  opens: number;
  expired: boolean;
  watermark: boolean;
  requireEmail: boolean;
}

export type ShareTarget = { kind: "file" | "folder"; id: string; name: string };

export function ShareDialog({
  eventId,
  target,
  onClose,
}: {
  eventId: string;
  target: ShareTarget;
  onClose: () => void;
}) {
  const isFolder = target.kind === "folder";
  const submitAction = isFolder ? createFolderShareAction : createShareAction;
  const listAction = isFolder ? listFolderSharesAction : listSharesAction;
  const revokeAction = isFolder ? revokeFolderShareAction : revokeShareAction;
  const idField = isFolder ? "folderId" : "fileId";
  const fileId = target.id;
  const fileName = target.name;
  const [links, setLinks] = useState<ShareRow[] | null>(null);
  const [copied, setCopied] = useState(false);
  const [state, formAction, pending] = useActionState<ShareActionState, FormData>(
    submitAction,
    {},
  );

  useEffect(() => {
    let alive = true;
    void listAction(fileId).then((rows) => {
      if (!alive) return;
      setLinks(
        rows.map((r) => ({
          ...r,
          expiresAt: r.expiresAt.toISOString(),
          revokedAt: r.revokedAt ? r.revokedAt.toISOString() : null,
        })),
      );
    });
    return () => {
      alive = false;
    };
    // listAction is fixed for the life of the dialog (the target never
    // changes shape underneath it), but it is listed so the rule stays honest
  }, [fileId, state.url, listAction]);

  const copy = async () => {
    if (!state.url) return;
    await navigator.clipboard.writeText(state.url);
    setCopied(true);
    toast.success("Link copied. It is not shown again.");
  };

  return (
    <div className="flex flex-col gap-4 rounded-md border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Share2 className="size-3.5 text-muted-foreground" />
            Share {isFolder ? "folder " : ""}“{fileName}” outside the system
          </h3>
          <p className="max-w-lg text-xs text-muted-foreground">
            The recipient needs no account. Every link expires, can be
            withdrawn, and records who opened it.
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose} className="text-muted-foreground">
          Close
        </Button>
      </div>

      {state.url ? (
        <div className="flex flex-col gap-2 rounded-md border border-status-done/40 bg-status-done/5 p-3">
          <span className="text-xs font-medium text-status-done">
            Link created. Copy it now — it is stored only as a hash and cannot
            be shown again.
          </span>
          <div className="flex items-center gap-2">
            <Input readOnly value={state.url} className="h-9 font-mono text-xs" />
            <Button size="sm" variant="outline" onClick={() => void copy()} className="gap-1.5">
              {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
        </div>
      ) : (
        <form action={formAction} className="grid gap-3 sm:grid-cols-2">
          <input type="hidden" name="eventId" value={eventId} />
          <input type="hidden" name={idField} value={fileId} />

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="sh-label" className="text-xs">
              Label — who is it for
            </Label>
            <Input id="sh-label" name="label" placeholder="Sound vendor" className="h-9" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="sh-days" className="text-xs">
              Expires after (days)
            </Label>
            <Input
              id="sh-days"
              name="expiryDays"
              defaultValue="14"
              inputMode="numeric"
              className="h-9"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="sh-pass" className="text-xs">
              Passcode — optional
            </Label>
            <Input id="sh-pass" name="passcode" className="h-9" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="sh-emails" className="text-xs">
              Only these emails — optional
            </Label>
            <Input
              id="sh-emails"
              name="allowedEmails"
              placeholder="vendor@company.com"
              className="h-9"
            />
          </div>

          <label className="flex items-center gap-2.5 text-xs sm:col-span-2">
            <Switch name="requireEmail" defaultChecked />
            Ask who is opening it
            <span className="text-muted-foreground">
              — turn this off and the activity log records only “Shared link”,
              so you lose the answer to who read the document
            </span>
          </label>

          <label className="flex items-center gap-2.5 text-xs sm:col-span-2">
            <Switch name="watermark" />
            Stamp the recipient&apos;s email on every page
            <span className="text-muted-foreground">
              — PDFs and images only; makes a leaked copy traceable, it does
              not prevent one
            </span>
          </label>

          <label className="flex items-center gap-2.5 text-xs sm:col-span-2">
            <Switch name="allowDownload" defaultChecked />
            Allow downloading
            <span className="text-muted-foreground">
              — turning this off hides the button, but anyone who can read a
              document can photograph it
            </span>
          </label>

          {state.error ? (
            <p role="alert" className="text-xs text-destructive sm:col-span-2">
              {state.error}
            </p>
          ) : null}
          <div className="sm:col-span-2">
            <Button type="submit" size="sm" disabled={pending} className="gap-1.5">
              {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Link2 className="size-3.5" />}
              Create link
            </Button>
          </div>
        </form>
      )}

      {links === null ? null : links.length === 0 ? (
        <p className="text-xs text-muted-foreground">No links yet.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {links.map((link) => {
            const dead = Boolean(link.revokedAt) || link.expired;
            return (
              <li
                key={link.id}
                className={cn(
                  "flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-xs",
                  dead && "opacity-60",
                )}
              >
                <span className="flex flex-col">
                  <span className="font-medium">{link.label ?? "Untitled link"}</span>
                  <span className="text-muted-foreground">
                    {link.revokedAt
                      ? "Withdrawn"
                      : link.expired
                        ? "Expired"
                        : `Expires ${new Date(link.expiresAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`}
                    {link.hasPasscode ? " · passcode" : ""}
                    {link.allowedEmails ? ` · ${link.allowedEmails.length} address(es)` : ""}
                    {link.allowDownload ? "" : " · view only"}
                    {link.watermark ? " · watermarked" : ""}
                    {link.requireEmail ? "" : " · anonymous"}
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  <span className="text-muted-foreground">
                    {link.opens} open{link.opens === 1 ? "" : "s"}
                  </span>
                  {dead ? null : (
                    <form action={revokeAction}>
                      <input type="hidden" name="eventId" value={eventId} />
                      <input type="hidden" name={idField} value={fileId} />
                      <input type="hidden" name="linkId" value={link.id} />
                      <button
                        type="submit"
                        className="flex items-center gap-1 text-muted-foreground transition-colors hover:text-destructive"
                      >
                        <XCircle className="size-3.5" /> Withdraw
                      </button>
                    </form>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
