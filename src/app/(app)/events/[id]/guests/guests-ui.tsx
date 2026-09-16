"use client";

import { useActionState, useState } from "react";
import { ChipMultiSelect } from "@/components/choice-chips";
import { UserAvatar } from "@/components/task-meta";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FORM_DEFINITIONS, FORM_TYPES } from "@/lib/external/forms";
import { cn } from "@/lib/utils";
import {
  inviteAction,
  reviewAction,
  revokeAction,
  type GuestAdminState,
} from "./actions";

export function InviteForm({
  eventId,
  divisions,
}: {
  eventId: string;
  divisions: Array<{ id: string; name: string }>;
}) {
  const [open, setOpen] = useState(false);
  const [division, setDivision] = useState(divisions[0]?.id ?? "");
  const [state, formAction, pending] = useActionState<GuestAdminState, FormData>(
    inviteAction,
    {},
  );

  if (!open) {
    return (
      <div className="flex flex-col gap-3">
        <div>
          <Button onClick={() => setOpen(true)}>Invite a guest ↗</Button>
        </div>
        {state.magicLink ? (
          <p className="rounded-card bg-card shadow-card px-3 py-2 text-xs">
            Invite sent by email. Dev link:{" "}
            <span className="break-all font-mono">{state.magicLink}</span>
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <form
      action={formAction}
      className="flex flex-col gap-4 rounded-card bg-card shadow-card p-4"
    >
      <input type="hidden" name="eventId" value={eventId} />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="gi-name">Name / company</Label>
          <Input id="gi-name" name="name" required placeholder="Sound Supply Co." />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="gi-email">Email</Label>
          <Input id="gi-email" name="email" type="email" required />
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>Division</Label>
        <div className="flex flex-wrap gap-1.5">
          {divisions.map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => setDivision(d.id)}
              aria-pressed={division === d.id}
              className={cn(
                "rounded-full border px-3 py-1 text-xs transition-all",
                division === d.id
                  ? "border-foreground bg-foreground font-medium text-background"
                  : "text-muted-foreground hover:border-foreground/40 hover:text-foreground",
              )}
            >
              {d.name}
            </button>
          ))}
        </div>
        <input type="hidden" name="divisionId" value={division} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>Request these forms</Label>
        <ChipMultiSelect
          name="requestedForms"
          options={FORM_TYPES.map((t) => ({
            value: t,
            label: FORM_DEFINITIONS[t].title,
          }))}
        />
      </div>
      {state.error ? (
        <p role="alert" className="text-sm text-destructive">{state.error}</p>
      ) : null}
      <div className="flex gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Sending…" : "Send invite"}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          Close
        </Button>
      </div>
    </form>
  );
}

