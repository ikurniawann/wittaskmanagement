"use client";

import { KeyRound, UserRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  changeMyPasswordAction,
  updateMyProfileAction,
} from "@/app/(app)/settings/actions";

// Self-service profile (Owner 2026-08-12): name and password. The email is
// shown but not editable — it is the login identity; see the action for why.

export function ProfileForm({
  initial,
  hasPassword,
}: {
  initial: { name: string; email: string };
  hasPassword: boolean;
}) {
  const router = useRouter();
  const [name, setName] = useState(initial.name);
  const [pending, startTransition] = useTransition();
  const passwordForm = useRef<HTMLFormElement>(null);

  const saveName = () => {
    const data = new FormData();
    data.set("name", name);
    startTransition(async () => {
      const result = await updateMyProfileAction({}, data);
      if (result.error) toast.error(result.error);
      else {
        toast.success("Name updated.");
        router.refresh();
      }
    });
  };

  const savePassword = (data: FormData) => {
    startTransition(async () => {
      const result = await changeMyPasswordAction({}, data);
      if (result.error) toast.error(result.error);
      else {
        toast.success("Password changed.");
        passwordForm.current?.reset();
      }
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-4 rounded-card bg-card shadow-card p-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <UserRound className="size-4 text-muted-foreground" /> Profile
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pf-name" className="text-xs">
              Name
            </Label>
            <Input
              id="pf-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pf-email" className="text-xs">
              Email — your sign-in, ask an admin to change it
            </Label>
            <Input id="pf-email" value={initial.email} disabled />
          </div>
        </div>
        <div>
          <Button
            size="sm"
            onClick={saveName}
            disabled={pending || !name.trim() || name.trim() === initial.name}
          >
            {pending ? "Saving…" : "Save name"}
          </Button>
        </div>
      </div>

      {hasPassword ? (
        <form
          ref={passwordForm}
          action={savePassword}
          className="flex flex-col gap-4 rounded-card bg-card shadow-card p-4"
        >
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <KeyRound className="size-4 text-muted-foreground" /> Change password
          </h2>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pf-cur" className="text-xs">
                Current password
              </Label>
              <Input
                id="pf-cur"
                name="current"
                type="password"
                autoComplete="current-password"
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pf-new" className="text-xs">
                New password
              </Label>
              <Input
                id="pf-new"
                name="next"
                type="password"
                autoComplete="new-password"
                minLength={8}
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pf-conf" className="text-xs">
                Repeat new password
              </Label>
              <Input
                id="pf-conf"
                name="confirm"
                type="password"
                autoComplete="new-password"
                minLength={8}
                required
              />
            </div>
          </div>
          <div>
            <Button size="sm" type="submit" disabled={pending}>
              {pending ? "Saving…" : "Change password"}
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
