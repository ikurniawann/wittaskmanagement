"use client";

import { ShareOpensBadge } from "@/components/share-opens-badge";
import { Check, ChevronDown, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { PriorityIcon, StatusDot, UserAvatar } from "@/components/task-meta";
import {
  setDueDateAction,
  setLeadCellAction,
  setPriorityAction,
  setStatusAction,
  setTitleAction,
} from "@/app/(app)/tasks/actions";
import { STATUS_LABELS, TASK_STATUS_ORDER, type TaskStatus } from "@/lib/tasks/status";
import { cn } from "@/lib/utils";

// Spreadsheet view of the event's tasks (Owner 2026-08-12): every cell that
// can be edited is edited in place, without opening the task.
//
// Each cell calls its OWN narrow action. The tempting shortcut — one
// "update task" action fed a partial form — writes every field it is given,
// so a single edited cell would blank the rest of the row.
//
// A refused edit (a sealed task, a division the actor cannot touch) becomes
// a toast and the cell reverts; the permission answer stays on the server.

export interface GridTask {
  id: string;
  title: string;
  status: TaskStatus;
  priority: "low" | "medium" | "high" | "urgent";
  dueDate: string | null;
  divisionId: string;
  leadId: string | null;
  assignees: Array<{ id: string; name: string; avatarPath?: string | null }>;
  canEdit: boolean;
  /** null when this task has never been shared outside */
  shareOpens: { opens: number; live: boolean } | null;
}

const PRIORITIES = ["urgent", "high", "medium", "low"] as const;

/** Shared dropdown shell: click outside or Escape closes, nothing else. */
function CellMenu({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", away, true);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", away, true);
      document.removeEventListener("keydown", key);
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div
      ref={ref}
      role="menu"
      className="absolute left-0 top-full z-40 mt-1 flex max-h-64 w-52 flex-col overflow-y-auto rounded-md border bg-popover p-1 shadow-lg"
    >
      {children}
    </div>
  );
}

