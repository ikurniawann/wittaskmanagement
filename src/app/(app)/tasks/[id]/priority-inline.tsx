"use client";

import { ChevronDown } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { PriorityIcon } from "@/components/task-meta";
import { cn } from "@/lib/utils";
import { setPriorityAction } from "../actions";

// Priority, editable where it is displayed (Owner 2026-08-12). It was always
// editable — inside the Edit form behind a small ghost button — and the Owner
// could not find it. A control nobody finds is a control that does not exist,
// so the badge itself became the control, the way Linear and Plane do it.

const PRIORITIES = ["urgent", "high", "medium", "low"] as const;
type Priority = (typeof PRIORITIES)[number];

export function PriorityInline({
  taskId,
  priority,
}: {
  taskId: string;
  priority: Priority;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", away, true);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", away, true);
      document.removeEventListener("keydown", key);
    };
  }, [open]);

  const choose = (next: Priority) => {
    setOpen(false);
    if (next === priority) return;
    const data = new FormData();
    data.set("taskId", taskId);
    data.set("priority", next);
    startTransition(async () => {
      const result = await setPriorityAction({}, data);
      if (result.error) toast.error(result.error);
      else router.refresh();
    });
  };

  return (
    <div ref={ref} className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={pending}
        aria-label="Change priority"
        className={cn(
          "flex cursor-pointer items-center gap-1 rounded-md border border-transparent px-1.5 py-0.5 transition-colors",
          "hover:border-border hover:bg-surface-2",
          pending && "opacity-60",
        )}
      >
        <PriorityIcon priority={priority} withLabel />
        <ChevronDown className="size-3 text-muted-foreground" />
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute left-0 top-full z-40 mt-1 flex w-36 flex-col rounded-md border bg-popover p-1 shadow-lg"
        >
          {PRIORITIES.map((option) => (
            <button
              key={option}
              role="menuitem"
              type="button"
              onClick={() => choose(option)}
              className={cn(
                "flex items-center gap-2 rounded px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-surface-2",
                option === priority && "bg-surface-2",
              )}
            >
              <PriorityIcon priority={option} withLabel />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
