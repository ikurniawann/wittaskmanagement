import type { TaskStatus } from "@/lib/tasks/service";

// What an outsider is allowed to see on a shared progress page (Owner
// 2026-08-27: project = progress + task list, task = detail + checklist;
// no money, no names, no comments).
//
// The redaction lives here as pure functions rather than in the query, so the
// rule is one readable list with tests around it. A field that is not built
// here cannot leak later by someone widening a `select *` upstream.

export interface InternalTaskRow {
  id: string;
  title: string;
  status: TaskStatus;
  priority: string;
  divisionId: string;
  startDate: Date | null;
  dueDate: Date | null;
  restricted: boolean;
}

export interface PublicTaskRow {
  title: string;
  status: TaskStatus;
  priority: string;
  divisionId: string;
  startDate: string | null;
  dueDate: string | null;
  overdue: boolean;
}

/**
 * A restricted task is invisible to outsiders — full stop.
 *
 * It is the flag someone ticked to keep a task away from most of their OWN
 * colleagues, so letting it through to a link sent outside the company would
 * invert its meaning. Filtered before anything else so no later branch can
 * accidentally reintroduce it.
 */
export function publicTaskRows(
  rows: InternalTaskRow[],
  now: Date,
): PublicTaskRow[] {
  const today = dayNumber(now);
  return rows
    .filter((t) => !t.restricted)
    .map((t) => ({
      title: t.title,
      status: t.status,
      priority: t.priority,
      divisionId: t.divisionId,
      startDate: t.startDate ? t.startDate.toISOString() : null,
      dueDate: t.dueDate ? t.dueDate.toISOString() : null,
      overdue:
        t.status !== "done" &&
        t.status !== "cancelled" &&
        t.dueDate !== null &&
        dayNumber(t.dueDate) < today,
    }))
    .sort((a, b) => {
      // soonest deadline first; undated work sinks to the bottom rather than
      // pretending to be urgent
      if (a.dueDate === null && b.dueDate === null) return a.title.localeCompare(b.title);
      if (a.dueDate === null) return 1;
      if (b.dueDate === null) return -1;
      if (a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? -1 : 1;
      return a.title.localeCompare(b.title);
    });
}

/** Whole-day comparison in WIB, matching the calendar and the gantt. */
function dayNumber(date: Date): number {
  const wib = new Date(date.getTime() + 7 * 3600_000);
  return Math.floor(
    Date.UTC(wib.getUTCFullYear(), wib.getUTCMonth(), wib.getUTCDate()) / 86_400_000,
  );
}

export interface InternalChecklistItem {
  title: string;
  done: boolean;
  startDate: Date | null;
  dueDate: Date | null;
}

export interface PublicChecklistItem {
  title: string;
  done: boolean;
  dueDate: string | null;
}

/** Checklist items carry no assignee or note, so they pass through nearly
 *  whole — only the dates are normalised and the note is dropped. */
export function publicChecklist(
  items: InternalChecklistItem[],
): { items: PublicChecklistItem[]; done: number; total: number; pct: number | null } {
  const mapped = items.map((i) => ({
    title: i.title,
    done: i.done,
    dueDate: i.dueDate ? i.dueDate.toISOString() : null,
  }));
  const done = mapped.filter((i) => i.done).length;
  return {
    items: mapped,
    done,
    total: mapped.length,
    pct: mapped.length === 0 ? null : Math.round((done / mapped.length) * 100),
  };
}
