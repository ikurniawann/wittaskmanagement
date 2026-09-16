"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { updateMyPreferencesAction } from "./actions";

interface Prefs {
  emailNotifications: boolean;
  whatsappNotifications: boolean;
  dailyDigest: boolean;
  weeklyDigest: boolean;
  phone: string;
}

function Row({
  title,
  hint,
  checked,
  onChange,
}: {
  title: string;
  hint: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 px-4 py-3.5">
      <span className="flex min-w-0 flex-col">
        <span className="text-sm font-medium">{title}</span>
        <span className="text-xs text-muted-foreground">{hint}</span>
      </span>
      <Switch checked={checked} onCheckedChange={onChange} aria-label={title} />
    </label>
  );
}

export function PreferencesForm({
  initial,
  showWeekly,
}: {
  initial: Prefs;
  showWeekly: boolean;
}) {
  const [prefs, setPrefs] = useState(initial);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const set = (key: keyof Prefs) => (next: boolean) => {
    setSaved(false);
    setPrefs((p) => ({ ...p, [key]: next }));
  };

  const save = () =>
    startTransition(async () => {
      const data = new FormData();
      if (prefs.emailNotifications) data.set("emailNotifications", "on");
      if (prefs.whatsappNotifications) data.set("whatsappNotifications", "on");
      if (prefs.dailyDigest) data.set("dailyDigest", "on");
      if (prefs.weeklyDigest) data.set("weeklyDigest", "on");
      data.set("phone", prefs.phone);
      await updateMyPreferencesAction(data);
      setSaved(true);
      toast.success("Preferences saved");
    });

  return (
    <div className="flex max-w-xl flex-col gap-6">
      <div className="flex flex-col divide-y rounded-card bg-card shadow-card">
        <Row
          title="Email notifications"
          hint="Assignments, mentions, due dates, approvals — as they happen"
          checked={prefs.emailNotifications}
          onChange={set("emailNotifications")}
        />
        <Row
          title="WhatsApp notifications"
          hint="High-value alerts only (assignment, due, approvals)"
          checked={prefs.whatsappNotifications}
          onChange={set("whatsappNotifications")}
        />
        <div className="flex flex-col gap-1.5 px-4 py-3.5">
          <span className="text-sm font-medium">WhatsApp number</span>
          <Input
            value={prefs.phone}
            onChange={(e) => {
              setSaved(false);
              setPrefs((p) => ({ ...p, phone: e.target.value }));
            }}
            placeholder="+62812xxxxxxx"
            className="max-w-xs"
          />
        </div>
      </div>

      <div className="flex flex-col divide-y rounded-card bg-card shadow-card">
        <Row
          title="Daily digest"
          hint="One morning email (07:00 WIB): overdue, due today, approvals waiting"
          checked={prefs.dailyDigest}
          onChange={set("dailyDigest")}
        />
        {showWeekly ? (
          <Row
            title="Weekly executive digest"
            hint="Monday morning portfolio summary: health, burn, ticket sales"
            checked={prefs.weeklyDigest}
            onChange={set("weeklyDigest")}
          />
        ) : null}
      </div>

      <div className="flex items-center gap-3">
        <Button onClick={save} disabled={pending}>
          {pending ? "Saving…" : "Save preferences"}
        </Button>
        {saved ? (
          <span className="text-xs text-status-done">Saved.</span>
        ) : null}
      </div>
    </div>
  );
}
