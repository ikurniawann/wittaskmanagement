import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  CalendarRange,
  CirclePlus,
  Eye,
  UserRoundCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { DependencyBadge } from "@/components/dependency-badge";
import { EventChip } from "@/components/event-chip";
import { PriorityIcon, StatusChip, StatusDot, UserAvatar } from "@/components/task-meta";
import { sessionActor } from "@/lib/auth/session-actor";
import { signOut } from "@/lib/auth";
import { bucketForDue, type DueBucket } from "@/lib/tasks/dates";
import {
  getMyWork,
  listMyActivity,
  listMyCreatedTasks,
  listMyWatchedTasks,
  relativeTime,
} from "@/lib/tasks/my-work";
import { listMyTasks } from "@/lib/tasks/service";
import { WorkDrilldown } from "./work-drilldown";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "My Tasks" };

// T-033 → reworked 2026-08-07 (Owner, Plane "Your work" reference):
// Summary profile + Assigned / Created / Watched / Activity tabs.

const TABS = [
  { key: "summary", label: "Summary" },
  { key: "assigned", label: "Assigned" },
  { key: "created", label: "Created" },
  { key: "watched", label: "Watched" },
  { key: "activity", label: "Activity" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

const BUCKETS: Array<{ key: DueBucket; label: string }> = [
  { key: "overdue", label: "Overdue" },
  { key: "today", label: "Today" },
  { key: "this_week", label: "This week" },
  { key: "later", label: "Later" },
  { key: "none", label: "No due date" },
];

const dt = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  timeZone: "Asia/Jakarta",
});
const dtJoined = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeZone: "Asia/Jakarta",
});

const PRIORITY_BAR: Record<string, string> = {
  urgent: "bg-priority-urgent",
  high: "bg-priority-high",
  medium: "bg-priority-medium",
  low: "bg-priority-low",
};
const STATUS_BAR: Record<string, string> = {
  backlog: "bg-status-backlog",
  todo: "bg-status-todo",
  in_progress: "bg-status-in-progress",
  in_review: "bg-status-in-progress",
  blocked: "bg-status-blocked",
  done: "bg-status-done",
  cancelled: "bg-muted-foreground/40",
};

function TaskRows({
  rows,
  depBadges,
}: {
  rows: Array<{
    task: {
      id: string;
      title: string;
      status: string;
      priority: "low" | "medium" | "high" | "urgent";
      dueDate: Date | null;
    };
    eventName: string;
  }>;
  depBadges: Map<string, { waitingOn: number; waiters: number; critical: boolean }>;
}) {
  if (rows.length === 0) {
    return (
      <p className="rounded-md border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
        Nothing here.
      </p>
    );
  }
  return (
    <ul className="flex flex-col divide-y rounded-md border bg-card elev">
      {rows.map(({ task, eventName }) => (
        <li key={task.id}>
          <Link
            href={`/tasks/${task.id}`}
            className="flex items-center gap-3 px-4 py-2.5 text-sm transition-colors hover:bg-accent/50"
          >
            <PriorityIcon priority={task.priority} />
            <span className="min-w-0 flex-1 truncate font-medium">{task.title}</span>
            {depBadges.has(task.id) ? (
              <DependencyBadge {...depBadges.get(task.id)!} />
            ) : null}
            <EventChip name={eventName} className="hidden sm:inline-flex" />
            <StatusChip status={task.status as never} />
            {task.dueDate ? (
              <span className="text-xs tabular-nums text-muted-foreground">
                {dt.format(task.dueDate)}
              </span>
            ) : null}
          </Link>
        </li>
      ))}
    </ul>
  );
}

