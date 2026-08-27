"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { loginAction, type LoginState } from "./actions";

export function LoginForm() {
  const [state, formAction, pending] = useActionState<LoginState, FormData>(
    loginAction,
    {},
  );
  // Controlled on purpose: React resets a form once its action resolves, so an
  // uncontrolled field would empty itself on a failed sign-in and make the
  // person retype an address that was never the problem (Owner 2026-08-27).
  // Held here rather than echoed back by the server — the value never needs to
  // make the round trip, and the password must never make it at all.
  const [email, setEmail] = useState("");
  const passwordRef = useRef<HTMLInputElement>(null);

  // a wrong password is the likely cause, so put the cursor where the fix is
  useEffect(() => {
    if (state.error) passwordRef.current?.focus();
  }, [state.error]);

  return (
    <form action={formAction} className="flex w-full flex-col gap-5">
      <div className="flex flex-col gap-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="password">Password</Label>
        <Input
          ref={passwordRef}
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </div>
      {state.error ? (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      ) : null}
      <Button type="submit" disabled={pending} className="mt-2">
        {pending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
