"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { HealthBadge } from "@/components/health-badge";
import { EVENT_SUBPAGES } from "@/components/nav-link";
import { AvatarStack } from "@/components/task-meta";
import { cn } from "@/lib/utils";

// The event workspace header (Owner 2026-08-12), in the shape of a project
// header: identity on top, the sub-pages as tabs beneath, and the people
// actually working on it.
//
// The tabs read EVENT_SUBPAGES — the same list the sidebar expands — so a
// page added in one place appears in both. Two hand-kept copies of a
// navigation list drift, and the one that drifts is the one you notice a
// month later when a page has quietly become unreachable from the top.
//
// Still hidden on the event ROOT page, which has its own hero.
export function EventContextBar({
  eventId,
  name,
  phaseName,
  health,
  showDate,
  swatch,
  people,
}: {
  eventId: string;
  name: string;
  phaseName: string;
  health: "on_track" | "at_risk" | "critical";
  showDate: string;
  swatch: string;
  people: Array<{ id: string; name: string; avatarPath: string | null }>;
}) {
  const pathname = usePathname();
  // computed once (lazy initializer, like the hero Countdown) — a slim bar
  // does not need second-by-second ticking, and Date.now() during render is
  // impure under the React compiler
  const [dayLabel] = useState(() => {
    const diffDays = Math.round(
      (new Date(showDate).getTime() - Date.now()) / 86_400_000,
    );
    return diffDays > 0
      ? `${diffDays}d to show`
      : diffDays === 0
        ? "Launch day"
        : `${Math.abs(diffDays)}d since show`;
  });

  if (pathname === `/events/${eventId}`) return null;

  const current = pathname.split("/")[3] ?? "";

  return (
    <div className="sticky top-14 z-30 -mx-4 mb-6 flex flex-col border-b bg-background/95 px-4 backdrop-blur sm:-mx-6 sm:px-6">
      {/* identity row */}
      <div className="flex items-center gap-3 pt-3">
        <Link
          href={`/events/${eventId}`}
          className="flex min-w-0 items-center gap-2.5 hover:opacity-80"
          title="Event overview"
        >
          <span
            aria-hidden
            className={cn("size-7 shrink-0 rounded-lg", swatch)}
          />
          <span className="truncate font-heading text-lg font-semibold tracking-tight">
            {name}
          </span>
        </Link>
        <span aria-hidden className="hidden h-4 w-px shrink-0 bg-border sm:block" />
        <span className="hidden shrink-0 truncate text-xs text-muted-foreground sm:block">
          {phaseName}
        </span>
        <HealthBadge health={health} className="hidden shrink-0 sm:flex" />

        <div className="ml-auto flex shrink-0 items-center gap-3">
          {people.length > 0 ? (
            <span
              className="flex items-center gap-1.5"
              title={people.map((p) => p.name).join(", ")}
            >
              <AvatarStack users={people} max={4} />
              <span className="hidden text-[11px] text-muted-foreground md:inline">
                {people.length} on this show
              </span>
            </span>
          ) : null}
          <span className="font-mono text-xs tabular-nums text-muted-foreground">
            {dayLabel}
          </span>
        </div>
      </div>

      {/* tabs — the same pages the sidebar expands into */}
      <nav className="-mb-px flex gap-1 overflow-x-auto pt-2">
        {EVENT_SUBPAGES.map((page) => {
          const active =
            current === page.path ||
            ("also" in page &&
              (page.also as readonly string[]).includes(current));
          return (
            <Link
              key={page.path}
              href={`/events/${eventId}/${page.path}`}
              className={cn(
                "shrink-0 whitespace-nowrap border-b-2 px-3 pb-2 pt-1 text-[13px] transition-colors",
                active
                  ? "border-foreground font-medium text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {page.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
