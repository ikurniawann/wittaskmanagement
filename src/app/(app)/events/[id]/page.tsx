import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Countdown } from "@/components/countdown";
import { HealthBadge } from "@/components/health-badge";
import { PhaseSteps } from "@/components/phase-steps";
import { SummaryShareButton } from "@/app/(app)/summary-share/summary-share-button";
import { StatusDot, UserAvatar } from "@/components/task-meta";
import { FileDown } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { sessionActor } from "@/lib/auth/session-actor";
import {
  getEvent,
  getEventPeople,
  listEventDivisions,
  listPhases,
} from "@/lib/events/service";
import { listDivisions } from "@/lib/org/service";
import { buildEventTaskSummary } from "@/lib/events/task-summary";
import { can } from "@/lib/permissions";
import { listEventTasks } from "@/lib/tasks/service";
import { listTemplates } from "@/lib/templates/service";
import { archiveEventAction, setCurrentPhaseAction } from "../actions";
import { ApplyPlaybook } from "./apply-playbook";
import { DivisionsManager } from "./divisions-manager";
import { WorkflowManager } from "./workflow-manager";

export const metadata: Metadata = { title: "Project" };

const dateFormat = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "full",
  timeStyle: "short",
  timeZone: "Asia/Jakarta",
});

// T-022: the event workspace shell — countdown front and center.
export default async function EventPage({ params }: PageProps<"/events/[id]">) {
  const actor = await sessionActor();
  if (!actor || !can(actor, "event.view")) redirect("/login");

  const { id } = await params;
  const event = await getEvent(actor, id);
  if (!event) notFound();

  const canManage = can(actor, "event.updatePhase");
  const canManageDivisions = can(actor, "event.manageDivisions");
  const canManageWorkflow = can(actor, "event.manageWorkflow");
  const canEdit = can(actor, "event.edit");
  const [activeDivisions, allDivisions, phases, templates, eventTasks, crew] =
    await Promise.all([
      listEventDivisions(actor, event.id),
      canManageDivisions ? listDivisions() : [],
      listPhases(actor, event.id),
      can(actor, "event.create") ? listTemplates() : [],
      listEventTasks(actor, event.id),
      getEventPeople(actor, event.id),
    ]);

  // task summary (Owner 2026-08-07) — same progress rule as dashboard + PDF
  const {
    progress,
    overdueCount,
    statusMix,
    divisions: divisionSummary,
  } = buildEventTaskSummary(eventTasks, activeDivisions);
  const currentIndex = phases.findIndex((p) => p.id === event.currentPhaseId);
  const nextPhase = currentIndex >= 0 ? phases[currentIndex + 1] : phases[0];

  return (
    <section className="flex flex-col gap-10">
      <div className="flex flex-col gap-6 border-b pb-10 md:flex-row md:items-start md:gap-10">
        {/* Spotify-style artwork (Owner 2026-08-13): centred on mobile, a
            deep shadow, and an ambient glow that is simply the poster itself
            blurred behind — the artwork's own colours, no extraction needed,
            which is exactly the "colour comes from posters" rule made real.
            The glow sits outside the card, so the old overflow-hidden wrapper
            had to go; rounding and border moved onto the image. */}
        <div className="relative mx-auto w-60 shrink-0 sm:w-64 md:mx-0 md:w-[240px]">
          {event.coverImagePath ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element -- auth-gated route */}
              <img
                src={`/api/files/${event.coverImagePath}`}
                alt=""
                aria-hidden
                className="absolute inset-0 -z-10 aspect-[3/4] w-full scale-110 rounded-md object-cover opacity-50 blur-2xl saturate-150"
              />
              {/* eslint-disable-next-line @next/next/no-img-element -- auth-gated route */}
              <img
                src={`/api/files/${event.coverImagePath}`}
                alt={`${event.name} poster`}
                className="relative aspect-[3/4] w-full rounded-md border object-cover shadow-2xl"
              />
            </>
          ) : (
            <div className="flex aspect-[3/4] items-center justify-center rounded-md border bg-muted text-5xl font-semibold uppercase text-muted-foreground/40 shadow-2xl">
              {event.name.slice(0, 2)}
            </div>
          )}
        </div>

        <div className="flex flex-1 flex-col gap-5">
          <div className="flex items-start justify-between gap-4">
            <h1 className="text-4xl font-semibold uppercase leading-[1.05] tracking-tight sm:text-5xl">
              {event.name}
            </h1>
            <HealthBadge health={event.health} className="mt-2" />
          </div>
          <p className="text-sm text-muted-foreground">
            {event.artists && <>{event.artists} · </>}
            {event.venue}
            {event.capacity ? <> · cap {event.capacity.toLocaleString("en")}</> : null}
          </p>
          <p className="text-sm text-muted-foreground">
            {dateFormat.format(event.showDate)} WIB
          </p>
          {crew.pic || crew.members.length > 0 ? (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
              {crew.pic ? (
                <span className="flex items-center gap-1.5">
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    PIC
                  </span>
                  <UserAvatar
                    name={crew.pic.name}
                    src={crew.pic.avatarPath}
                    className="size-5 text-[9px]"
                  />
                  <span className="font-medium">{crew.pic.name}</span>
                </span>
              ) : null}
              {crew.members.length > 0 ? (
                <span className="flex items-center gap-1.5">
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Members
                  </span>
                  <span className="flex -space-x-1.5">
                    {crew.members.map((m) => (
                      <UserAvatar
                        key={m.id}
                        name={m.name}
                        src={m.avatarPath}
                        className="size-5 border border-background text-[9px]"
                      />
                    ))}
                  </span>
                </span>
              ) : null}
            </div>
          ) : null}

          <div className="flex flex-col gap-2 py-4">
            <span className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
              To show day
            </span>
            <Countdown
              target={event.showDate.toISOString()}
              className="text-3xl sm:text-4xl"
            />
          </div>

          <PhaseSteps
            phases={phases.map((p) => ({ id: p.id, name: p.name }))}
            currentId={event.currentPhaseId}
            jump={
              canManage
                ? { eventId: event.id, action: setCurrentPhaseAction }
                : undefined
            }
          />
          {canManage ? (
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground/70">
              Click any phase to move there — back or forward
            </p>
          ) : null}

          {canManage ? (
            <div className="flex flex-wrap gap-3 pt-4">
              {nextPhase ? (
                <form action={setCurrentPhaseAction}>
                  <input type="hidden" name="eventId" value={event.id} />
                  <input type="hidden" name="phaseId" value={nextPhase.id} />
                  <Button type="submit">
                    Advance to {nextPhase.name} ↗
                  </Button>
                </form>
              ) : null}
              <Link
                href={`/events/${event.id}/edit`}
                className={buttonVariants({ variant: "outline" })}
              >
                Edit project
              </Link>
              <form action={archiveEventAction}>
                <input type="hidden" name="eventId" value={event.id} />
                <input type="hidden" name="archived" value="true" />
                <Button type="submit" variant="ghost">
                  Archive
                </Button>
              </form>
            </div>
          ) : null}
          {canEdit && !canManage ? (
            <div className="pt-4">
              <Link
                href={`/events/${event.id}/edit`}
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                Edit project
              </Link>
            </div>
          ) : null}
        </div>
      </div>

      {/* task summary — the tabs moved into the sidebar's expandable event
          entry (Owner 2026-08-07); this page now answers "how are we doing" */}
      <div className="flex flex-col gap-4">
        <h2 className="text-sm font-semibold">
          Task summary
        </h2>
        {progress.total === 0 ? (
          <p className="rounded-md border border-dashed px-4 py-4 text-sm text-muted-foreground">
            No tasks yet — open the{" "}
            <Link href={`/events/${event.id}/board`} className="underline">
              board
            </Link>{" "}
            or apply a playbook below.
          </p>
        ) : (
          <>
            <div className="flex flex-col gap-2 rounded-md border bg-card p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-2xl font-semibold tabular-nums">
                  {progress.pct !== null ? `${progress.pct}%` : "—"}
                  <span className="ml-2 text-sm font-normal text-muted-foreground">
                    {progress.done}/{progress.committed} committed tasks done
                  </span>
                </span>
                <span className="text-xs text-muted-foreground">
                  {progress.backlog > 0 ? `${progress.backlog} in backlog · ` : ""}
                  {overdueCount > 0 ? (
                    <span className="font-semibold text-status-blocked">
                      {overdueCount} overdue
                    </span>
                  ) : (
                    "nothing overdue"
                  )}
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full bg-foreground/70 transition-all"
                  style={{ width: `${progress.pct ?? 0}%` }}
                />
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1 text-xs text-muted-foreground">
                {statusMix.map((s) => (
                  <span key={s.status} className="flex items-center gap-1.5">
                    <StatusDot status={s.status} />
                    {s.label} <span className="tabular-nums">{s.count}</span>
                  </span>
                ))}
              </div>
            </div>

            <ul className="grid gap-x-6 gap-y-1 rounded-md border bg-card px-4 py-3 sm:grid-cols-2">
              {divisionSummary.map((d) => (
                <li key={d.id}>
                  <Link
                    href={`/events/${event.id}/board?division=${d.id}`}
                    className="flex items-center gap-3 py-1 text-sm hover:underline"
                  >
                    <span className="min-w-0 flex-1 truncate">{d.name}</span>
                    {d.overdue > 0 ? (
                      <span className="rounded-full bg-status-blocked/15 px-1.5 text-[10px] font-semibold tabular-nums text-status-blocked">
                        {d.overdue}
                      </span>
                    ) : null}
                    <span className="w-14 text-right text-xs tabular-nums text-muted-foreground">
                      {d.done}/{d.total}
                    </span>
                    <span className="h-1 w-16 overflow-hidden rounded-full bg-muted">
                      <span
                        className="block h-full bg-foreground/60"
                        style={{
                          width: `${d.total > 0 ? Math.round((d.done / d.total) * 100) : 0}%`,
                        }}
                      />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      <div className="flex flex-wrap items-start gap-3">
        {canManageWorkflow ? (
          <WorkflowManager
            eventId={event.id}
            phases={phases.map((p) => ({ id: p.id, name: p.name }))}
            currentId={event.currentPhaseId}
          />
        ) : null}
        {canManageDivisions ? (
          <DivisionsManager
            eventId={event.id}
            allDivisions={allDivisions.map((d) => ({ id: d.id, name: d.name }))}
            activeIds={activeDivisions.map((d) => d.id)}
          />
        ) : null}
        {can(actor, "dashboard.view") ? (
          <>
            <a
              href={`/api/events/${event.id}/report`}
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              <FileDown className="size-3.5" /> Progress report (PDF)
            </a>
            <a
              href={`/api/events/${event.id}/settlement`}
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              <FileDown className="size-3.5" /> Settlement (PDF)
            </a>
          </>
        ) : null}
        {canEdit ? (
          <SummaryShareButton
            kind="project"
            targetId={event.id}
            targetName={event.name}
            className="ml-1"
          />
        ) : null}
        {can(actor, "event.create") ? (
          <ApplyPlaybook
            eventId={event.id}
            templates={templates.map(({ template, itemCount }) => ({
              id: template.id,
              name: template.name,
              itemCount,
            }))}
          />
        ) : null}
      </div>
    </section>
  );
}