export function InviteList({
  eventId,
  invites,
}: {
  eventId: string;
  invites: Array<{
    id: string;
    guestName: string;
    guestEmail: string;
    divisionName: string;
    requestedForms: string[];
    expiresAt: string;
    revoked: boolean;
    expired: boolean;
  }>;
}) {
  if (invites.length === 0) {
    return (
      <p className="rounded-card bg-card shadow-card px-4 py-6 text-sm text-muted-foreground">
        No guests invited yet.
      </p>
    );
  }
  return (
    <ul className="flex flex-col divide-y rounded-card bg-card shadow-card">
      {invites.map((invite) => (
        <li
          key={invite.id}
          className={cn(
            "flex flex-wrap items-center gap-3 px-4 py-3",
            (invite.revoked || invite.expired) && "opacity-50",
          )}
        >
          <UserAvatar name={invite.guestName} className="size-7 text-[10px]" />
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-sm font-medium">{invite.guestName}</span>
            <span className="truncate text-xs text-muted-foreground">
              {invite.guestEmail} · {invite.divisionName}
            </span>
          </div>
          <span className="text-xs text-muted-foreground">
            {invite.requestedForms.length} form
            {invite.requestedForms.length === 1 ? "" : "s"}
          </span>
          <span
            className={cn(
              "text-[10px] font-medium uppercase tracking-widest",
              invite.revoked
                ? "text-status-blocked"
                : invite.expired
                  ? "text-muted-foreground"
                  : "text-status-done",
            )}
          >
            {invite.revoked ? "Revoked" : invite.expired ? "Expired" : "Active"}
          </span>
          {!invite.revoked && !invite.expired ? (
            <form action={revokeAction}>
              <input type="hidden" name="eventId" value={eventId} />
              <input type="hidden" name="inviteId" value={invite.id} />
              <Button type="submit" size="sm" variant="ghost" className="text-xs">
                Revoke
              </Button>
            </form>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

const REVIEW_STATUS: Record<string, { label: string; className: string }> = {
  submitted: { label: "Awaiting review", className: "text-status-in-progress" },
  accepted: { label: "Accepted", className: "text-status-done" },
  changes_requested: { label: "Changes requested", className: "text-status-in-review" },
};

export function SubmissionReviewList({
  eventId,
  submissions,
}: {
  eventId: string;
  submissions: Array<{
    id: string;
    type: string;
    status: string;
    data: Record<string, string>;
    guestName: string;
    divisionName: string;
    submittedAt: string | null;
    reviewNote: string;
  }>;
}) {
  const [state, formAction, pending] = useActionState<GuestAdminState, FormData>(
    reviewAction,
    {},
  );
  const [openId, setOpenId] = useState<string | null>(null);

  if (submissions.length === 0) {
    return (
      <p className="rounded-card bg-card shadow-card px-4 py-6 text-sm text-muted-foreground">
        No submissions yet.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {state.error ? (
        <p role="alert" className="text-sm text-destructive">{state.error}</p>
      ) : null}
      {submissions.map((submission) => {
        const meta = REVIEW_STATUS[submission.status];
        const open = openId === submission.id;
        return (
          <li
            key={submission.id}
            className="flex flex-col gap-3 rounded-card bg-card shadow-card p-4"
          >
            <button
              type="button"
              onClick={() => setOpenId(open ? null : submission.id)}
              className="flex flex-wrap items-center gap-3 text-left"
            >
              <span className="min-w-0 flex-1 text-sm font-medium capitalize">
                {submission.type.replaceAll("_", " ")}
              </span>
              <span className="text-xs text-muted-foreground">
                {submission.guestName} · {submission.divisionName}
              </span>
              <span className={cn("text-xs font-medium", meta?.className)}>
                {meta?.label ?? submission.status}
              </span>
              <span className="text-xs text-muted-foreground">{open ? "▲" : "▼"}</span>
            </button>
            {open ? (
              <div className="flex flex-col gap-3 border-t pt-3">
                <dl className="grid gap-2 text-sm sm:grid-cols-2">
                  {Object.entries(submission.data)
                    .filter(([, value]) => value)
                    .map(([key, value]) => (
                      <div key={key} className="flex flex-col">
                        <dt className="text-[10px] uppercase tracking-widest text-muted-foreground">
                          {key.replaceAll("_", " ")}
                        </dt>
                        <dd className="whitespace-pre-wrap">{value}</dd>
                      </div>
                    ))}
                </dl>
                {submission.status === "submitted" ? (
                  <form action={formAction} className="flex flex-wrap items-center gap-2">
                    <input type="hidden" name="eventId" value={eventId} />
                    <input type="hidden" name="submissionId" value={submission.id} />
                    <Input
                      name="note"
                      placeholder="Note to the guest (required unless accepting)…"
                      className="h-9 min-w-64 flex-1 text-xs"
                    />
                    <Button
                      type="submit"
                      name="decision"
                      value="accepted"
                      size="sm"
                      disabled={pending}
                    >
                      Accept
                    </Button>
                    <Button
                      type="submit"
                      name="decision"
                      value="changes_requested"
                      size="sm"
                      variant="outline"
                      disabled={pending}
                    >
                      Request changes
                    </Button>
                  </form>
                ) : submission.reviewNote ? (
                  <p className="text-xs text-muted-foreground">
                    Note: “{submission.reviewNote}”
                  </p>
                ) : null}
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
