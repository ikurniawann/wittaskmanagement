import { toWibParts } from "@/lib/tasks/dates";
import type { TaskStatus } from "@/lib/tasks/service";

// T-081: pure calendar aggregation — no DB/permission access here. Callers
// (the calendar pages) fetch already-permission-scoped tasks/events via the
// service layer and hand them to this module to merge/sort/group.

export interface CalendarTask {
  id: string;
  eventId: string;
  divisionId: string;
  title: string;
  status: TaskStatus;
  startDate: Date | null;
  dueDate: Date | null;
}

export interface CalendarEvent {
  id: string;
  name: string;
  showDate: Date;
}

export type CalendarEntryKind = "deadline" | "show";

export interface CalendarEntry {
  kind: CalendarEntryKind;
  eventId: string;
  /** present only for "deadline" entries */
  taskId?: string;
  title: string;
  href: string;
  /**
   * The entry's anchor day — the due date for a deadline, the show date for a
   * show. Grouping and sorting key; `start`/`end` describe the span it draws.
   */
  date: Date;
  /** first day the bar covers; equals `date` when the task has no start date */
  start: Date;
  /** last day the bar covers; always `date` */
  end: Date;
  /** present only for "deadline" entries */
  done?: boolean;
  /** past its due day and not done — drawn red (present only for deadlines) */
  overdue?: boolean;
}

// Deep-links reuse the real app routes: a task deadline opens the task
// (intercepted as a drawer app-wide, see src/app/(app)/@modal/(...)tasks),
// a show date opens the event workspace.
export function buildCalendarEntries({
  tasks,
  events,
  now = new Date(),
}: {
  tasks: CalendarTask[];
  events: CalendarEvent[];
  /** injectable so tests are not clock-dependent */
  now?: Date;
}): CalendarEntry[] {
  const todayIndex = wibDayNumber(now);

  const deadlineEntries: CalendarEntry[] = tasks
    .filter(
      (task): task is CalendarTask & { dueDate: Date } =>
        task.dueDate !== null && task.status !== "cancelled",
    )
    .map((task) => {
      const done = task.status === "done";
      // A start date only widens the bar backwards; one that lands after the
      // due date is bad data, not a backwards bar, so it collapses to a
      // single day rather than rendering right-to-left.
      const start =
        task.startDate && wibDayNumber(task.startDate) <= wibDayNumber(task.dueDate)
          ? task.startDate
          : task.dueDate;
      return {
        kind: "deadline" as const,
        eventId: task.eventId,
        taskId: task.id,
        title: task.title,
        href: `/tasks/${task.id}`,
        date: task.dueDate,
        start,
        end: task.dueDate,
        done,
        // "overdue" is whole-day, not to-the-minute: a task due today stays
        // amber-free until today is over, matching how people read a deadline.
        overdue: !done && wibDayNumber(task.dueDate) < todayIndex,
      };
    });

  const showEntries: CalendarEntry[] = events.map((event) => ({
    kind: "show",
    eventId: event.id,
    title: event.name,
    href: `/events/${event.id}`,
    date: event.showDate,
    start: event.showDate,
    end: event.showDate,
  }));

  return [...deadlineEntries, ...showEntries].sort(
    (a, b) => a.date.getTime() - b.date.getTime(),
  );
}

// WIB (Asia/Jakarta, UTC+7) calendar day for an instant — matches the list
// view's `timeZone: "Asia/Jakarta"` formatting and src/lib/tasks/dates.ts,
// so a task due at 2026-08-11T00:00:00+07:00 buckets under 2026-08-11
// regardless of the server's local timezone.
export function dayKey(date: Date): string {
  const { y, m, d } = toWibParts(date);
  const month = String(m + 1).padStart(2, "0");
  const day = String(d).padStart(2, "0");
  return `${y}-${month}-${day}`;
}

// Grid-cell key for a monthMatrix() Date: monthMatrix builds cells from
// calendar components (new Date(year, month, day)), i.e. server-local
// midnight instants — NOT WIB instants. Keying those with dayKey (which
// reads WIB components) shifts every cell back a day on hosts east of
// UTC+7. cellKey reads the same calendar components the cell was built
// from, so it always matches the cell's intended calendar day regardless
// of host timezone.
export function cellKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** WIB calendar-day number for an instant — the unit spans are measured in. */
export function wibDayNumber(date: Date): number {
  const { y, m, d } = toWibParts(date);
  return Math.floor(Date.UTC(y, m, d) / 86_400_000);
}

