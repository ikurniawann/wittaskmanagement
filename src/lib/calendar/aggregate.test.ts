import { describe, expect, it } from "vitest";
import {
  buildCalendarEntries,
  buildWeekSegments,
  cellKey,
  dayKey,
  groupEntriesByDay,
  monthMatrix,
  type CalendarEvent,
  type CalendarTask,
} from "./aggregate";

// Minimal fixtures mirroring src/db/schema/tasks.ts + events.ts shapes.

function makeTask(overrides: Partial<CalendarTask> = {}): CalendarTask {
  return {
    id: "task-1",
    eventId: "event-1",
    divisionId: "production",
    title: "Confirm rider",
    status: "todo",
    startDate: null,
    dueDate: new Date("2026-08-10T03:00:00Z"),
    ...overrides,
  };
}

// Fixed "today" so overdue assertions never depend on the wall clock.
const NOW = new Date("2026-08-15T03:00:00Z");

function makeEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: "event-1",
    name: "Summer Fest",
    showDate: new Date("2026-09-01T10:00:00Z"),
    ...overrides,
  };
}

describe("buildCalendarEntries", () => {
  it("produces a deadline entry for a task with a dueDate, deep-linked to the list view", () => {
    const task = makeTask({ id: "task-42", eventId: "event-7", dueDate: new Date("2026-08-10T03:00:00Z") });
    const entries = buildCalendarEntries({ tasks: [task], events: [] });

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      kind: "deadline",
      eventId: "event-7",
      taskId: "task-42",
      title: "Confirm rider",
      href: "/tasks/task-42",
      done: false,
    });
    expect(entries[0].date.getTime()).toBe(task.dueDate!.getTime());
  });

  it("excludes tasks with no dueDate from the aggregate", () => {
    const withDue = makeTask({ id: "has-due", dueDate: new Date("2026-08-10T00:00:00Z") });
    const withoutDue = makeTask({ id: "no-due", dueDate: null });

    const entries = buildCalendarEntries({ tasks: [withDue, withoutDue], events: [] });

    expect(entries).toHaveLength(1);
    expect(entries[0].taskId).toBe("has-due");
  });

  it("keeps done tasks in the aggregate, flagged done: true (aggregates must match underlying data)", () => {
    const doneTask = makeTask({ id: "done-task", status: "done", dueDate: new Date("2026-08-10T00:00:00Z") });

    const entries = buildCalendarEntries({ tasks: [doneTask], events: [] });

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ taskId: "done-task", done: true });
  });

  it("excludes cancelled tasks entirely", () => {
    const cancelled = makeTask({ id: "cancelled-task", status: "cancelled", dueDate: new Date("2026-08-10T00:00:00Z") });

    const entries = buildCalendarEntries({ tasks: [cancelled], events: [] });

    expect(entries).toHaveLength(0);
  });

  it("always produces a show entry for an event's showDate, deep-linked to the event", () => {
    const event = makeEvent({ id: "event-9", name: "Winter Gala", showDate: new Date("2026-12-05T09:00:00Z") });

    const entries = buildCalendarEntries({ tasks: [], events: [event] });

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      kind: "show",
      eventId: "event-9",
      title: "Winter Gala",
      href: "/events/event-9",
    });
    expect(entries[0].date.getTime()).toBe(event.showDate.getTime());
  });

  it("merges multiple events' entries into one list sorted by date (global view)", () => {
    const eventA = makeEvent({ id: "event-a", showDate: new Date("2026-10-15T00:00:00Z") });
    const eventB = makeEvent({ id: "event-b", showDate: new Date("2026-08-01T00:00:00Z") });
    const taskC = makeTask({ id: "task-c", eventId: "event-a", dueDate: new Date("2026-09-01T00:00:00Z") });

    const entries = buildCalendarEntries({ tasks: [taskC], events: [eventA, eventB] });

    expect(entries).toHaveLength(3);
    expect(entries.map((e) => e.eventId)).toEqual(["event-b", "event-a", "event-a"]);
    expect(entries.map((e) => e.kind)).toEqual(["show", "deadline", "show"]);
    // sanity: strictly ascending by date
    for (let i = 1; i < entries.length; i++) {
      expect(entries[i].date.getTime()).toBeGreaterThanOrEqual(entries[i - 1].date.getTime());
    }
    expect(entries.map((e) => e.date.getTime())).toEqual(
      [...entries].map((e) => e.date.getTime()).sort((a, b) => a - b),
    );
  });

  it("aggregate entry count matches underlying data: N eligible tasks + M events", () => {
    const tasks = [
      makeTask({ id: "t1", dueDate: new Date("2026-08-01T00:00:00Z") }),
      makeTask({ id: "t2", dueDate: null }), // excluded
      makeTask({ id: "t3", status: "cancelled", dueDate: new Date("2026-08-02T00:00:00Z") }), // excluded
      makeTask({ id: "t4", status: "done", dueDate: new Date("2026-08-03T00:00:00Z") }), // included, done
    ];
    const events = [makeEvent({ id: "e1" }), makeEvent({ id: "e2", showDate: new Date("2026-08-20T00:00:00Z") })];

    const entries = buildCalendarEntries({ tasks, events });

    // 2 eligible tasks (t1, t4) + 2 events = 4
    expect(entries).toHaveLength(4);
  });
});

