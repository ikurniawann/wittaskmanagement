import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Countdown } from "@/components/countdown";
import { HealthBadge } from "@/components/health-badge";
import { buttonVariants } from "@/components/ui/button";
import { sessionActor } from "@/lib/auth/session-actor";
import { CalendarRange } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { listActiveEvents, listArchivedEvents } from "@/lib/events/service";
import { can } from "@/lib/permissions";
import { eventColorClass } from "@/lib/events/colors";
import { cn } from "@/lib/utils";
import { archiveEventAction } from "./actions";

export const metadata: Metadata = { title: "Projects" };

// T-024: gallery grid of active events, gallery style — poster carries the color.
//
// The archived tab is not decoration (Owner 2026-08-11): every other list in
// the app hides archived events, so before this existed an archived show was
// unreachable and could never be brought back.
export default async function EventsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await sessionActor();
  if (!actor || !can(actor, "event.view")) redirect("/login");

  const sp = await searchParams;
  const showArchived = sp.view === "archived";
  const [events, archivedCount] = await Promise.all([
    showArchived ? listArchivedEvents(actor) : listActiveEvents(actor),
    listArchivedEvents(actor).then((rows) => rows.length),
  ]);
  const canCreate = can(actor, "event.create");
  const canArchive = can(actor, "event.archive");

  return (
    <section className="flex flex-col gap-8">
      {/* wraps on a phone: title, the Active/Archived toggle and the New button
          are three things that do not share 360px */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-semibold tracking-tight">
            Projects
          </h1>
          <p className="text-sm text-muted-foreground">
            {showArchived
              ? "Put away, and hidden from every other list until brought back."
              : "Every active project — open one to reach its board, budget, and team."}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* a filter rather than a sidebar entry: an archived project is still
              a project, and this is opened a few times a year */}
          <div className="flex rounded-md border p-0.5 text-xs">
            <Link
              href="/events"
              className={cn(
                "rounded px-2.5 py-1 transition-colors",
                showArchived
                  ? "text-muted-foreground hover:text-foreground"
                  : "bg-accent font-medium",
              )}
            >
              Active
            </Link>
            <Link
              href="/events?view=archived"
              className={cn(
                "flex items-center gap-1.5 rounded px-2.5 py-1 transition-colors",
                showArchived
                  ? "bg-accent font-medium"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              Archived
              {archivedCount > 0 ? (
                <span className="rounded-full bg-muted-foreground/20 px-1.5 text-[10px]">
                  {archivedCount}
                </span>
              ) : null}
            </Link>
          </div>
          {canCreate && !showArchived ? (
            <Link href="/events/new" className={buttonVariants()}>
              New project ↗
            </Link>
          ) : null}
        </div>
      </div>

      {events.length === 0 ? (
        <EmptyState
          icon={CalendarRange}
          title={showArchived ? "Nothing archived" : "No active projects"}
          hint="Create the first project — its board, budget, and team spaces come with it."
          action={
            canCreate ? (
              <Link href="/events/new" className={buttonVariants()}>
                New project ↗
              </Link>
            ) : undefined
          }
        />
      ) : (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {events.map((event) => (
            <div key={event.id} className="flex flex-col gap-2">
            <Link
              href={`/events/${event.id}`}
              className={cn(
                "group flex flex-col overflow-hidden rounded-md border elev elev-hover hover:border-foreground/40",
                showArchived && "opacity-70 hover:opacity-100",
              )}
            >
              <div className="relative aspect-[3/2] w-full overflow-hidden bg-muted">
                {event.coverImagePath ? (
                  // eslint-disable-next-line @next/next/no-img-element -- auth-gated route, next/image can't optimize it
                  <img
                    src={`/api/files/${event.coverImagePath}`}
                    alt={`${event.name} poster`}
                    className="size-full object-cover transition-transform group-hover:scale-[1.02]"
                  />
                ) : (
                  <div className="flex size-full items-center justify-center text-4xl font-semibold uppercase tracking-widest text-muted-foreground/50">
                    {event.name.slice(0, 2)}
                  </div>
                )}
              </div>
              <div className="flex flex-col gap-3 p-4">
                <div className="flex items-start justify-between gap-3">
                  <h2 className="flex min-w-0 items-center gap-2 font-semibold uppercase leading-tight tracking-tight">
                    <span
                      aria-hidden
                      className={cn(
                        "size-2.5 shrink-0 rounded-[4px]",
                        eventColorClass(event.id, event.color),
                      )}
                    />
                    <span className="truncate">{event.name}</span>
                  </h2>
                  <HealthBadge health={event.health} />
                </div>
                <p className="text-xs text-muted-foreground">
                  {event.venue} · {event.phaseName}
                </p>
                {showArchived ? (
                  <span className="w-fit rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                    Archived
                  </span>
                ) : (
                  <Countdown
                    target={event.showDate.toISOString()}
                    className="text-xs"
                  />
                )}
              </div>
            </Link>
            {showArchived && canArchive ? (
              // outside the card: a button nested in an anchor is invalid and
              // would swallow the click
              <form action={archiveEventAction}>
                <input type="hidden" name="eventId" value={event.id} />
                <input type="hidden" name="archived" value="false" />
                <button
                  type="submit"
                  className="w-full rounded-md border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground"
                >
                  Bring back to active
                </button>
              </form>
            ) : null}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