/** Same day number, but read from a monthMatrix cell's own calendar
 *  components — cells are server-local midnights, not WIB instants (see
 *  cellKey above for why the two must not be mixed). */
export function cellDayNumber(date: Date): number {
  return Math.floor(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000,
  );
}

/** One entry's slice of a single week row. */
export interface WeekSegment {
  entry: CalendarEntry;
  /** 0-6 index of the first covered column in this week */
  colStart: number;
  /** 0-6 index of the last covered column in this week */
  colEnd: number;
  /** stacking row within the cell, so overlapping bars never collide */
  lane: number;
  /** the span begins in an earlier week — draw a flat left edge */
  clippedLeft: boolean;
  /** the span continues into a later week — draw a flat right edge */
  clippedRight: boolean;
}

/**
 * Lay one week's worth of bars out into lanes. Entries are placed longest-
 * first so multi-day bars settle into the top lanes and single days fill in
 * beneath, which keeps a month from looking like a staircase. A lane is
 * reused as soon as it is free, so a week of short tasks stays compact.
 */
export function buildWeekSegments(
  week: Date[],
  entries: CalendarEntry[],
): WeekSegment[] {
  if (week.length === 0) return [];
  const weekStart = cellDayNumber(week[0]);
  const weekEnd = cellDayNumber(week[week.length - 1]);

  const overlapping = entries
    .map((entry) => {
      const start = wibDayNumber(entry.start);
      const end = wibDayNumber(entry.end);
      return { entry, start, end };
    })
    .filter((s) => s.end >= weekStart && s.start <= weekEnd)
    .sort((a, b) => {
      const spanA = a.end - a.start;
      const spanB = b.end - b.start;
      if (spanA !== spanB) return spanB - spanA; // longest first
      if (a.start !== b.start) return a.start - b.start;
      // stable regardless of DB row order
      return (a.entry.taskId ?? a.entry.eventId).localeCompare(
        b.entry.taskId ?? b.entry.eventId,
      );
    });

  // laneEnds[i] = last column occupied in lane i, -1 when the lane is free
  const laneEnds: number[] = [];
  const segments: WeekSegment[] = [];

  for (const { entry, start, end } of overlapping) {
    const colStart = Math.max(0, start - weekStart);
    const colEnd = Math.min(week.length - 1, end - weekStart);
    let lane = laneEnds.findIndex((occupiedUntil) => occupiedUntil < colStart);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(colEnd);
    } else {
      laneEnds[lane] = colEnd;
    }
    segments.push({
      entry,
      colStart,
      colEnd,
      lane,
      clippedLeft: start < weekStart,
      clippedRight: end > weekEnd,
    });
  }

  return segments;
}

export function groupEntriesByDay(
  entries: CalendarEntry[],
): Map<string, CalendarEntry[]> {
  const grouped = new Map<string, CalendarEntry[]>();
  for (const entry of entries) {
    const key = dayKey(entry.date);
    const bucket = grouped.get(key);
    if (bucket) {
      bucket.push(entry);
    } else {
      grouped.set(key, [entry]);
    }
  }
  return grouped;
}

// Monday-first month grid: every week is exactly 7 days, padded with the
// trailing days of the previous/next month so the grid is whole weeks only.
export function monthMatrix(year: number, monthIndex: number): Date[][] {
  const firstOfMonth = new Date(year, monthIndex, 1);
  const lastOfMonth = new Date(year, monthIndex + 1, 0);

  // JS getDay(): 0=Sunday..6=Saturday. Shift so Monday=0..Sunday=6.
  const leadingOffset = (firstOfMonth.getDay() + 6) % 7;
  const trailingOffset = (7 - lastOfMonth.getDay()) % 7;

  const gridStart = new Date(year, monthIndex, 1 - leadingOffset);
  const gridEnd = new Date(
    year,
    monthIndex,
    lastOfMonth.getDate() + trailingOffset,
  );

  const days: Date[] = [];
  for (
    let cur = new Date(gridStart);
    cur.getTime() <= gridEnd.getTime();
    cur = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() + 1)
  ) {
    days.push(new Date(cur));
  }

  const weeks: Date[][] = [];
  for (let i = 0; i < days.length; i += 7) {
    weeks.push(days.slice(i, i + 7));
  }
  return weeks;
}