export function GridView({
  tasks,
  divisionName,
  people,
}: {
  tasks: GridTask[];
  divisionName: Record<string, string>;
  /** candidates for the PIC cell, per division */
  people: Record<string, Array<{ id: string; name: string }>>;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [openCell, setOpenCell] = useState<string | null>(null);

  const run = (
    action: (prev: { error?: string }, data: FormData) => Promise<{ error?: string }>,
    fields: Record<string, string>,
  ) => {
    const data = new FormData();
    for (const [k, v] of Object.entries(fields)) data.set(k, v);
    startTransition(async () => {
      const result = await action({}, data);
      if (result.error) toast.error(result.error);
      else router.refresh();
    });
  };

  return (
    <div className="overflow-x-auto rounded-md border bg-card">
      <table className="w-full min-w-[880px] text-sm">
        <thead>
          <tr className="border-b text-left text-xs uppercase tracking-wider text-muted-foreground">
            <th className="px-3 py-2.5 font-medium">Task</th>
            <th className="w-40 px-3 py-2.5 font-medium">Lead (PIC)</th>
            <th className="w-32 px-3 py-2.5 font-medium">Assignees</th>
            <th className="w-36 px-3 py-2.5 font-medium">Division</th>
            <th className="w-36 px-3 py-2.5 font-medium">Due (WIB)</th>
            <th className="w-32 px-3 py-2.5 font-medium">Priority</th>
            <th className="w-36 px-3 py-2.5 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((task) => (
            <tr key={task.id} className="border-b transition-colors last:border-0 hover:bg-accent/20">
              {/* title — editable in place, opens the task from the arrow */}
              <td className="px-3 py-1.5">
                <div className="flex items-center gap-2">
                  {task.canEdit ? (
                    <input
                      defaultValue={task.title}
                      onBlur={(e) => {
                        const next = e.target.value.trim();
                        if (next && next !== task.title) {
                          run(setTitleAction, { taskId: task.id, title: next });
                        } else {
                          e.target.value = task.title;
                        }
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") e.currentTarget.blur();
                        if (e.key === "Escape") {
                          e.currentTarget.value = task.title;
                          e.currentTarget.blur();
                        }
                      }}
                      className="w-full min-w-0 rounded border border-transparent bg-transparent px-1.5 py-1 outline-none transition-colors hover:border-border focus:border-foreground/40 focus:bg-background"
                    />
                  ) : (
                    <span className="px-1.5 py-1">{task.title}</span>
                  )}
                  {task.shareOpens ? <ShareOpensBadge {...task.shareOpens} /> : null}
                  <Link
                    href={`/tasks/${task.id}`}
                    title="Open task"
                    className="shrink-0 text-xs text-muted-foreground hover:text-foreground"
                  >
                    ↗
                  </Link>
                </div>
              </td>

              {/* lead */}
              <td className="relative px-3 py-1.5">
                <button
                  type="button"
                  disabled={!task.canEdit}
                  onClick={() =>
                    setOpenCell((c) => (c === `lead-${task.id}` ? null : `lead-${task.id}`))
                  }
                  className="flex w-full items-center gap-1.5 rounded border border-transparent px-1.5 py-1 text-left transition-colors hover:border-border disabled:pointer-events-none"
                >
                  {task.leadId ? (
                    <>
                      <UserAvatar
                        name={
                          (people[task.divisionId] ?? []).find((p) => p.id === task.leadId)
                            ?.name ?? "?"
                        }
                        className="size-5 text-[9px]"
                      />
                      <span className="truncate text-xs">
                        {(people[task.divisionId] ?? []).find((p) => p.id === task.leadId)
                          ?.name ?? "—"}
                      </span>
                    </>
                  ) : (
                    <span className="text-xs text-muted-foreground">Set lead</span>
                  )}
                  {task.canEdit ? (
                    <ChevronDown className="ml-auto size-3 shrink-0 text-muted-foreground" />
                  ) : null}
                </button>
                <CellMenu
                  open={openCell === `lead-${task.id}`}
                  onClose={() => setOpenCell(null)}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setOpenCell(null);
                      run(setLeadCellAction, { taskId: task.id, userId: "" });
                    }}
                    className="flex items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-accent"
                  >
                    <X className="size-3.5" /> No lead
                  </button>
                  {(people[task.divisionId] ?? []).map((person) => (
                    <button
                      key={person.id}
                      type="button"
                      onClick={() => {
                        setOpenCell(null);
                        run(setLeadCellAction, { taskId: task.id, userId: person.id });
                      }}
                      className="flex items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
                    >
                      <UserAvatar name={person.name} className="size-5 text-[9px]" />
                      <span className="truncate">{person.name}</span>
                      {task.leadId === person.id ? (
                        <Check className="ml-auto size-3.5" />
                      ) : null}
                    </button>
                  ))}
                </CellMenu>
              </td>

              {/* assignees — read-only here; adding people is a task-drawer job */}
              <td className="px-3 py-1.5">
                {task.assignees.length === 0 ? (
                  <span className="text-xs text-muted-foreground">—</span>
                ) : (
                  <span className="flex -space-x-1.5">
                    {task.assignees.slice(0, 3).map((a) => (
                      <UserAvatar
                        key={a.id}
                        name={a.name}
                        src={a.avatarPath}
                        className="size-5 text-[9px] ring-2 ring-card"
                      />
                    ))}
                    {task.assignees.length > 3 ? (
                      <span className="inline-flex size-5 items-center justify-center rounded-full border bg-muted text-[9px] text-muted-foreground ring-2 ring-card">
                        +{task.assignees.length - 3}
                      </span>
                    ) : null}
                  </span>
                )}
              </td>

              <td className="px-3 py-1.5 text-xs text-muted-foreground">
                {divisionName[task.divisionId] ?? "—"}
              </td>

              {/* due date */}
              <td className="px-3 py-1.5">
                {task.canEdit ? (
                  <input
                    type="date"
                    defaultValue={task.dueDate ? task.dueDate.slice(0, 10) : ""}
                    onChange={(e) =>
                      run(setDueDateAction, {
                        taskId: task.id,
                        // a bare date means midnight WIB, not midnight UTC
                        dueDate: e.target.value ? `${e.target.value}T00:00:00+07:00` : "",
                      })
                    }
                    className="w-full rounded border border-transparent bg-transparent px-1.5 py-1 text-xs outline-none transition-colors hover:border-border focus:border-foreground/40 focus:bg-background"
                  />
                ) : (
                  <span className="text-xs text-muted-foreground">
                    {task.dueDate ? task.dueDate.slice(0, 10) : "—"}
                  </span>
                )}
              </td>

              {/* priority */}
              <td className="relative px-3 py-1.5">
                <button
                  type="button"
                  disabled={!task.canEdit}
                  onClick={() =>
                    setOpenCell((c) => (c === `pri-${task.id}` ? null : `pri-${task.id}`))
                  }
                  className="flex w-full items-center gap-1 rounded border border-transparent px-1.5 py-1 transition-colors hover:border-border disabled:pointer-events-none"
                >
                  <PriorityIcon priority={task.priority} withLabel />
                  {task.canEdit ? (
                    <ChevronDown className="ml-auto size-3 shrink-0 text-muted-foreground" />
                  ) : null}
                </button>
                <CellMenu
                  open={openCell === `pri-${task.id}`}
                  onClose={() => setOpenCell(null)}
                >
                  {PRIORITIES.map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => {
                        setOpenCell(null);
                        if (p !== task.priority)
                          run(setPriorityAction, { taskId: task.id, priority: p });
                      }}
                      className={cn(
                        "flex items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent",
                        p === task.priority && "bg-accent/50",
                      )}
                    >
                      <PriorityIcon priority={p} withLabel />
                    </button>
                  ))}
                </CellMenu>
              </td>

              {/* status */}
              <td className="relative px-3 py-1.5">
                <button
                  type="button"
                  disabled={!task.canEdit}
                  onClick={() =>
                    setOpenCell((c) => (c === `st-${task.id}` ? null : `st-${task.id}`))
                  }
                  className="flex w-full items-center gap-1.5 rounded border border-transparent px-1.5 py-1 text-left transition-colors hover:border-border disabled:pointer-events-none"
                >
                  <StatusDot status={task.status} className="size-2" />
                  <span className="truncate text-xs">{STATUS_LABELS[task.status]}</span>
                  {task.canEdit ? (
                    <ChevronDown className="ml-auto size-3 shrink-0 text-muted-foreground" />
                  ) : null}
                </button>
                <CellMenu
                  open={openCell === `st-${task.id}`}
                  onClose={() => setOpenCell(null)}
                >
                  {TASK_STATUS_ORDER.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => {
                        setOpenCell(null);
                        if (s !== task.status)
                          run(setStatusAction, { taskId: task.id, status: s });
                      }}
                      className={cn(
                        "flex items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent",
                        s === task.status && "bg-accent/50",
                      )}
                    >
                      <StatusDot status={s} className="size-2" />
                      {STATUS_LABELS[s]}
                    </button>
                  ))}
                </CellMenu>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
