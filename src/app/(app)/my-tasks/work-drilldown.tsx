"use client";

import Link from "next/link";
import { Loader2 } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { EventChip } from "@/components/event-chip";
import { PriorityIcon, StatusChip } from "@/components/task-meta";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import type { MyWorkFilter, MyWorkRow, MyWorkSource } from "@/lib/tasks/my-work";
import { cn } from "@/lib/utils";
import { myWorkDrilldownAction } from "./actions";

// A Summary number you can click (Owner 2026-08-31). The card or bar row is
// the trigger; the popup lists exactly the tasks that number counted, each a
// link into the task itself.

const dt = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  timeZone: "Asia/Jakarta",
});

export function WorkDrilldown({
  source,
  filter = {},
  title,
  expected,
  className,
  children,
}: {
  source: MyWorkSource;
  filter?: MyWorkFilter;
  /** dialog heading, e.g. "Tasks assigned" or "In progress" */
  title: string;
  /** the number on the card — so the header can say it, and a mismatch shows */
  expected: number;
  className?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<MyWorkRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Reset happens in the click handler, not here: the compiler's lint rule
  // forbids a synchronous setState inside an effect, and it is right — the
  // effect's only job is the fetch.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    void myWorkDrilldownAction(source, filter).then((res) => {
      if (!alive) return;
      if ("error" in res) setError(res.error);
      else setRows(res.rows);
    });
    return () => {
      alive = false;
    };
    // filter is a fresh object literal on every render; key on its parts
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, source, filter.status, filter.priority]);

  const count = rows?.length ?? expected;

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setRows(null);
          setError(null);
          setOpen(true);
        }}
        aria-haspopup="dialog"
        title={`Show the ${expected} task${expected === 1 ? "" : "s"}`}
        className={cn(
          "text-left transition-colors hover:border-foreground/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
          className,
        )}
      >
        {children}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="!max-w-2xl gap-3 p-0">
          <div className="flex items-baseline gap-2 border-b px-5 pb-3 pt-4">
            <DialogTitle className="text-sm font-semibold">{title}</DialogTitle>
            <span className="text-xs tabular-nums text-muted-foreground">
              {count} task{count === 1 ? "" : "s"}
            </span>
          </div>

          <div className="max-h-[70svh] overflow-y-auto px-2 pb-2">
            {error ? (
              <p role="alert" className="px-3 py-8 text-center text-sm text-destructive">
                {error}
              </p>
            ) : rows === null ? (
              <p className="flex items-center justify-center gap-2 py-10 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" /> Loading…
              </p>
            ) : rows.length === 0 ? (
              <p className="px-3 py-8 text-center text-sm text-muted-foreground">
                Nothing here.
              </p>
            ) : (
              <ul className="flex flex-col divide-y">
                {rows.map((t) => (
                  <li key={t.id}>
                    <Link
                      href={`/tasks/${t.id}`}
                      // close this popup first: the task opens as its own
                      // full-screen dialog, and two stacked would be a mess
                      onClick={() => setOpen(false)}
                      className="flex items-center gap-3 rounded-md px-3 py-2.5 text-sm transition-colors hover:bg-accent/50"
                    >
                      <PriorityIcon priority={t.priority} />
                      <span className="min-w-0 flex-1 truncate font-medium">{t.title}</span>
                      <EventChip name={t.eventName} className="hidden sm:inline-flex" />
                      <StatusChip status={t.status as never} />
                      <span className="w-14 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                        {t.dueDate ? dt.format(new Date(t.dueDate)) : "—"}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
