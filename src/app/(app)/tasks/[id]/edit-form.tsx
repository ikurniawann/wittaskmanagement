"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { updateFieldsAction } from "../actions";
import { PriorityPicker } from "@/components/priority-picker";
import { Segmented } from "@/components/segmented";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// Edit task, as a centred modal (Owner 2026-08-12). It used to expand
// inline inside the drawer's header row — wedged between the title and the
// Watch button, which is exactly how it looked. A five-field form is a modal
// moment, not a header ornament. It also closes on a successful save now;
// before, it sat open with no confirmation that anything had happened.

export function EditTaskForm({
  task,
}: {
  task: {
    id: string;
    title: string;
    description: string;
    priority: string;
    startDate: string | null;
    dueDate: string | null;
    recurrence: string;
  };
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!open) {
    return (
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        Edit
      </Button>
    );
  }

  // datetime-local expects local (WIB) time without zone
  const toLocal = (iso: string | null) =>
    iso
      ? new Date(new Date(iso).getTime() + 7 * 3600_000).toISOString().slice(0, 16)
      : "";
  const startLocal = toLocal(task.startDate);
  const dueLocal = toLocal(task.dueDate);

  const submit = (formData: FormData) => {
    startTransition(async () => {
      const result = await updateFieldsAction({}, formData);
      if (result.error) {
        setError(result.error);
        return;
      }
      setOpen(false);
      setError(null);
      router.refresh();
    });
  };

  // Portalled to <body>: this form lives inside the task drawer, whose slide
  // animation uses a CSS transform — and a transformed ancestor becomes the
  // containing block for position:fixed descendants, so without the portal
  // the modal centres on the DRAWER and is clipped at its edge.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <form
        action={submit}
        className="flex max-h-[85svh] w-full max-w-lg flex-col gap-4 overflow-y-auto rounded-lg border bg-card p-5 shadow-lg"
      >
        <input type="hidden" name="taskId" value={task.id} />
        <h2 className="text-sm font-semibold">Edit task</h2>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2 sm:col-span-2">
            <Label htmlFor="et-title">Title</Label>
            <Input id="et-title" name="title" defaultValue={task.title} required autoFocus />
          </div>
          <div className="flex flex-col gap-2 sm:col-span-2">
            <Label>Priority</Label>
            <PriorityPicker
              defaultValue={task.priority as "low" | "medium" | "high" | "urgent"}
            />
          </div>
          {/* start + due together: the pair is what draws the bar on the
              gantt and the span on the calendar */}
          <div className="flex flex-col gap-2">
            <Label htmlFor="et-start">Start (WIB)</Label>
            <Input
              id="et-start"
              name="startDate"
              type="datetime-local"
              defaultValue={startLocal}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="et-due">Due (WIB)</Label>
            <Input id="et-due" name="dueDate" type="datetime-local" defaultValue={dueLocal} />
          </div>
          <div className="flex flex-col gap-2 sm:col-span-2">
            <Label>Repeats</Label>
            <Segmented
              name="recurrence"
              defaultValue={task.recurrence}
              options={[
                { value: "none", label: "Never" },
                { value: "daily", label: "Daily" },
                { value: "weekly", label: "Weekly" },
                { value: "monthly", label: "Monthly" },
              ]}
            />
          </div>
          <div className="flex flex-col gap-2 sm:col-span-2">
            <Label htmlFor="et-desc">Description</Label>
            <textarea
              id="et-desc"
              name="description"
              rows={3}
              defaultValue={task.description}
              className="border-input rounded-md border bg-transparent px-3 py-2 text-sm outline-none"
            />
          </div>
        </div>

        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}

        <div className="flex justify-end gap-2">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              setOpen(false);
              setError(null);
            }}
          >
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
