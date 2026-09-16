"use client";

import { useActionState, useState } from "react";
import { PriorityPicker } from "@/components/priority-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  addItemAction,
  createTemplateAction,
  type TemplateActionState,
} from "./actions";

export function NewTemplateForm() {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<
    TemplateActionState,
    FormData
  >(createTemplateAction, {});

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        New playbook ↗
      </Button>
    );
  }
  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      <Input name="name" required placeholder="Playbook name…" className="h-8 w-48 text-xs" />
      <Input
        name="description"
        placeholder="Short description…"
        className="h-8 w-64 text-xs"
      />
      <Button type="submit" size="sm" disabled={pending}>
        Create
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
        ×
      </Button>
      {state.error ? (
        <span role="alert" className="text-xs text-destructive">{state.error}</span>
      ) : null}
    </form>
  );
}

export function AddItemForm({
  templateId,
  divisions,
}: {
  templateId: string;
  divisions: Array<{ id: string; name: string }>;
}) {
  const [division, setDivision] = useState(divisions[0]?.id ?? "");
  const [state, formAction, pending] = useActionState<
    TemplateActionState,
    FormData
  >(addItemAction, {});

  return (
    <form
      action={formAction}
      className="flex flex-col gap-3 rounded-card bg-card shadow-card p-4"
    >
      <input type="hidden" name="templateId" value={templateId} />
      <input type="hidden" name="divisionId" value={division} />
      <div className="flex flex-wrap gap-1.5">
        {divisions.map((d) => (
          <button
            key={d.id}
            type="button"
            onClick={() => setDivision(d.id)}
            aria-pressed={division === d.id}
            className={cn(
              "rounded-full border px-2.5 py-1 text-[11px] transition-all",
              division === d.id
                ? "border-foreground bg-foreground font-medium text-background"
                : "text-muted-foreground hover:border-foreground/40 hover:text-foreground",
            )}
          >
            {d.name}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-64 flex-1 flex-col gap-1.5">
          <Label htmlFor="ti-title" className="text-xs">
            Checklist item
          </Label>
          <Input id="ti-title" name="title" required className="h-9" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ti-offset" className="text-xs">
            Days before show (negative = after)
          </Label>
          <Input
            id="ti-offset"
            name="offsetDays"
            type="number"
            required
            defaultValue={30}
            className="h-9 w-36"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">Priority</Label>
          <PriorityPicker compact />
        </div>
        <Button type="submit" disabled={pending}>
          Add item
        </Button>
      </div>
      {state.error ? (
        <p role="alert" className="text-sm text-destructive">{state.error}</p>
      ) : null}
    </form>
  );
}
