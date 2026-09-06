"use client";

import {
  CircleUserRound,
  Calendar,
  CalendarRange,
  ChevronRight,
  ClipboardCheck,
  FileText,
  LayoutDashboard,
  ListChecks,
  MessagesSquare,
  Settings,
  SlidersHorizontal,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { cn } from "@/lib/utils";

const ICONS: Record<string, LucideIcon> = {
  "my-tasks": ListChecks,
  events: CalendarRange,
  calendar: Calendar,
  approvals: ClipboardCheck,
  timeline: MessagesSquare,
  dashboard: LayoutDashboard,
  admin: Settings,
  settings: SlidersHorizontal,
  profile: CircleUserRound,
  assistant: Sparkles,
  pages: FileText,
};

export interface NavItem {
  href: string;
  label: string;
  icon: keyof typeof ICONS;
  /** unread balloon on the icon */
  badge?: number;
}

export function NavLink({ item }: { item: NavItem }) {
  const pathname = usePathname();
  const active =
    pathname === item.href || pathname.startsWith(`${item.href}/`);
  const Icon = ICONS[item.icon];

  return (
    <Link
      href={item.href}
      className={cn(
        "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors",
        active
          ? "bg-accent font-medium text-foreground"
          : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
      )}
    >
      <span className="relative">
        <Icon className="size-4" />
        {item.badge && item.badge > 0 ? (
          <span className="absolute -right-1.5 -top-1.5 flex size-3.5 items-center justify-center rounded-full bg-foreground text-[8px] font-semibold text-background">
            {item.badge > 9 ? "9+" : item.badge}
          </span>
        ) : null}
      </span>
      {item.label}
    </Link>
  );
}

// event sub-pages, in workspace order (Owner request 2026-08-07: the event
// entry in the sidebar expands into these — tabs left the event page)
export const EVENT_SUBPAGES = [
  { path: "board", label: "Board" },
  { path: "list", label: "List" },
  { path: "pages", label: "Pages" },
  // /gantt lives under the Calendar entry as a view toggle (Owner 2026-08-07)
  { path: "calendar", label: "Calendar", also: ["gantt"] },
  { path: "handoffs", label: "Handoffs" },
  { path: "guests", label: "Guests" },
  // Replaces the old Documents module (EPIC-017): access levels, versioning
  // and an access log, on the 3.6 TB disk. The `documents` table is left in
  // place — it holds no rows, and dropping it is not this task's risk to take.
  { path: "dataroom", label: "Dataroom" },
  // Budget, Run of show and Tickets were dropped from this menu at the
  // Owner's request (2026-08-31). Their pages are still routed and still
  // work — this hides the doors, it does not brick the rooms — so putting
  // an entry back is one line each.
] as const;

export function EventNavLink({
  href,
  name,
  health,
  swatch,
}: {
  href: string;
  name: string;
  health: "on_track" | "at_risk" | "critical";
  /** identity colour class from lib/events/colors */
  swatch: string;
}) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(`${href}/`);
  // follows the route by default (inside the event ⇒ open); the chevron
  // overrides until the route leaves the event again
  const [manual, setManual] = useState<boolean | null>(null);
  const expanded = manual ?? active;

  return (
    <div className="flex flex-col">
      <div
        className={cn(
          "flex items-center gap-2 rounded-md pr-1 transition-colors",
          active
            ? "bg-accent font-medium text-foreground"
            : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
        )}
      >
        <Link
          href={href}
          className="flex min-w-0 flex-1 items-center gap-2 truncate px-2.5 py-1.5 text-[13px]"
        >
          {/* identity, not status: this is how you find the event you want */}
          <span
            aria-hidden
            className={cn("size-2.5 shrink-0 rounded-[4px]", swatch)}
          />
          <span className="truncate">{name}</span>
          {/* Health speaks only when there is something to say. A green dot
              beside every healthy event is decoration, and decoration next to
              a warning is what makes the warning invisible. */}
          {health !== "on_track" ? (
            <span
              title={health === "critical" ? "Critical" : "At risk"}
              className={cn(
                "size-1.5 shrink-0 rounded-full",
                health === "at_risk" && "bg-status-in-progress",
                health === "critical" && "bg-status-blocked",
              )}
            />
          ) : null}
        </Link>
        <button
          type="button"
          aria-label={expanded ? `Collapse ${name}` : `Expand ${name}`}
          aria-expanded={expanded}
          onClick={() => setManual(!expanded)}
          className="rounded-sm p-1 text-muted-foreground/70 hover:text-foreground"
        >
          <ChevronRight
            className={cn(
              "size-3.5 transition-transform",
              expanded && "rotate-90",
            )}
          />
        </button>
      </div>

      {expanded ? (
        <div className="mb-1 ml-[13px] flex flex-col border-l pl-2">
          {EVENT_SUBPAGES.map((sub) => {
            const subHref = `${href}/${sub.path}`;
            const subActive =
              pathname.startsWith(subHref) ||
              ("also" in sub &&
                sub.also.some((alt) => pathname.startsWith(`${href}/${alt}`)));
            return (
              <Link
                key={sub.path}
                href={subHref}
                className={cn(
                  "truncate rounded-md px-2 py-1 text-[11px] uppercase tracking-wider transition-colors",
                  subActive
                    ? "bg-accent font-semibold text-foreground"
                    : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                )}
              >
                {sub.label}
              </Link>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
