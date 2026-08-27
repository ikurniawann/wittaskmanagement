import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CalendarGrid } from "@/components/calendar-grid";
import { CalendarMonthNav } from "@/components/calendar-month-nav";
import { sessionActor } from "@/lib/auth/session-actor";
import { buildCalendarEntries, type CalendarTask } from "@/lib/calendar/aggregate";
import { parseMonthParam } from "@/lib/calendar/month-param";
import { listActiveEvents } from "@/lib/events/service";
import { can } from "@/lib/permissions";
import { listEventTasks } from "@/lib/tasks/service";

export const metadata: Metadata = { title: "Calendar" };

// T-081: global calendar — every event this actor can see, plus their
// division-scoped tasks with a due date, on one Monday-first month grid.
// Data access goes through the same permission-scoped service functions as
// the events/board/list pages (listActiveEvents + listEventTasks per event).
export default async function CalendarPage({
  searchParams,
}: PageProps<"/calendar">) {
  const actor = await sessionActor();
  if (!actor) redirect("/login");

  const sp = await searchParams;
  const m = typeof sp.m === "string" ? sp.m : undefined;
  const { year, monthIndex } = parseMonthParam(m);

  const events = can(actor, "event.view") ? await listActiveEvents(actor) : [];
  const taskLists = await Promise.all(
    events.map((event) => listEventTasks(actor, event.id)),
  );
  const tasks: CalendarTask[] = taskLists.flat().map((t) => ({
    id: t.id,
    eventId: t.eventId,
    divisionId: t.divisionId,
    title: t.title,
    status: t.status,
    startDate: t.startDate,
    dueDate: t.dueDate,
  }));

  const entries = buildCalendarEntries({
    tasks,
    events: events.map((e) => ({ id: e.id, name: e.name, showDate: e.showDate })),
  });
  const eventNames = new Map(events.map((e) => [e.id, e.name]));

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-semibold tracking-tight">
            Calendar
          </h1>
          <p className="text-sm text-muted-foreground">
            Show dates and task deadlines across every event, one month at a time.
          </p>
        </div>
      </div>

      <CalendarMonthNav basePath="/calendar" year={year} monthIndex={monthIndex} />

      {events.length === 0 ? (
        <p className="rounded-md border border-dashed px-4 py-6 text-sm text-muted-foreground">
          No projects visible to you yet.
        </p>
      ) : (
        <CalendarGrid
          year={year}
          monthIndex={monthIndex}
          entries={entries}
          eventNames={eventNames}
        />
      )}

      <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="text-[9px]">●</span> Launch date
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="text-[9px]">○</span> Task deadline
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="inline-block h-2.5 w-6 rounded-sm border bg-card" />
          Start → due
        </span>
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="inline-block h-2.5 w-6 rounded-sm border border-destructive bg-destructive/15"
          />
          Overdue
        </span>
      </div>
    </section>
  );
}
