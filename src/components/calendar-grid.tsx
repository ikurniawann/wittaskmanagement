import Link from "next/link";
import {
  buildWeekSegments,
  cellKey,
  dayKey,
  monthMatrix,
  type CalendarEntry,
} from "@/lib/calendar/aggregate";
import { cn } from "@/lib/utils";

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// Bar geometry. The day-number row sits above the bars, so every cell
// reserves HEADER_PX before the first lane starts.
const HEADER_PX = 26;
const LANE_PX = 18;
const MIN_CELL_PX = 112;

// Month grid: each week is its own 7-column band. Day cells paint the
// background; task bars are absolutely positioned across them so a task
// with a start and a due date is drawn as ONE continuous line from start to
// due (Owner 2026-08-14) rather than a lone chip on the due date. A bar that
// crosses a week boundary is cut at the edge and squared off on that side.
// Monochrome throughout, except overdue — red is reserved for "needs action".
export function CalendarGrid({
  year,
  monthIndex,
  entries,
  eventNames,
}: {
  year: number;
  monthIndex: number;
  entries: CalendarEntry[];
  /** eventId → name, shown alongside each entry in cross-event (global) views */
  eventNames?: Map<string, string>;
}) {
  const weeks = monthMatrix(year, monthIndex);
  const todayKey = dayKey(new Date());

  return (
    <div className="overflow-hidden rounded-md border">
      <div className="grid grid-cols-7 border-b bg-muted/40">
        {WEEKDAY_LABELS.map((label) => (
          <div
            key={label}
            className="px-2 py-1.5 text-center text-[10px] font-semibold uppercase tracking-widest text-muted-foreground"
          >
            {label}
          </div>
        ))}
      </div>

      {weeks.map((week) => {
        const segments = buildWeekSegments(week, entries);
        const laneCount = segments.reduce((max, s) => Math.max(max, s.lane + 1), 0);
        const weekMinHeight = Math.max(MIN_CELL_PX, HEADER_PX + laneCount * LANE_PX + 6);

        return (
          <div
            key={cellKey(week[0])}
            className="relative grid grid-cols-7"
            style={{ minHeight: weekMinHeight }}
          >
            {week.map((day) => {
              const key = cellKey(day);
              const inMonth = day.getMonth() === monthIndex;
              const isToday = key === todayKey;
              return (
                <div
                  key={key}
                  className={cn(
                    "border-b border-r p-1.5 [&:nth-child(7n)]:border-r-0",
                    !inMonth && "bg-muted/20",
                  )}
                >
                  <span
                    aria-current={isToday ? "date" : undefined}
                    className={cn(
                      "inline-flex size-5 items-center justify-center rounded-full text-[11px] tabular-nums",
                      !inMonth && "text-muted-foreground/50",
                      isToday && "bg-foreground font-semibold text-background",
                    )}
                  >
                    {day.getDate()}
                  </span>
                </div>
              );
            })}

            {/* bars, laid over the day cells */}
            {segments.map((segment) => {
              const { entry } = segment;
              const eventName = eventNames?.get(entry.eventId);
              const label = `${eventName ? `${eventName} · ` : ""}${entry.title}`;
              const spansDays = segment.colEnd > segment.colStart;
              return (
                <Link
                  key={`${entry.kind}-${entry.taskId ?? entry.eventId}-${segment.colStart}`}
                  href={entry.href}
                  title={
                    eventName ? `${eventName} — ${entry.title}` : entry.title
                  }
                  style={{
                    gridColumn: `${segment.colStart + 1} / ${segment.colEnd + 2}`,
                    top: HEADER_PX + segment.lane * LANE_PX,
                  }}
                  className={cn(
                    "absolute z-10 mx-1 flex h-4 items-center gap-1 truncate rounded-sm border px-1.5 text-[10px] font-medium transition-colors",
                    entry.kind === "show"
                      ? "border-foreground bg-foreground text-background hover:bg-foreground/85"
                      : entry.overdue
                        ? "border-destructive bg-destructive/15 text-destructive hover:bg-destructive/25"
                        : "border-border bg-card text-foreground hover:bg-accent",
                    entry.done && "text-muted-foreground line-through",
                    // squared-off edge = the bar continues past this week
                    segment.clippedLeft && "ml-0 rounded-l-none border-l-0",
                    segment.clippedRight && "mr-0 rounded-r-none border-r-0",
                  )}
                >
                  {!segment.clippedLeft ? (
                    <span aria-hidden className="shrink-0 text-[9px]">
                      {entry.kind === "show" ? "●" : spansDays ? "▸" : "○"}
                    </span>
                  ) : null}
                  <span className="truncate">{label}</span>
                </Link>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
