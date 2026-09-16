import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Activity,
  ArrowUpRight,
  CalendarRange,
  CheckCircle2,
  ClipboardCheck,
  Flag,
  Flame,
  Ticket,
  TriangleAlert,
} from "lucide-react";
import { formatIDR, TYPE_LABELS } from "@/app/(app)/approvals/shared";
import { Countdown } from "@/components/countdown";
import { DependencyBadge } from "@/components/dependency-badge";
import { EventChip } from "@/components/event-chip";
import { HealthBadge } from "@/components/health-badge";
import { CardTitleRow, SplitStats, StatCard } from "@/components/stat-card";
import { PriorityIcon } from "@/components/task-meta";
import { buttonVariants } from "@/components/ui/button";
import { listMyQueue } from "@/lib/approvals/service";
import { sessionActor } from "@/lib/auth/session-actor";
import {
  getActivityFeed,
  getBottlenecks,
  getOverdueHotspots,
  getPortfolio,
  getUpcomingMilestones,
} from "@/lib/dashboard/service";
import { can } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { InlineDecide } from "./inline-decide";

export const metadata: Metadata = { title: "Dashboard" };

const dt = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  timeZone: "Asia/Jakarta",
});
const dtLong = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Jakarta",
});
const dtDate = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "long",
  timeZone: "Asia/Jakarta",
});

