"use client";

import { useActionState, useState } from "react";
import { Segmented } from "@/components/segmented";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { createApprovalAction, type ApprovalActionState } from "./actions";

const MONETARY_TYPES = new Set(["expense", "artist_offer", "sponsorship_deal"]);

export function NewApprovalForm({
  divisions,
  events,
  thresholds,
}: {
  divisions: Array<{ id: string; name: string }>;
  events: Array<{ id: string; name: string }>;
  thresholds: { a: number; b: number };
}) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState("expense");
  const [divisionId, setDivisionId] = useState(divisions[0]?.id ?? "");
  const [eventId, setEventId] = useState("");
  const [amount, setAmount] = useState("");
  const [state, formAction, pending] = useActionState<
    ApprovalActionState,
    FormData
  >(createApprovalAction, {});

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)}>New request ↗</Button>
    );
  }

  const numericAmount = Number(amount.replaceAll(".", "")) || 0;
  const chainHint =
    type === "expense"
      ? numericAmount <= thresholds.a
        ? "Division Head"
        : numericAmount <= thresholds.b
          ? "Division Head → Finance"
          : "Division Head → Finance → Owner"
      : type === "artist_offer"
        ? "Talent Head → Finance → Owner"
        : type === "contract"
          ? "Legal → Owner"
          : type === "sponsorship_deal"
            ? "Sponsorship Head → Legal → Owner"
            : "Marketing Head";

  return (
    <form
      action={formAction}
      className="flex w-full flex-col gap-4 rounded-md border p-4"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2 sm:col-span-2">
          <Label>Type</Label>
          <Segmented
            name="type"
            defaultValue={type}
            onValueChange={setType}
            options={[
              { value: "expense", label: "Expense" },
              { value: "artist_offer", label: "Artist offer" },
              { value: "contract", label: "Contract" },
              { value: "sponsorship_deal", label: "Sponsorship deal" },
              { value: "public_content", label: "Public content" },
            ]}
          />
        </div>
        <div className="flex flex-col gap-2 sm:col-span-2">
          <Label>Division</Label>
          <div className="flex flex-wrap gap-1.5">
            {divisions.map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() => setDivisionId(d.id)}
                aria-pressed={d.id === divisionId}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs transition-all",
                  d.id === divisionId
                    ? "border-foreground bg-foreground font-medium text-background"
                    : "text-muted-foreground hover:border-foreground/40 hover:text-foreground",
                )}
              >
                {d.name}
              </button>
            ))}
          </div>
          <input type="hidden" name="divisionId" value={divisionId} />
        </div>
        <div className="flex flex-col gap-2 sm:col-span-2">
          <Label htmlFor="ap-title">Title</Label>
          <Input
            id="ap-title"
            name="title"
            required
            placeholder="PA system rental — main stage"
          />
        </div>
        {MONETARY_TYPES.has(type) ? (
          <div className="flex flex-col gap-2">
            <Label htmlFor="ap-amount">Amount (IDR)</Label>
            <Input
              id="ap-amount"
              name="amount"
              inputMode="numeric"
              placeholder="25000000"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
        ) : null}
        <div className="flex flex-col gap-2 sm:col-span-2">
          <Label>Project (optional)</Label>
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => setEventId("")}
              aria-pressed={eventId === ""}
              className={cn(
                "rounded-full border px-3 py-1 text-xs transition-all",
                eventId === ""
                  ? "border-foreground bg-foreground font-medium text-background"
                  : "text-muted-foreground hover:border-foreground/40 hover:text-foreground",
              )}
            >
              None
            </button>
            {events.map((e) => (
              <button
                key={e.id}
                type="button"
                onClick={() => setEventId(e.id)}
                aria-pressed={e.id === eventId}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs transition-all",
                  e.id === eventId
                    ? "border-foreground bg-foreground font-medium text-background"
                    : "text-muted-foreground hover:border-foreground/40 hover:text-foreground",
                )}
              >
                {e.name}
              </button>
            ))}
          </div>
          <input type="hidden" name="eventId" value={eventId} />
        </div>
        <div className="flex flex-col gap-2 sm:col-span-2">
          <Label htmlFor="ap-desc">Justification</Label>
          <textarea
            id="ap-desc"
            name="description"
            rows={2}
            className="border-input rounded-md border bg-transparent px-3 py-2 text-sm outline-none"
          />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">Chain: {chainHint}</p>
      {state.error ? (
        <p role="alert" className="text-sm text-destructive">{state.error}</p>
      ) : null}
      <div className="flex gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Submitting…" : "Submit request"}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
