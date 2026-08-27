import type { Metadata } from "next";
import { ScheduleViewToggle } from "@/components/schedule-view-toggle";
import { notFound, redirect } from "next/navigation";
import { CalendarGrid } from "@/components/calendar-grid";
import { CalendarMonthNav } from "@/components/calendar-month-nav";
import { sessionActor } from "@/lib/auth/session-actor";
import { buildCalendarEntries, type CalendarTask } from "@/lib/calendar/aggregate";
import { parseMonthParam } from "@/lib/calendar/month-param";
import { getEvent } from "@/lib/events/service";
import { listEventTasks } from "@/lib/tasks/service";

export const metadata: Metadata = { title: "Calendar" };

// T-081: per-event calendar tab — this event's show date plus its
// division-scoped tasks with a due date, same Monday-first month grid as
// /calendar. listEventTasks already scopes tasks to divisions this actor
// may see (see src/lib/tasks/service.ts).
export default async function EventCalendarPage({
  params,
  searchParams,
}: PageProps<"/events/[id]/calendar">) {
  const actor = await sessionActor();
  if (!actor) redirect("/login");

  const { id } = await params;
  const event = await getEvent(actor, id);
  if (!event) notFound();

  const sp = await searchParams;
  const m = typeof sp.m === "string" ? sp.m : undefined;
  const { year, monthIndex } = parseMonthParam(m);

  const rows = await listEventTasks(actor, id);
  const tasks: CalendarTask[] = rows.map((t) => ({
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
    events: [{ id: event.id, name: event.name, showDate: event.showDate }],
  });

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">
            Schedule
          </h1>
          <ScheduleViewToggle eventId={id} active="calendar" />
        </div>
      </div>

      <CalendarMonthNav
        basePath={`/events/${id}/calendar`}
        year={year}
        monthIndex={monthIndex}
      />

      <CalendarGrid year={year} monthIndex={monthIndex} entries={entries} />

      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="text-[9px]">●</span> Show date
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="text-[9px]">○</span> Task deadline
        </span>
      </div>
    </section>
  );
}