// The Owner's cockpit, in the WIT UI style (2026-09-16): hero grid (dark
// featured project + the one accent card for what needs a decision + two
// small stats), a stat row, the portfolio gallery, then list columns.
export default async function DashboardPage() {
  const actor = await sessionActor();
  if (!actor) redirect("/login");
  if (!can(actor, "dashboard.view")) redirect("/my-tasks");

  const { portfolioSales } = await import("@/lib/tickets/service");
  const [portfolio, queue, milestones, bottlenecks, hotspots, feed, sales] =
    await Promise.all([
      getPortfolio(actor),
      listMyQueue(actor),
      getUpcomingMilestones(actor),
      getBottlenecks(actor),
      getOverdueHotspots(actor),
      getActivityFeed(actor),
      portfolioSales(actor),
    ]);
  const { getDependencyBadges } = await import("@/lib/tasks/dependency-engine");
  const milestoneDepBadges = await getDependencyBadges(milestones);

  const featured = [...portfolio].sort(
    (a, b) => a.showDate.getTime() - b.showDate.getTime(),
  )[0];
  const overdueTotal = hotspots.reduce((n, h) => n + h.count, 0);
  const doneTotal = portfolio.reduce((n, e) => n + e.progress.done, 0);
  const committedTotal = portfolio.reduce((n, e) => n + e.progress.committed, 0);
  const atRisk = portfolio.filter((e) => e.health !== "on_track").length;
  const queueValue = queue.reduce((n, a) => n + (a.amount ?? 0), 0);

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Dashboard<span className="text-accent">.</span>
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            The whole portfolio at a glance — approvals, milestones, bottlenecks.
          </p>
        </div>
        <p className="hidden text-xs text-muted-foreground md:block">
          {dtDate.format(new Date())} · WIB
        </p>
      </div>

      {/* hero grid */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.5fr_1fr]">
        {featured ? (
          <div className="relative flex min-h-[18rem] flex-col overflow-hidden rounded-card bg-ink p-6 text-on-ink shadow-float">
            <div className="pointer-events-none absolute -right-24 -top-24 size-72 rounded-full bg-accent/30 blur-3xl" />
            <div className="relative flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-on-ink-muted">
                  Portfolio · next launch
                </p>
                <h2 className="mt-1 truncate text-2xl font-bold tracking-tight">{featured.name}</h2>
                <p className="mt-0.5 text-sm text-on-ink-muted">
                  {featured.phaseName} · launches {dt.format(featured.showDate)}
                </p>
              </div>
              <HealthBadge health={featured.health} />
            </div>

            <div className="relative mt-6 flex items-start gap-1 leading-none">
              <Countdown target={featured.showDate.toISOString()} className="text-5xl font-bold tracking-tight" />
            </div>

            <div className="relative mt-6 flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-2 text-xs text-on-ink-muted">
                <span>
                  {featured.progress.pct === null
                    ? "No tasks planned yet"
                    : `${featured.progress.done}/${featured.progress.committed} tasks done`}
                </span>
                <span className="flex shrink-0 items-center gap-2 tabular-nums">
                  {featured.progress.backlog > 0 ? <span>+{featured.progress.backlog} backlog</span> : null}
                  {featured.progress.pct !== null ? (
                    <span className="font-semibold text-white">{featured.progress.pct}%</span>
                  ) : null}
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-white/15">
                <div className="h-full rounded-full bg-white" style={{ width: `${featured.progress.pct ?? 0}%` }} />
              </div>
            </div>

            <div className="relative mt-auto flex flex-wrap items-center gap-2 pt-6">
              <span className="rounded-full border border-white/10 bg-white/10 px-3 py-1 text-xs font-semibold">
                {featured.progress.committed} committed
              </span>
              <span className="rounded-full border border-white/10 bg-white/10 px-3 py-1 text-xs font-semibold">
                {featured.burnPct !== null ? `burn ${featured.burnPct}%` : "no budget"}
              </span>
              <span className="ml-auto flex gap-2">
                <Link
                  href={`/events/${featured.id}/board`}
                  className="flex h-9 items-center rounded-full bg-white/10 px-4 text-xs font-semibold hover:bg-white/20"
                >
                  Board
                </Link>
                <Link
                  href={`/events/${featured.id}`}
                  className="flex h-9 items-center gap-1 rounded-full bg-white px-4 text-xs font-semibold text-ink hover:bg-white/90"
                >
                  Open project <ArrowUpRight className="size-3.5" />
                </Link>
              </span>
            </div>
          </div>
        ) : (
          <div className="flex min-h-[18rem] flex-col items-start justify-center gap-3 rounded-card bg-ink p-6 text-on-ink shadow-float">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-on-ink-muted">Portfolio</p>
            <h2 className="text-2xl font-bold tracking-tight">No active projects yet.</h2>
            <p className="text-sm text-on-ink-muted">Create the first one — its board, calendar and dataroom come with it.</p>
            {can(actor, "event.create") ? (
              <Link href="/events/new" className={cn(buttonVariants({ variant: "primary" }), "mt-2")}>
                New project
              </Link>
            ) : null}
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-1">
          {/* the ONE accent card: what needs a decision */}
          <div className="flex flex-col gap-3 rounded-card bg-accent p-5 text-white shadow-glow sm:col-span-2 xl:col-span-1">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold">Waiting for your decision</p>
              <ClipboardCheck className="size-4 opacity-80" />
            </div>
            <p className="text-5xl font-bold leading-none tracking-tight tabular-nums">{queue.length}</p>
            <p className="text-xs text-white/80">
              {queue.length === 0
                ? "Nothing waiting — every approval is decided."
                : `${queue.length} approval${queue.length === 1 ? "" : "s"} · ${formatIDR(queueValue)} in total`}
            </p>
            <div className="mt-1 flex items-center justify-between gap-3">
              <Link
                href="/approvals"
                className="flex h-9 items-center rounded-full bg-white px-4 text-xs font-semibold text-accent hover:bg-white/90"
              >
                Open approvals
              </Link>
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/25">
                <div
                  className="h-full rounded-full bg-white"
                  style={{ width: `${queue.length === 0 ? 100 : Math.min(100, 100 / (queue.length + 1))}%` }}
                />
              </div>
            </div>
          </div>
          <StatCard label="Overdue tasks" value={overdueTotal} hint="across hotspots" icon={Flame} tone="danger" />
          <StatCard label="Bottlenecks" value={bottlenecks.length} hint="tasks others wait on" icon={TriangleAlert} tone="warning" />
        </div>
      </div>

      {/* stat row */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatCard label="Active projects" value={portfolio.length} hint="in the portfolio" icon={CalendarRange} tone="ink" />
        <StatCard
          label="Tasks done"
          value={doneTotal}
          unit={committedTotal > 0 ? `/ ${committedTotal}` : undefined}
          hint="of committed work"
          icon={CheckCircle2}
          tone="success"
        />
        <StatCard label="Milestones" value={milestones.length} hint="next 14 days" icon={Flag} tone="info" />
        <StatCard label="Projects at risk" value={atRisk} hint={atRisk === 0 ? "all on track" : "at risk or critical"} icon={TriangleAlert} tone={atRisk > 0 ? "danger" : "default"} />
      </div>

      {/* portfolio gallery */}
      {portfolio.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {portfolio.map((event) => (
            <Link
              key={event.id}
              href={`/events/${event.id}`}
              className="flex flex-col gap-3 rounded-card bg-card p-5 shadow-card transition-transform elev-hover"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-[0.8125rem] bg-ink text-xs font-black uppercase text-on-ink">
                    {event.name.slice(0, 2)}
                  </span>
                  <div className="min-w-0">
                    <h3 className="truncate text-base font-semibold leading-tight">{event.name}</h3>
                    <p className="text-xs text-muted-foreground">{event.phaseName}</p>
                  </div>
                </div>
                <HealthBadge health={event.health} />
              </div>
              <Countdown target={event.showDate.toISOString()} className="text-sm font-semibold" />
              <div className="h-1.5 overflow-hidden rounded-full bg-surface">
                <div className="h-full rounded-full bg-ink" style={{ width: `${event.progress.pct ?? 0}%` }} />
              </div>
              <SplitStats
                cells={[
                  { label: "Done", value: event.progress.pct === null ? "—" : `${event.progress.pct}%` },
                  { label: "Backlog", value: event.progress.backlog },
                  {
                    label: "Burn",
                    value: (
                      <span className={cn(event.burnPct !== null && event.burnPct > 100 && "text-accent")}>
                        {event.burnPct === null ? "—" : `${event.burnPct}%`}
                      </span>
                    ),
                  },
                ]}
              />
            </Link>
          ))}
        </div>
      ) : null}

      {/* pending approvals — the Owner's main action surface */}
      {queue.length > 0 ? (
        <div className="flex flex-col gap-3 rounded-card bg-card p-5 shadow-card">
          <CardTitleRow
            icon={ClipboardCheck}
            title="Pending approvals"
            count={queue.length}
            action={
              <Link href="/approvals" className={buttonVariants({ variant: "outline", size: "sm" })}>
                View all
              </Link>
            }
          />
          <ul className="flex flex-col gap-2">
            {queue.map((approval) => (
              <li
                key={approval.id}
                className="flex flex-wrap items-center gap-3 rounded-2xl bg-surface-2 px-4 py-3"
              >
                <span className="rounded-full bg-card px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {TYPE_LABELS[approval.type]}
                </span>
                <Link href={`/approvals/${approval.id}`} className="min-w-0 flex-1 truncate text-sm font-semibold hover:underline">
                  {approval.title}
                </Link>
                {approval.eventName ? <EventChip name={approval.eventName} /> : null}
                <span className="text-xs tabular-nums text-muted-foreground">{formatIDR(approval.amount)}</span>
                <InlineDecide approvalId={approval.id} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-[1fr_1fr_0.9fr]">
        {/* milestones */}
        <div className="flex min-w-0 flex-col gap-3 rounded-card bg-card p-5 shadow-card">
          <CardTitleRow
            icon={Flag}
            title="Milestones"
            count={milestones.length}
            action={
              <Link href="/calendar" className={buttonVariants({ variant: "outline", size: "sm" })}>
                Calendar
              </Link>
            }
          />
          <p className="-mt-2 text-xs text-muted-foreground">High-priority deadlines in the next 14 days.</p>
          {milestones.length === 0 ? (
            <p className="rounded-2xl bg-surface-2 px-4 py-6 text-center text-sm text-muted-foreground">
              No high-priority deadlines in the window.
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {milestones.map((m) => (
                <li key={m.id}>
                  <Link
                    href={`/tasks/${m.id}`}
                    className="flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm transition-colors hover:bg-surface-2"
                  >
                    <PriorityIcon priority={m.priority} />
                    <span className="min-w-0 flex-1 truncate font-medium">{m.title}</span>
                    {milestoneDepBadges.has(m.id) ? <DependencyBadge {...milestoneDepBadges.get(m.id)!} /> : null}
                    <EventChip name={m.eventName} className="hidden sm:inline-flex" />
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {m.dueDate ? dt.format(m.dueDate) : ""}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* bottlenecks + hotspots */}
        <div className="flex min-w-0 flex-col gap-5 rounded-card bg-card p-5 shadow-card">
          <div className="flex flex-col gap-3">
            <CardTitleRow icon={TriangleAlert} title="Bottlenecks" count={bottlenecks.length} />
            {bottlenecks.length === 0 ? (
              <p className="rounded-2xl bg-surface-2 px-4 py-4 text-center text-sm text-muted-foreground">
                Nothing is holding other tasks up.
              </p>
            ) : (
              <ul className="flex flex-col gap-1">
                {bottlenecks.map((b) => (
                  <li key={b.id}>
                    <Link
                      href={`/tasks/${b.id}`}
                      className="flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm transition-colors hover:bg-surface-2"
                    >
                      <span
                        className={cn(
                          "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold tabular-nums",
                          b.critical ? "bg-accent-soft text-accent" : "bg-surface text-muted-foreground",
                        )}
                        title={b.critical ? "Critical bottleneck (auto-escalated)" : "Tasks waiting on this"}
                      >
                        {b.waiters} waiting
                      </span>
                      <span className="min-w-0 flex-1 truncate font-medium">{b.title}</span>
                      <EventChip name={b.eventName} className="hidden sm:inline-flex" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="flex flex-col gap-3">
            <CardTitleRow icon={Flame} title="Overdue hotspots" count={overdueTotal} />
            {hotspots.length === 0 ? (
              <p className="rounded-2xl bg-surface-2 px-4 py-4 text-center text-sm text-muted-foreground">
                Nothing overdue.
              </p>
            ) : (
              <ul className="flex flex-col gap-1">
                {hotspots.map((h) => (
                  <li key={`${h.eventId}-${h.divisionId}`}>
                    <Link
                      href={`/events/${h.eventId}/board?division=${h.divisionId}`}
                      className="flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm transition-colors hover:bg-surface-2"
                    >
                      <EventChip name={h.eventName} />
                      <span className="min-w-0 flex-1 truncate font-medium">{h.divisionName}</span>
                      <span className="rounded-full bg-accent-soft px-2 text-xs font-semibold tabular-nums text-accent">
                        {h.count}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* activity */}
        <div className="flex min-w-0 flex-col gap-3 rounded-card bg-card p-5 shadow-card md:col-span-2 xl:col-span-1">
          <CardTitleRow icon={Activity} title="Recent activity" />
          <ul className="flex flex-col divide-y divide-border">
            {feed.length === 0 ? (
              <li className="py-6 text-center text-sm text-muted-foreground">Quiet so far.</li>
            ) : (
              feed.map((entry) => (
                <li key={entry.id} className="flex flex-col gap-0.5 py-2.5 text-xs">
                  <span className="text-muted-foreground">
                    <span className="font-semibold text-foreground">{entry.actorName ?? "System"}</span>{" "}
                    {entry.actionLabel}{" "}
                    <span className="font-medium text-foreground/80">{entry.entityLabel}</span>
                  </span>
                  <span className="flex items-center gap-2 text-[11px] text-muted-foreground">
                    <span className="tabular-nums">{dtLong.format(entry.createdAt)}</span>
                    {entry.eventName ? <EventChip name={entry.eventName} /> : null}
                  </span>
                </li>
              ))
            )}
          </ul>
        </div>
      </div>

      {/* ticket sales (T-093) — only when a channel is synced */}
      {sales.length > 0 ? (
        <div className="flex flex-col gap-3 rounded-card bg-card p-5 shadow-card">
          <CardTitleRow icon={Ticket} title="Ticket sales" />
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {sales.map((s) => {
              const max = Math.max(1, ...s.last14.map((d) => d.ticketsSold));
              return (
                <Link
                  key={s.eventId}
                  href={`/events/${s.eventId}/tickets`}
                  className="flex flex-col gap-3 rounded-2xl bg-surface-2 p-4 transition-colors hover:bg-surface"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 truncate text-sm font-semibold">{s.eventName}</span>
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {s.totalSold.toLocaleString("en")} sold{s.soldPct !== null ? ` · ${s.soldPct}%` : ""}
                    </span>
                  </div>
                  <div className="flex items-end gap-1">
                    {s.last14.map((d) => (
                      <div
                        key={d.day}
                        title={`${d.day}: ${d.ticketsSold.toLocaleString("en")}`}
                        className="flex-1 rounded-t-sm bg-ink/70"
                        style={{ height: `${Math.max(4, Math.round((d.ticketsSold / max) * 48))}px` }}
                      />
                    ))}
                  </div>
                  <span className="text-xs tabular-nums text-muted-foreground">{formatIDR(s.totalRevenue)} revenue</span>
                </Link>
              );
            })}
          </div>
        </div>
      ) : null}
    </section>
  );
}
