"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { updateStatusAction } from "@/app/(app)/tasks/actions";
import { DependencyBadge } from "@/components/dependency-badge";
import { LabelChip } from "@/components/label-chip";
import {
  AvatarStack,
  PriorityIcon,
  StatusDot,
  STATUS_TEXT,
  type StatusKey,
} from "@/components/task-meta";
import { cn } from "@/lib/utils";

const COLUMNS: StatusKey[] = [
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "blocked",
  "done",
  "cancelled",
];

export interface KanbanTask {
  id: string;
  title: string;
  status: StatusKey;
  priority: "low" | "medium" | "high" | "urgent";
  dueDate: string | null;
  assignees: Array<{ id: string; name: string }>;
  labels: Array<{ id: string; name: string; color: string }>;
  /** shown on cards in the all-departments view */
  divisionName?: string;
  /** dependency badge counts (EPIC-012) — omitted when the card has none */
  dep?: { waitingOn: number; waiters: number; critical: boolean };
}

// Native HTML5 drag & drop — no library. Drop persists via server action;
// clicking a card opens the peek drawer (intercepted /tasks/[id]).
export function KanbanBoard({ tasks }: { tasks: KanbanTask[] }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [dragId, setDragId] = useState<string | null>(null);
  const [overColumn, setOverColumn] = useState<StatusKey | null>(null);
  const [overrides, setOverrides] = useState<Record<string, StatusKey>>({});

  const drop = (status: StatusKey) => {
    if (!dragId) return;
    const id = dragId;
    setDragId(null);
    setOverColumn(null);
    setOverrides((prev) => ({ ...prev, [id]: status }));
    const formData = new FormData();
    formData.set("taskId", id);
    formData.set("status", status);
    startTransition(async () => {
      await updateStatusAction(formData);
      toast.success(`Moved to ${STATUS_TEXT[status]}`);
      router.refresh();
    });
  };

  const statusOf = (task: KanbanTask) => overrides[task.id] ?? task.status;
  // captured once per mount — overdue highlighting doesn't need live ticking
  const [now] = useState(() => Date.now());

  return (
    <div className="flex gap-3 overflow-x-auto pb-4">
      {COLUMNS.map((column) => {
        const items = tasks.filter((t) => statusOf(t) === column);
        return (
          <div
            key={column}
            onDragOver={(e) => {
              e.preventDefault();
              setOverColumn(column);
            }}
            onDragLeave={() => setOverColumn(null)}
            onDrop={() => drop(column)}
            className={cn(
              "flex min-h-72 w-64 shrink-0 flex-col gap-2 rounded-lg bg-muted/40 p-2 transition-colors",
              overColumn === column && "bg-surface-2 ring-1 ring-foreground/20",
            )}
          >
            <div className="flex items-center gap-2 px-1.5 py-1">
              <StatusDot status={column} />
              <span className="text-xs font-medium">{STATUS_TEXT[column]}</span>
              <span className="ml-auto rounded-full bg-background px-1.5 text-[10px] tabular-nums text-muted-foreground">
                {items.length}
              </span>
            </div>
            <div className="flex flex-1 flex-col gap-2">
              {items.map((task) => {
                const overdue =
                  task.dueDate !== null &&
                  new Date(task.dueDate).getTime() < now &&
                  statusOf(task) !== "done";
                return (
                  <Link
                    key={task.id}
                    href={`/tasks/${task.id}`}
                    draggable
                    onDragStart={() => setDragId(task.id)}
                    onDragEnd={() => setDragId(null)}
                    className={cn(
                      "group flex cursor-grab flex-col gap-2 rounded-card bg-card shadow-card p-3-hover hover:border-foreground/25 active:cursor-grabbing",
                      dragId === task.id && "rotate-1 opacity-60",
                    )}
                  >
                    <span className="text-[13px] font-medium leading-snug">
                      {task.title}
                    </span>
                    {task.divisionName ? (
                      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                        {task.divisionName}
                      </span>
                    ) : null}
                    {task.labels.length > 0 ? (
                      <span className="flex flex-wrap gap-1">
                        {task.labels.map((label) => (
                          <LabelChip
                            key={label.id}
                            name={label.name}
                            color={label.color}
                          />
                        ))}
                      </span>
                    ) : null}
                    <span className="flex items-center gap-2">
                      <PriorityIcon priority={task.priority} />
                      {task.dueDate ? (
                        <span
                          className={cn(
                            "rounded-sm border px-1.5 py-px text-[10px] tabular-nums",
                            overdue
                              ? "border-priority-urgent/40 text-priority-urgent"
                              : "text-muted-foreground",
                          )}
                        >
                          {new Date(task.dueDate).toLocaleDateString("en-GB", {
                            day: "2-digit",
                            month: "short",
                            timeZone: "Asia/Jakarta",
                          })}
                        </span>
                      ) : null}
                      {task.dep ? <DependencyBadge {...task.dep} /> : null}
                      <AvatarStack users={task.assignees} className="ml-auto" />
                    </span>
                  </Link>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