describe("groupEntriesByDay", () => {
  it("buckets two entries on the same WIB day together", () => {
    // Both instants fall before the 17:00Z WIB-day rollover, so both are
    // 2026-08-10 in WIB even though they're several hours apart in UTC.
    const entries = buildCalendarEntries({
      tasks: [
        makeTask({ id: "t1", dueDate: new Date("2026-08-10T02:00:00Z") }),
        makeTask({ id: "t2", dueDate: new Date("2026-08-10T16:00:00Z") }),
      ],
      events: [],
    });

    const grouped = groupEntriesByDay(entries);
    const key = "2026-08-10";

    expect(grouped.get(key)).toHaveLength(2);
  });

  // WIB is UTC+7, so the WIB day rolls over at 17:00 UTC. These instants are
  // deterministic on ANY host/process timezone — groupEntriesByDay must key
  // by the explicit Asia/Jakarta calendar day, never the server-local day.
  it("keys by WIB (Asia/Jakarta) day, not the host's local day, just before the 17:00Z rollover", () => {
    const justBeforeRollover = new Date("2026-08-10T16:59:59Z");
    const entries = buildCalendarEntries({
      tasks: [makeTask({ id: "t1", dueDate: justBeforeRollover })],
      events: [],
    });

    const grouped = groupEntriesByDay(entries);

    expect(grouped.has("2026-08-10")).toBe(true);
    expect(grouped.has("2026-08-11")).toBe(false);
  });

  it("keys by WIB (Asia/Jakarta) day, not the host's local day, right at the 17:00Z rollover", () => {
    const atRollover = new Date("2026-08-10T17:00:00Z");
    const entries = buildCalendarEntries({
      tasks: [makeTask({ id: "t1", dueDate: atRollover })],
      events: [],
    });

    const grouped = groupEntriesByDay(entries);

    expect(grouped.has("2026-08-11")).toBe(true);
    expect(grouped.has("2026-08-10")).toBe(false);
  });

  it("returns an empty map for an empty entry list", () => {
    const grouped = groupEntriesByDay([]);
    expect(grouped.size).toBe(0);
  });
});

describe("dayKey vs monthMatrix consistency", () => {
  it("dayKey resolves explicit WIB-midnight instants to the correct WIB calendar day, host-TZ independent", () => {
    // WIB is UTC+7, so WIB midnight of day d is (d 00:00 UTC) - 7h.
    for (const d of [1, 10, 17, 31]) {
      const wibMidnight = new Date(Date.UTC(2026, 7, d) - 7 * 3600_000);
      expect(dayKey(wibMidnight)).toBe(`2026-08-${String(d).padStart(2, "0")}`);
    }
  });

  it("cellKey on every August 2026 monthMatrix cell matches that cell's own calendar day, host-TZ independent", () => {
    const weeks = monthMatrix(2026, 7); // August 2026
    const augustDays = weeks.flat().filter((d) => d.getMonth() === 7);

    for (const d of augustDays) {
      const key = cellKey(d);
      expect(key).toBe(
        `2026-08-${String(d.getDate()).padStart(2, "0")}`,
      );
    }
  });
});

describe("monthMatrix", () => {
  it("contains every day of the month exactly once", () => {
    // August 2026 has 31 days.
    const weeks = monthMatrix(2026, 7); // 0-indexed month: August

    const allDays = weeks.flat();
    const augustDaysInGrid = allDays.filter(
      (d) => d.getFullYear() === 2026 && d.getMonth() === 7,
    );

    expect(augustDaysInGrid).toHaveLength(31);
    for (let day = 1; day <= 31; day++) {
      expect(
        augustDaysInGrid.some((d) => d.getDate() === day),
      ).toBe(true);
    }
  });

  it("each week has 7 days and every week starts on Monday", () => {
    const weeks = monthMatrix(2026, 7); // August 2026

    for (const week of weeks) {
      expect(week).toHaveLength(7);
      expect(week[0].getDay()).toBe(1); // Monday
    }
  });

  it("handles a month that starts on a Sunday (leading days from prior month fill week 1)", () => {
    // November 2026 starts on a Sunday.
    const weeks = monthMatrix(2026, 10); // 0-indexed: November

    expect(new Date(2026, 10, 1).getDay()).toBe(0); // sanity: confirms Sunday start

    const firstWeek = weeks[0];
    expect(firstWeek).toHaveLength(7);
    expect(firstWeek[0].getDay()).toBe(1); // still starts Monday
    // the 1st of November should appear as the last day of the first week (Sunday slot)
    expect(firstWeek[6].getDate()).toBe(1);
    expect(firstWeek[6].getMonth()).toBe(10);
  });

  it("produces only whole weeks (length is a multiple of 7)", () => {
    const weeks = monthMatrix(2026, 1); // February 2026 (28 days, starts Sunday)
    const allDays = weeks.flat();
    expect(allDays.length % 7).toBe(0);
  });
});

