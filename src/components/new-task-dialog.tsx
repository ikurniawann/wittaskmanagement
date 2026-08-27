"use client";

import { CalendarClock, Repeat } from "lucide-react";
import { useActionState, useState } from "react";
import { createTaskAction, type TaskActionState } from "@/app/(app)/tasks/actions";
import { AssigneePicker, LeadSelect } from "@/components/assignee-picker";
import { LabelPicker } from "@/components/label-picker";
import { PriorityPicker } from "@/components/priority-picker";
import { Switch } from "@/components/ui/switch";
import { Segmented } from "@/components/segmented";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export interface DivisionWithMembers {
  id: string;
  name: string;
  members: Array<{ id: string; name: string }>;
}

// Plane-style create dialog, shared by board (single division) and list
// (cross-division: shows a division picker; assignees follow the division).
export function NewTaskDialog({
  eventId,
  divisions,
  defaultDivisionId,
  labels,
  /** divisions this person may seal a task in — head of them, or leadership */
  canRestrictIn = [],
}: {
  eventId: string;
  divisions: DivisionWithMembers[];
  defaultDivisionId?: string;
  labels: Array<{ id: string; name: string; color: string }>;
  canRestrictIn?: string[];
}) {
  const [open, setOpen] = useState(false);
  const [divisionId, setDivisionId] = useState(
    defaultDivisionId ?? divisions[0]?.id ?? "",
  );
  const [state, formAction, pending] = useActionState<TaskActionState, FormData>(
    createTaskAction,
    {},
  );

  const division = divisions.find((d) => d.id === divisionId) ?? divisions[0];
  if (!division) return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button>New task ↗</Button>} />
      <DialogContent className="max-h-[85vh] gap-0 overflow-y-auto p-0 sm:max-w-2xl">
        <form action={formAction} className="flex flex-col">
          <input type="hidden" name="eventId" value={eventId} />
          <input type="hidden" name="divisionId" value={division.id} />

          <div className="flex flex-col gap-1 px-6 pb-2 pt-6">
            <DialogTitle className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
              Create task
              {divisions.length === 1 ? (
                <span className="rounded-sm border px-1.5 py-0.5 text-[10px] normal-case tracking-normal">
                  {division.name}
                </span>
              ) : null}
            </DialogTitle>
            <input
              name="title"
              required
              autoFocus
              placeholder="Task title"
              className="w-full bg-transparent text-xl font-semibold outline-none placeholder:text-muted-foreground/50"
            />
            <textarea
              name="description"
              rows={3}
              placeholder="Add a description…"
              className="w-full resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground/50"
            />
          </div>

          <div className="flex flex-col gap-4 border-t px-6 py-4">
            {divisions.length > 1 ? (
              <div className="flex flex-col gap-1.5">
                <Label className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                  Division
                </Label>
                <div className="flex flex-wrap gap-1.5">
                  {divisions.map((d) => (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => setDivisionId(d.id)}
                      aria-pressed={d.id === division.id}
                      className={cn(
                        "rounded-full border px-3 py-1 text-xs transition-all duration-150",
                        d.id === division.id
                          ? "border-foreground bg-foreground font-medium text-background shadow-sm"
                          : "text-muted-foreground hover:border-foreground/40 hover:text-foreground",
                      )}
                    >
                      {d.name}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="flex flex-wrap items-end gap-x-6 gap-y-4">
              <div className="flex flex-col gap-1.5">
                <Label className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                  Priority
                </Label>
                <PriorityPicker />
              </div>
              {/* start + due: the pair is what gives the task a bar on the
                  gantt and a span on the calendar rather than a single dot */}
              <div className="flex flex-col gap-1.5">
                <Label
                  htmlFor="ntd-start"
                  className="flex items-center gap-1 text-[10px] uppercase tracking-[0.2em] text-muted-foreground"
                >
                  <CalendarClock className="size-3" /> Start
                </Label>
                <Input
                  id="ntd-start"
                  name="startDate"
                  type="datetime-local"
                  className="h-9 w-52 text-xs"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label
                  htmlFor="ntd-due"
                  className="flex items-center gap-1 text-[10px] uppercase tracking-[0.2em] text-muted-foreground"
                >
                  <CalendarClock className="size-3" /> Due
                </Label>
                <Input
                  id="ntd-due"
                  name="dueDate"
                  type="datetime-local"
                  className="h-9 w-52 text-xs"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="flex items-center gap-1 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                  <Repeat className="size-3" /> Repeats
                </Label>
                <Segmented
                  name="recurrence"
                  defaultValue="none"
                  options={[
                    { value: "none", label: "Never" },
                    { value: "daily", label: "Daily" },
                    { value: "weekly", label: "Weekly" },
                    { value: "monthly", label: "Monthly" },
                  ]}
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                Lead / PIC{divisions.length > 1 ? ` — ${division.name}` : ""}
              </Label>
              <LeadSelect key={`lead-${division.id}`} members={division.members} />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                Assignees{divisions.length > 1 ? ` — ${division.name}` : ""}
              </Label>
              {/* key remounts the picker so selections reset per division */}
              <AssigneePicker key={division.id} members={division.members} />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                Labels
              </Label>
              <LabelPicker labels={labels} />
            </div>
          </div>

          {canRestrictIn.includes(division.id) ? (
            <label className="flex items-start gap-2.5 border-t px-6 py-3 text-xs">
              <Switch name="restricted" className="mt-0.5" />
              <span className="flex flex-col gap-0.5">
                <span className="font-medium">Keep inside {division.name}</span>
                <span className="text-muted-foreground">
                  Tasks are visible to every division on this project by default.
                  Lock this one and only {division.name}, the people working on
                  it, and Owner/Admin will see it.
                </span>
              </span>
            </label>
          ) : null}

          {state.error ? (
            <p role="alert" className="px-6 pb-2 text-sm text-destructive">
              {state.error}
            </p>
          ) : null}

          <div className="flex items-center justify-end gap-3 border-t bg-muted/30 px-6 py-3">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setOpen(false)}
            >
              Discard
            </Button>
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? "Creating…" : "Create task"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
