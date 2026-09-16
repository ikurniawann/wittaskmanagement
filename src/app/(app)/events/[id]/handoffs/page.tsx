import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { sessionActor } from "@/lib/auth/session-actor";
import { getEvent } from "@/lib/events/service";
import { listDivisions } from "@/lib/org/service";
import { can } from "@/lib/permissions";
import { listHandoffs } from "@/lib/tasks/service";
import { handoffDecideAction } from "../../../tasks/actions";
import { HandoffRequestForm } from "./request-form";
import { PageHeader } from "@/components/page-header";

export const metadata: Metadata = { title: "Handoffs" };

const dt = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeZone: "Asia/Jakarta",
});

// T-036: cross-division handoff queue per event.
export default async function HandoffsPage({
  params,
}: PageProps<"/events/[id]/handoffs">) {
  const actor = await sessionActor();
  if (!actor) redirect("/login");

  const { id } = await params;
  const event = await getEvent(actor, id);
  if (!event) notFound();

  const [handoffList, divisions] = await Promise.all([
    listHandoffs(actor, id),
    listDivisions(),
  ]);
  const divisionName = new Map(divisions.map((d) => [d.id, d.name]));

  const myFromDivisions = divisions.filter((d) =>
    can(actor, "handoff.request", { divisionId: d.id }),
  );

  return (
    <section className="flex flex-col gap-8">
      <PageHeader title={<>Handoffs</>} description={<>Request work from another division — no more lost chat messages.</>} />

      {myFromDivisions.length > 0 ? (
        <HandoffRequestForm
          eventId={id}
          fromOptions={myFromDivisions.map((d) => ({ id: d.id, name: d.name }))}
          toOptions={divisions.map((d) => ({ id: d.id, name: d.name }))}
        />
      ) : null}

      <ul className="flex flex-col divide-y rounded-md border">
        {handoffList.length === 0 ? (
          <li className="px-4 py-8 text-center text-sm text-muted-foreground">
            No handoffs yet.
          </li>
        ) : (
          handoffList.map((h) => {
            const decidable =
              h.status === "pending" &&
              can(actor, "handoff.decide", { divisionId: h.toDivisionId });
            return (
              <li key={h.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-sm font-medium">{h.title}</span>
                  <span className="text-xs text-muted-foreground">
                    {divisionName.get(h.fromDivisionId)} →{" "}
                    {divisionName.get(h.toDivisionId)} · {dt.format(h.createdAt)}
                    {h.note ? <> · {h.note}</> : null}
                  </span>
                </div>
                {h.status === "pending" ? (
                  decidable ? (
                    <div className="flex gap-2">
                      <form action={handoffDecideAction}>
                        <input type="hidden" name="handoffId" value={h.id} />
                        <input type="hidden" name="eventId" value={id} />
                        <input type="hidden" name="accept" value="true" />
                        <Button type="submit" size="sm">
                          Accept
                        </Button>
                      </form>
                      <form action={handoffDecideAction}>
                        <input type="hidden" name="handoffId" value={h.id} />
                        <input type="hidden" name="eventId" value={id} />
                        <input type="hidden" name="accept" value="false" />
                        <Button type="submit" size="sm" variant="ghost">
                          Decline
                        </Button>
                      </form>
                    </div>
                  ) : (
                    <span className="text-xs uppercase tracking-wider text-muted-foreground">
                      Pending
                    </span>
                  )
                ) : (
                  <span className="text-xs uppercase tracking-wider text-muted-foreground">
                    {h.status}
                    {h.createdTaskId ? (
                      <>
                        {" · "}
                        <Link
                          href={`/tasks/${h.createdTaskId}`}
                          className="underline underline-offset-4"
                        >
                          task ↗
                        </Link>
                      </>
                    ) : null}
                  </span>
                )}
              </li>
            );
          })
        )}
      </ul>
    </section>
  );
}
