import type { Metadata } from "next";
import Link from "next/link";
import { ScheduleViewToggle } from "@/components/schedule-view-toggle";
import { notFound, redirect } from "next/navigation";
import { StatusDot, type StatusKey } from "@/components/task-meta";
import { sessionActor } from "@/lib/auth/session-actor";
import { getEvent, listEventDivisions } from "@/lib/events/service";
import { buildGanttModel, wibDayIndex, type GanttBar } from "@/lib/gantt/schedule";
import {
  listCrossEventDependencies,
  listEventTaskDependencies,
  listEventTasks,
} from "@/lib/tasks/service";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Gantt" };

// T-080: per-event Gantt/timeline tab. This is a server component that
// re-fetches actor + tasks + dependencies on every request (no client
// cache), so it always reflects live task edits — same dynamic-rendering
// shape as the board/list/calendar tabs.

const DAY_MS = 86_400_000;
const MAX_VISIBLE_DAYS = 400; // ~13 months; keeps the grid from exploding
const LABEL_COL = "220px";
const DAY_COL = "30px";

function dayIndexToDate(dayIndex: number): Date {
  return new Date(dayIndex * DAY_MS);
}

const dayFmt = new Intl.DateTimeFormat("en-GB", { day: "2-digit", timeZone: "UTC" });
const dayFullFmt = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

interface GanttRow {
  taskId: string;
  title: string;
  status: StatusKey;
  bar: GanttBar;
  isCritical: boolean;
  /** past its due day and not done — drawn red (Owner 2026-08-14) */
  isOverdue: boolean;
  blockedByTitles: string[];
}

type GridRow =
  | { kind: "header" }
  | { kind: "division"; name: string }
  | { kind: "task"; row: GanttRow };