// --- start → due spans and overdue (Owner 2026-08-14) --------------------

describe("buildCalendarEntries spans", () => {
  it("spans a task from its startDate to its dueDate", () => {
    const [entry] = buildCalendarEntries({
      tasks: [
        makeTask({
          startDate: new Date("2026-08-05T03:00:00Z"),
          dueDate: new Date("2026-08-10T03:00:00Z"),
        }),
      ],
      events: [],
      now: NOW,
    });
    expect(entry.start.toISOString()).toBe("2026-08-05T03:00:00.000Z");
    expect(entry.end.toISOString()).toBe("2026-08-10T03:00:00.000Z");
  });

  it("collapses to a single day when the task has no startDate", () => {
    const [entry] = buildCalendarEntries({ tasks: [makeTask()], events: [], now: NOW });
    expect(entry.start.getTime()).toBe(entry.end.getTime());
  });

  it("never draws backwards: a startDate after the dueDate collapses to one day", () => {
    const [entry] = buildCalendarEntries({
      tasks: [
        makeTask({
          startDate: new Date("2026-08-20T03:00:00Z"),
          dueDate: new Date("2026-08-10T03:00:00Z"),
        }),
      ],
      events: [],
      now: NOW,
    });
    expect(entry.start.getTime()).toBe(entry.end.getTime());
  });

  it("a show entry spans exactly its own day", () => {
    const [entry] = buildCalendarEntries({ tasks: [], events: [makeEvent()], now: NOW });
    expect(entry.start.getTime()).toBe(entry.end.getTime());
    expect(entry.overdue).toBeUndefined();
  });
});

describe("overdue", () => {
  it("flags a not-done task whose due day has passed", () => {
    const [entry] = buildCalendarEntries({
      tasks: [makeTask({ dueDate: new Date("2026-08-14T03:00:00Z") })],
      events: [],
      now: NOW,
    });
    expect(entry.overdue).toBe(true);
  });

  it("does NOT flag a task due today — a deadline is whole-day", () => {
    const [entry] = buildCalendarEntries({
      tasks: [makeTask({ dueDate: new Date("2026-08-15T23:00:00Z") })],
      events: [],
      now: NOW,
    });
    expect(entry.overdue).toBe(false);
  });

  it("does NOT flag a done task, even one finished late", () => {
    const [entry] = buildCalendarEntries({
      tasks: [makeTask({ status: "done", dueDate: new Date("2026-08-01T03:00:00Z") })],
      events: [],
      now: NOW,
    });
    expect(entry.overdue).toBe(false);
  });
});

describe("buildWeekSegments", () => {
  // Mon 2026-08-10 .. Sun 2026-08-16
  const week = Array.from({ length: 7 }, (_, i) => new Date(2026, 7, 10 + i));

  function spanEntry(id: string, startDay: number, endDay: number) {
    return buildCalendarEntries({
      tasks: [
        makeTask({
          id,
          startDate: new Date(Date.UTC(2026, 7, startDay, 3)),
          dueDate: new Date(Date.UTC(2026, 7, endDay, 3)),
        }),
      ],
      events: [],
      now: NOW,
    })[0];
  }

  it("maps a Wed→Fri span onto columns 2..4", () => {
    const [segment] = buildWeekSegments(week, [spanEntry("t", 12, 14)]);
    expect(segment.colStart).toBe(2);
    expect(segment.colEnd).toBe(4);
    expect(segment.clippedLeft).toBe(false);
    expect(segment.clippedRight).toBe(false);
  });

  it("clips a span that starts before the week and ends after it", () => {
    const [segment] = buildWeekSegments(week, [spanEntry("t", 3, 20)]);
    expect(segment.colStart).toBe(0);
    expect(segment.colEnd).toBe(6);
    expect(segment.clippedLeft).toBe(true);
    expect(segment.clippedRight).toBe(true);
  });

  it("puts overlapping spans in different lanes", () => {
    const segments = buildWeekSegments(week, [
      spanEntry("a", 10, 13),
      spanEntry("b", 12, 15),
    ]);
    const lanes = segments.map((s) => s.lane).sort();
    expect(lanes).toEqual([0, 1]);
  });

  it("reuses a lane once it is free, so non-overlapping spans stay compact", () => {
    const segments = buildWeekSegments(week, [
      spanEntry("a", 10, 11),
      spanEntry("b", 13, 14),
    ]);
    expect(segments.every((s) => s.lane === 0)).toBe(true);
  });

  it("omits entries that fall entirely outside the week", () => {
    expect(buildWeekSegments(week, [spanEntry("t", 1, 3)])).toHaveLength(0);
  });

  it("is stable regardless of input order", () => {
    const a = spanEntry("aaa", 10, 12);
    const b = spanEntry("bbb", 10, 12);
    const forward = buildWeekSegments(week, [a, b]).map((s) => s.entry.taskId);
    const reversed = buildWeekSegments(week, [b, a]).map((s) => s.entry.taskId);
    expect(forward).toEqual(reversed);
  });
});
