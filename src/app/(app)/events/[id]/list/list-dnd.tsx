"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import { toast } from "sonner";
import { setStatusAction } from "@/app/(app)/tasks/actions";
import { cn } from "@/lib/utils";

// Drag a task row onto another status group to move it (Owner 2026-08-12).
//
// Two thin client shells around server-rendered rows, so the page keeps its
// server-side data fetching and only the drag wiring lives in the browser.
// The drop calls the same updateStatus service as the buttons in the drawer,
// so every side effect still fires — completion handling, bottleneck
// recompute, the unblocked notifications.

/** Carried on the drag, not in module state: a second tab must not see it. */
const MIME = "application/x-task-id";

export function TaskDragRow({
  taskId,
  children,
}: {
  taskId: string;
  children: ReactNode;
}) {
  return (
    <li
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(MIME, taskId);
        e.dataTransfer.effectAllowed = "move";
      }}
      className="cursor-grab active:cursor-grabbing"
    >
      {children}
    </li>
  );
}

export function StatusDropGroup({
  status,
  children,
}: {
  status: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const [over, setOver] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <div
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(MIME)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setOver(true);
      }}
      onDragLeave={(e) => {
        // ignore bubbles from children still inside the group
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const taskId = e.dataTransfer.getData(MIME);
        if (!taskId) return;
        const data = new FormData();
        data.set("taskId", taskId);
        data.set("status", status);
        startTransition(async () => {
          const result = await setStatusAction({}, data);
          if (result.error) toast.error(result.error);
          else router.refresh();
        });
      }}
      className={cn(
        "flex flex-col gap-2 rounded-lg border border-transparent transition-colors",
        over && "border-dashed border-foreground/40 bg-surface-2",
        pending && "opacity-70",
      )}
    >
      {children}
    </div>
  );
}
