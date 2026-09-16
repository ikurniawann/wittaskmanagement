"use client";

import { BookOpenCheck } from "lucide-react";
import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  applyTemplateAction,
  type EventActionState,
} from "@/app/(app)/events/actions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Apply a playbook to an EXISTING event (T-092) — e.g. an event created
// blank before templates existed. Duplicate items are skipped.
export function ApplyPlaybook({
  eventId,
  templates,
}: {
  eventId: string;
  templates: Array<{ id: string; name: string; itemCount: number }>;
}) {
  const [open, setOpen] = useState(false);
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const [state, formAction, pending] = useActionState<
    EventActionState,
    FormData
  >(applyTemplateAction, {});

  useEffect(() => {
    if (state.info) toast.success(state.info);
  }, [state.info]);

  if (templates.length === 0) return null;

  if (!open) {
    return (
      <div className="flex flex-col gap-2">
        <Button variant="ghost" size="sm" onClick={() => setOpen(true)} className="gap-1.5">
          <BookOpenCheck className="size-3.5" />
          Apply playbook
        </Button>
        {state.info ? (
          <p className="text-xs text-status-done">{state.info}</p>
        ) : null}
      </div>
    );
  }

  return (
    <form
      action={formAction}
      className="flex w-full flex-col gap-3 rounded-card bg-card shadow-card p-4"
    >
      <input type="hidden" name="eventId" value={eventId} />
      <input type="hidden" name="templateId" value={templateId} />
      <span className="text-xs font-semibold">
        Apply a playbook
      </span>
      <div className="flex flex-wrap gap-1.5">
        {templates.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTemplateId(t.id)}
            aria-pressed={templateId === t.id}
            className={cn(
              "rounded-full border px-3 py-1.5 text-xs transition-all",
              templateId === t.id
                ? "border-foreground bg-foreground font-medium text-background"
                : "text-muted-foreground hover:border-foreground/40 hover:text-foreground",
            )}
          >
            {t.name} · {t.itemCount} tasks
          </button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        Generates each division&apos;s checklist with due dates counted back
        from show day. Items that already exist are skipped.
      </p>
      {state.error ? (
        <p role="alert" className="text-sm text-destructive">{state.error}</p>
      ) : null}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Applying…" : "Apply"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Close
        </Button>
      </div>
    </form>
  );
}
