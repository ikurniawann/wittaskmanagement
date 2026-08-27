"use client";

import { Lock, Mail } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { openSummaryAction, type GateState } from "./actions";

export function GateForm({
  token,
  needsPasscode,
  needsEmail,
  message,
}: {
  token: string;
  needsPasscode: boolean;
  needsEmail: boolean;
  message: string | null;
}) {
  const router = useRouter();
  // kept across a failed attempt: retyping an address because the passcode
  // was wrong is exactly the kind of thing that makes people give up
  const [email, setEmail] = useState("");
  const [state, formAction, pending] = useActionState<GateState, FormData>(
    openSummaryAction,
    { needsPasscode, needsEmail },
  );

  useEffect(() => {
    if (state.ok) router.refresh();
  }, [state.ok, router]);

  // both boxes appear together: the link declares every requirement at once,
  // so a visitor never loses one field by filling the other
  const askEmail = state.needsEmail ?? needsEmail;
  const askPasscode = state.needsPasscode ?? needsPasscode;

  return (
    <form action={formAction} className="flex w-full max-w-sm flex-col gap-4">
      <input type="hidden" name="token" value={token} />

      {askEmail ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="share-email" className="flex items-center gap-1.5 text-xs">
            <Mail className="size-3.5" /> Your email
          </Label>
          <Input
            id="share-email"
            name="email"
            type="email"
            required
            autoComplete="email"
            placeholder="you@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <span className="text-[11px] text-muted-foreground">
            Recorded with the sender so they know who opened the document.
          </span>
        </div>
      ) : null}

      {askPasscode ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="share-pass" className="flex items-center gap-1.5 text-xs">
            <Lock className="size-3.5" /> Passcode
          </Label>
          <Input id="share-pass" name="passcode" type="password" required />
        </div>
      ) : null}

      {state.error || message ? (
        <p role="alert" className="text-xs text-destructive">
          {state.error ?? message}
        </p>
      ) : null}

      <Button type="submit" disabled={pending}>
        {pending ? "Checking…" : "Open document"}
      </Button>
    </form>
  );
}
