import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { sessionActor } from "@/lib/auth/session-actor";
import { getEvent } from "@/lib/events/service";
import { can } from "@/lib/permissions";
import { listRunOfShow } from "@/lib/run-of-show/service";
import { RosEditor, PrintButton } from "./ros-ui";

export const metadata: Metadata = { title: "Run sheet" };

const showDateFormat = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "full",
  timeZone: "Asia/Jakarta",
});

// T-083: the minute-by-minute show-day rundown. Production/Ops edit,
// every division reads, and it prints clean for the backstage wall.
export default async function RunOfShowPage({
  params,
}: PageProps<"/events/[id]/run-of-show">) {
  const actor = await sessionActor();
  if (!actor) redirect("/login");

  const { id } = await params;
  const event = await getEvent(actor, id);
  if (!event) notFound();

  const items = await listRunOfShow(actor, id);
  const canManage = can(actor, "runofshow.manage");

  return (
    <section className="flex flex-col gap-6 print:gap-3">
      <div className="flex flex-wrap items-end justify-between gap-4 print:hidden">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            Run of show
          </h1>
          {!canManage ? (
            <p className="text-xs text-muted-foreground">
              Read-only — the rundown is maintained by Production & Operations.
            </p>
          ) : null}
        </div>
        <PrintButton />
      </div>

      {/* print header */}
      <div className="hidden print:block">
        <h1 className="text-2xl font-bold">{event.name} — Run sheet</h1>
        <p className="text-sm">
          {showDateFormat.format(event.showDate)} · {event.venue}
        </p>
      </div>

      <RosEditor
        eventId={id}
        canManage={canManage}
        items={items.map((item) => ({
          id: item.id,
          startTime: item.startTime,
          durationMinutes: item.durationMinutes,
          title: item.title,
          note: item.note,
        }))}
      />
    </section>
  );
}