export default async function EventGanttPage({
  params,
}: PageProps<"/events/[id]/gantt">) {
  const actor = await sessionActor();
  if (!actor) redirect("/login");

  const { id } = await params;
  const event = await getEvent(actor, id);
  if (!event) notFound();

  const [tasks, dependencyRows, divisions, crossEventDeps] = await Promise.all([
    listEventTasks(actor, id),
    listEventTaskDependencies(actor, id),
    listEventDivisions(actor, id),
    listCrossEventDependencies(actor, id),
  ]);

  const model = buildGanttModel({
    tasks: tasks.map((t) => ({
      id: t.id,
      status: t.status,
      startDate: t.startDate,
      dueDate: t.dueDate,
    })),
    dependencies: dependencyRows,
    showDate: event.showDate,
  });

  const taskById = new Map(tasks.map((t) => [t.id, t]));
  const barByTaskId = new Map(model.bars.map((b) => [b.taskId, b]));
  const criticalSet = new Set(model.criticalTaskIds);
  const blockersOf = new Map<string, string[]>();
  for (const arrow of model.arrows) {
    const list = blockersOf.get(arrow.to) ?? [];
    list.push(taskById.get(arrow.from)?.title ?? arrow.from);
    blockersOf.set(arrow.to, list);
  }

  const showIdx = wibDayIndex(event.showDate);
  // whole-day comparison, same rule as the calendar: a task due today is not
  // overdue until today is over
  const todayIdx = wibDayIndex(new Date());
  const rangeStart =
    model.bars.length > 0
      ? Math.min(...model.bars.map((b) => wibDayIndex(b.start)))
      : showIdx;
  const rangeEndRaw =
    model.bars.length > 0
      ? Math.max(Math.max(...model.bars.map((b) => wibDayIndex(b.end))), showIdx)
      : showIdx;
  const rangeEnd = Math.min(rangeEndRaw, rangeStart + MAX_VISIBLE_DAYS - 1);
  const dayCount = rangeEnd - rangeStart + 1;
  const showCol = clamp(showIdx - rangeStart, 0, dayCount - 1);

  const groups = divisions
    .map((division) => ({
      division,
      rows: tasks
        .filter((t) => t.divisionId === division.id && barByTaskId.has(t.id))
        .map(
          (t): GanttRow => ({
            taskId: t.id,
            title: t.title,
            status: t.status,
            bar: barByTaskId.get(t.id)!,
            isCritical: criticalSet.has(t.id),
            isOverdue:
              t.status !== "done" &&
              t.dueDate !== null &&
              wibDayIndex(t.dueDate) < todayIdx,
            blockedByTitles: blockersOf.get(t.id) ?? [],
          }),
        )
        .sort((a, b) => a.bar.start.getTime() - b.bar.start.getTime()),
    }))
    .filter((g) => g.rows.length > 0);

  const unscheduledTasks = model.unscheduled
    .map((taskId) => taskById.get(taskId))
    .filter((t): t is NonNullable<typeof t> => Boolean(t));

  const gridRows: GridRow[] = [
    { kind: "header" },
    ...groups.flatMap((g) => [
      { kind: "division" as const, name: g.division.name },
      ...g.rows.map((row) => ({ kind: "task" as const, row })),
    ]),
  ];
  const gridTemplateColumns = `${LABEL_COL} repeat(${dayCount}, ${DAY_COL})`;

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">
            Schedule
          </h1>
          <ScheduleViewToggle eventId={id} active="gantt" />
        </div>
      </div>

      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="inline-block size-2.5 bg-foreground" />
          Critical path
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="inline-block size-2.5 border border-foreground/50" />
          Scheduled
        </span>
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="inline-block size-2.5 border border-destructive bg-destructive/25"
          />
          Overdue
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="inline-block h-2.5 w-px bg-foreground" />
          Launch day — {dayFullFmt.format(event.showDate)}
        </span>
      </div>

      {groups.length === 0 ? (
        <p className="rounded-md border border-dashed px-4 py-3 text-sm text-muted-foreground">
          No scheduled tasks yet.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <div className="relative grid w-fit" style={{ gridTemplateColumns }}>
            {/* show-day guideline, spans every row */}
            <div
              aria-hidden
              className="pointer-events-none bg-foreground/[0.06]"
              style={{
                gridColumn: showCol + 2,
                gridRow: `1 / ${gridRows.length + 1}`,
              }}
            />

            {gridRows.map((gridRowItem, i) => (
              <GanttGridRow
                key={
                  gridRowItem.kind === "task"
                    ? gridRowItem.row.taskId
                    : `${gridRowItem.kind}-${i}`
                }
                item={gridRowItem}
                gridRow={i + 1}
                rangeStart={rangeStart}
                dayCount={dayCount}
                showCol={showCol}
              />
            ))}
          </div>
        </div>
      )}

      {unscheduledTasks.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h2 className="text-xs font-semibold text-muted-foreground">
            Unscheduled ({unscheduledTasks.length})
          </h2>
          <ul className="flex flex-wrap gap-2">
            {unscheduledTasks.map((t) => (
              <li key={t.id}>
                <Link
                  href={`/tasks/${t.id}`}
                  className="inline-flex items-center gap-1.5 rounded-sm border px-2.5 py-1 text-xs hover:bg-accent/50"
                >
                  <StatusDot status={t.status} />
                  {t.title}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* cross-event edges can't be drawn as arrows on a one-event chart —
          they surface here instead (EPIC-012) */}
      {crossEventDeps.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h2 className="text-xs font-semibold text-muted-foreground">
            Cross-event dependencies ({crossEventDeps.length})
          </h2>
          <ul className="flex flex-col divide-y rounded-md border bg-card elev">
            {crossEventDeps.map((dep) => (
              <li
                key={`${dep.localTaskId}-${dep.remoteTaskId}`}
                className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-sm"
              >
                <Link
                  href={`/tasks/${dep.localTaskId}`}
                  className="min-w-0 truncate font-medium hover:underline"
                >
                  {dep.localTitle}
                </Link>
                <span className="text-xs text-muted-foreground">
                  {dep.localWaits ? "waits on" : "is blocking"}
                </span>
                <StatusDot status={dep.remoteStatus as StatusKey} />
                <Link
                  href={`/tasks/${dep.remoteTaskId}`}
                  className="min-w-0 truncate hover:underline"
                >
                  {dep.remoteTitle}
                </Link>
                <span className="ml-auto rounded-full border bg-accent/40 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-foreground/80">
                  {dep.remoteEventName}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function GanttGridRow({
  item,
  gridRow,
  rangeStart,
  dayCount,
  showCol,
}: {
  item: GridRow;
  gridRow: number;
  rangeStart: number;
  dayCount: number;
  showCol: number;
}) {
  if (item.kind === "header") {
    return (
      <>
        <div
          className="sticky left-0 z-20 border-b bg-card px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
          style={{ gridColumn: 1, gridRow }}
        >
          Task
        </div>
        {Array.from({ length: dayCount }, (_, i) => (
          <div
            key={i}
            title={dayFullFmt.format(dayIndexToDate(rangeStart + i))}
            className={cn(
              "border-b py-2 text-center text-[9px] tabular-nums text-muted-foreground",
              i === showCol && "font-semibold text-foreground",
            )}
            style={{ gridColumn: i + 2, gridRow }}
          >
            {dayFmt.format(dayIndexToDate(rangeStart + i))}
          </div>
        ))}
      </>
    );
  }

  if (item.kind === "division") {
    // name lives in the FROZEN first column (Owner bug report: it used to
    // span the whole grid and scrolled away); the filler keeps the band
    return (
      <>
        <div
          className="sticky left-0 z-20 border-b bg-card px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider"
          style={{ gridColumn: 1, gridRow }}
        >
          {item.name}
        </div>
        <div
          aria-hidden
          className="border-b bg-muted/40"
          style={{ gridColumn: "2 / -1", gridRow }}
        />
      </>
    );
  }

  const { row } = item;
  const colStart = clamp(wibDayIndex(row.bar.start) - rangeStart, 0, dayCount - 1);
  const colEnd = clamp(wibDayIndex(row.bar.end) - rangeStart, colStart, dayCount - 1);

  return (
    <>
      <div
        className="sticky left-0 z-20 flex items-center gap-1.5 truncate border-b bg-card px-3 py-1.5 text-xs"
        style={{ gridColumn: 1, gridRow }}
      >
        <StatusDot status={row.status} />
        <Link href={`/tasks/${row.taskId}`} className="truncate hover:underline">
          {row.title}
        </Link>
        {row.blockedByTitles.length > 0 ? (
          <span
            title={`Blocked by: ${row.blockedByTitles.join(", ")}`}
            className="ml-auto shrink-0 rounded-full border px-1.5 text-[9px] text-muted-foreground"
          >
            ⛔ {row.blockedByTitles.length}
          </span>
        ) : null}
      </div>
      <Link
        href={`/tasks/${row.taskId}`}
        title={row.title}
        className={cn(
          "z-10 my-1.5 h-4 rounded-sm border",
          // overdue outranks critical: red means "needs action now", and a
          // late task on the critical path is the one that needs it most
          row.isOverdue
            ? row.isCritical
              ? "border-destructive bg-destructive"
              : "border-destructive bg-destructive/25"
            : row.isCritical
              ? "border-foreground bg-foreground"
              : "border-foreground/50 bg-muted",
        )}
        style={{ gridColumn: `${colStart + 2} / ${colEnd + 3}`, gridRow }}
      />
    </>
  );
}