function ActivityList({
  items,
}: {
  items: Array<{
    id: string;
    actionLabel: string;
    entityLabel: string;
    eventName: string | null;
    createdAt: Date;
  }>;
}) {
  if (items.length === 0) {
    return (
      <p className="rounded-md border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
        No activity yet.
      </p>
    );
  }
  return (
    <ul className="flex flex-col divide-y rounded-md border bg-card elev">
      {items.map((entry) => (
        <li key={entry.id} className="flex flex-col gap-0.5 px-4 py-2.5">
          <span className="flex flex-wrap items-center gap-1.5 text-sm">
            <span className="font-medium">You</span>
            <span className="text-muted-foreground">{entry.actionLabel}</span>
            <span className="min-w-0 truncate font-medium">{entry.entityLabel}</span>
            {entry.eventName ? (
              <EventChip name={entry.eventName} className="hidden sm:inline-flex" />
            ) : null}
          </span>
          <span className="text-xs text-muted-foreground">
            {relativeTime(entry.createdAt)}
          </span>
        </li>
      ))}
    </ul>
  );
}

export default async function MyTasksPage({
  searchParams,
}: PageProps<"/my-tasks">) {
  const actor = await sessionActor();
  if (!actor) redirect("/login");

  const params = await searchParams;
  const rawTab = typeof params.tab === "string" ? params.tab : "summary";
  const tab: TabKey = (TABS.some((t) => t.key === rawTab) ? rawTab : "summary") as TabKey;

  const work = await getMyWork(actor);
  const maxPriority = Math.max(1, ...work.byPriority.map((p) => p.count));
  const openWorkload = work.workload.filter(
    (w) => w.status !== "done" && w.status !== "cancelled",
  );
  const maxStatus = Math.max(1, ...openWorkload.map((w) => w.count));
  const hasOpen = openWorkload.some((w) => w.count > 0);

  const [assignedRows, createdRows, watchedRows, activityRows] = await Promise.all([
    tab === "assigned" ? listMyTasks(actor) : [],
    tab === "created" ? listMyCreatedTasks(actor) : [],
    tab === "watched" ? listMyWatchedTasks(actor) : [],
    tab === "activity" ? listMyActivity(actor) : [],
  ]);

  const grouped = new Map<DueBucket, typeof assignedRows>();
  if (tab === "assigned") {
    const now = new Date();
    for (const row of assignedRows) {
      const bucket = bucketForDue(row.task.dueDate, now);
      const list = grouped.get(bucket) ?? [];
      list.push(row);
      grouped.set(bucket, list);
    }
  }

  // dependency badges (Owner 2026-08-07): whichever tab is active is the
  // only one with rows, so this covers Assigned/Created/Watched for free
  const { getDependencyBadges } = await import("@/lib/tasks/dependency-engine");
  const visibleRows = [...assignedRows, ...createdRows, ...watchedRows];
  const depBadges = await getDependencyBadges(visibleRows.map((r) => r.task));

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <h1 className="text-3xl font-semibold tracking-tight">
          Your work
        </h1>
        <nav className="flex gap-1 overflow-x-auto border-b">
          {TABS.map((t) => (
            <Link
              key={t.key}
              href={t.key === "summary" ? "/my-tasks" : `/my-tasks?tab=${t.key}`}
              className={cn(
                "-mb-px border-b-2 px-3 py-2 text-sm transition-colors",
                tab === t.key
                  ? "border-foreground font-medium text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
            </Link>
          ))}
        </nav>
      </div>

      <div className="flex flex-col gap-8 lg:flex-row">
        {/* main column */}
        <div className="flex min-w-0 flex-1 flex-col gap-8">
          {tab === "summary" ? (
            <>
              {/* overview */}
              <div className="flex flex-col gap-3">
                <h2 className="text-sm font-semibold">
                  Overview
                </h2>
                <div className="grid gap-4 sm:grid-cols-3">
                  {(
                    [
                      { source: "created", label: "Tasks created", value: work.counts.created, icon: CirclePlus },
                      { source: "assigned", label: "Tasks assigned", value: work.counts.assigned, icon: UserRoundCheck },
                      { source: "watched", label: "Tasks watched", value: work.counts.watched, icon: Eye },
                    ] as const
                  ).map((card) => (
                    <WorkDrilldown
                      key={card.label}
                      source={card.source}
                      title={card.label}
                      expected={card.value}
                      className="flex items-center gap-3 rounded-md border bg-card px-4 py-4"
                    >
                      <span className="flex size-9 items-center justify-center rounded-md border text-muted-foreground">
                        <card.icon className="size-4" />
                      </span>
                      <span className="flex flex-col">
                        <span className="text-xs text-muted-foreground">
                          {card.label}
                        </span>
                        <span className="text-xl font-semibold tabular-nums">
                          {card.value}
                        </span>
                      </span>
                    </WorkDrilldown>
                  ))}
                </div>
              </div>

              {/* workload */}
              <div className="flex flex-col gap-3">
                <h2 className="text-sm font-semibold">
                  Workload
                </h2>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7">
                  {work.workload.map((w) => (
                    <WorkDrilldown
                      key={w.status}
                      source="assigned"
                      filter={{ status: w.status }}
                      title={`Assigned · ${w.label}`}
                      expected={w.count}
                      className="flex flex-col gap-1 rounded-md border bg-card px-3 py-2.5"
                    >
                      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <StatusDot status={w.status as never} />
                        {w.label}
                      </span>
                      <span className="text-lg font-semibold tabular-nums">
                        {w.count}
                      </span>
                    </WorkDrilldown>
                  ))}
                </div>
              </div>

              {/* charts */}
              <div className="grid gap-6 md:grid-cols-2">
                <div className="flex flex-col gap-3">
                  <h2 className="text-sm font-semibold">
                    Open tasks by priority
                  </h2>
                  <div className="flex flex-col gap-2.5 rounded-md border bg-card p-4">
                    {hasOpen ? (
                      work.byPriority.map((p) => (
                        <WorkDrilldown
                          key={p.priority}
                          source="assigned"
                          filter={{ priority: p.priority }}
                          title={`Open · ${p.priority} priority`}
                          expected={p.count}
                          className="flex w-full items-center gap-3 rounded-md px-1 py-0.5 hover:bg-accent/40"
                        >
                          <span className="w-16 text-xs capitalize text-muted-foreground">
                            {p.priority}
                          </span>
                          <span className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                            <span
                              className={cn("block h-full", PRIORITY_BAR[p.priority])}
                              style={{ width: `${(p.count / maxPriority) * 100}%` }}
                            />
                          </span>
                          <span className="w-6 text-right text-xs tabular-nums">
                            {p.count}
                          </span>
                        </WorkDrilldown>
                      ))
                    ) : (
                      <p className="py-6 text-center text-xs text-muted-foreground">
                        No open task assigned yet.
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex flex-col gap-3">
                  <h2 className="text-sm font-semibold">
                    Open tasks by state
                  </h2>
                  <div className="flex flex-col gap-2.5 rounded-md border bg-card p-4">
                    {hasOpen ? (
                      openWorkload.map((w) => (
                        <WorkDrilldown
                          key={w.status}
                          source="assigned"
                          filter={{ status: w.status }}
                          title={`Open · ${w.label}`}
                          expected={w.count}
                          className="flex w-full items-center gap-3 rounded-md px-1 py-0.5 hover:bg-accent/40"
                        >
                          <span className="w-20 text-xs text-muted-foreground">
                            {w.label}
                          </span>
                          <span className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                            <span
                              className={cn("block h-full", STATUS_BAR[w.status])}
                              style={{ width: `${(w.count / maxStatus) * 100}%` }}
                            />
                          </span>
                          <span className="w-6 text-right text-xs tabular-nums">
                            {w.count}
                          </span>
                        </WorkDrilldown>
                      ))
                    ) : (
                      <p className="py-6 text-center text-xs text-muted-foreground">
                        No open task assigned yet.
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {/* recent activity */}
              <div className="flex flex-col gap-3">
                <div className="flex items-baseline justify-between">
                  <h2 className="text-sm font-semibold">
                    Recent activity
                  </h2>
                  <Link
                    href="/my-tasks?tab=activity"
                    className="text-xs text-muted-foreground hover:text-foreground hover:underline"
                  >
                    See all
                  </Link>
                </div>
                <ActivityList items={work.activity} />
              </div>
            </>
          ) : null}

          {tab === "assigned" ? (
            assignedRows.length === 0 ? (
              <p className="py-16 text-center text-sm text-muted-foreground">
                Nothing assigned to you right now. Check a division{" "}
                <Link href="/events" className="underline underline-offset-4">
                  board
                </Link>
                .
              </p>
            ) : (
              <div className="flex flex-col gap-8">
                {BUCKETS.map(({ key, label }) => {
                  const items = grouped.get(key);
                  if (!items || items.length === 0) return null;
                  return (
                    <div key={key} className="flex flex-col gap-2">
                      <h2
                        className={cn(
                          "text-xs font-semibold uppercase tracking-[0.2em]",
                          key === "overdue"
                            ? "text-destructive"
                            : "text-muted-foreground",
                        )}
                      >
                        {label} · {items.length}
                      </h2>
                      <TaskRows rows={items} depBadges={depBadges} />
                    </div>
                  );
                })}
              </div>
            )
          ) : null}

          {tab === "created" ? <TaskRows rows={createdRows} depBadges={depBadges} /> : null}
          {tab === "watched" ? <TaskRows rows={watchedRows} depBadges={depBadges} /> : null}
          {tab === "activity" ? <ActivityList items={activityRows} /> : null}
        </div>

        {/* profile panel */}
        <aside className="flex w-full shrink-0 flex-col gap-5 lg:w-72">
          <div className="flex flex-col gap-4 rounded-md border bg-card p-4">
            <div className="flex items-center gap-3">
              <UserAvatar name={work.profile.name} className="size-12 text-base" />
              <div className="flex min-w-0 flex-col">
                <span className="truncate font-semibold">{work.profile.name}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {work.profile.email}
                </span>
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  {work.profile.role}
                </span>
              </div>
            </div>
            <dl className="flex flex-col gap-1.5 text-xs">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Joined on</dt>
                <dd className="tabular-nums">{dtJoined.format(work.profile.joinedAt)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Timezone</dt>
                <dd className="tabular-nums">{work.wibClock} Asia/Jakarta</dd>
              </div>
            </dl>
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/login" });
              }}
            >
              <Button variant="outline" size="sm" type="submit" className="w-full">
                Sign out
              </Button>
            </form>
          </div>

          {work.divisions.length > 0 ? (
            <div className="flex flex-col gap-2 rounded-md border bg-card p-4">
              <h3 className="text-xs font-semibold text-muted-foreground">
                My divisions
              </h3>
              {work.divisions.map((d) => (
                <span key={d.id} className="flex items-center justify-between text-sm">
                  <span className="min-w-0 truncate">{d.name}</span>
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    {d.role}
                  </span>
                </span>
              ))}
            </div>
          ) : null}

          <div className="flex flex-col gap-2 rounded-md border bg-card p-4">
            <h3 className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
              <CalendarRange className="size-3.5" /> Working on
            </h3>
            {work.events.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No open tasks on any project.
              </p>
            ) : (
              work.events.map((event) => (
                <Link
                  key={event.id}
                  href={`/events/${event.id}`}
                  className="flex items-center justify-between gap-2 text-sm hover:underline"
                >
                  <span className="min-w-0 truncate">{event.name}</span>
                  <span className="rounded-full bg-muted px-2 text-[11px] tabular-nums text-muted-foreground">
                    {event.open}
                  </span>
                </Link>
              ))
            )}
          </div>
        </aside>
      </div>
    </section>
  );
}
