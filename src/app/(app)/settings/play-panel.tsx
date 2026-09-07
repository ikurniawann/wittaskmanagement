"use client";

import { Gamepad2, Loader2 } from "lucide-react";
import { useState, useTransition } from "react";
import { Switch } from "@/components/ui/switch";
import { setPlayEnabledAction } from "./actions";

// Backstage Play toggle (EPIC-024 T-240). Admin-only — the page decides that.
// Turning it on adds "Play" to everyone's sidebar; turning it off hides the
// route again (it answers 404) without touching any data.
export function PlayPanel({ enabled }: { enabled: boolean }) {
  const [on, setOn] = useState(enabled);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const toggle = (next: boolean) => {
    setOn(next);
    setError(null);
    start(async () => {
      const result = await setPlayEnabledAction(next);
      if (result?.error) {
        setOn(!next);
        setError(result.error);
      }
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Gamepad2 className="size-4 text-muted-foreground" /> Backstage Play
        </h2>
        <p className="text-xs text-muted-foreground">
          A 3D office built from this workspace&apos;s divisions, people and tasks.
          It shows each person exactly what the boards already let them see.
        </p>
      </div>
      <ul className="flex flex-col divide-y rounded-md border bg-card">
        <li className="flex items-start gap-4 px-4 py-3.5">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="flex items-center gap-2 text-sm font-medium">
              Play
              {pending ? <Loader2 className="size-3 animate-spin text-muted-foreground" /> : null}
            </span>
            <span className="text-xs text-muted-foreground">
              {on ? "Everyone sees “Play” in the sidebar." : "Hidden for everyone while off."}
            </span>
            {error ? (
              <span role="alert" className="text-[11px] text-destructive">
                {error}
              </span>
            ) : null}
          </div>
          <Switch
            checked={on}
            onCheckedChange={toggle}
            disabled={pending}
            aria-label={`${on ? "Disable" : "Enable"} Backstage Play`}
          />
        </li>
      </ul>
    </div>
  );
}
