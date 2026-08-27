import type { Metadata } from "next";
import { cookies } from "next/headers";
import { AlertTriangle, CalendarClock, CheckCircle2, Circle, ListChecks } from "lucide-react";
import { getBranding } from "@/lib/org/branding";
import { readSharePass, SHARE_COOKIE } from "@/lib/dataroom/share-session";
import {
  recordSummaryOpen,
  resolveSummaryShare,
  type ProjectSummaryView,
  type TaskSummaryView,
} from "@/lib/summary-share/service";
import { cn } from "@/lib/utils";
import { GateForm } from "./gate-form";

// Read-only progress page for someone with no account (Owner 2026-08-27).
// Outside the (app) group: no sidebar, no session, nothing of the workspace.
export const metadata: Metadata = {
  title: "Progress",
  // a shared progress page must never end up in a search index
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const dt = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "Asia/Jakarta",
});

const HEALTH_LABEL: Record<string, string> = {
  on_track: "On track",
  at_risk: "At risk",
  critical: "Critical",
};

const STATUS_LABEL: Record<string, string> = {
  backlog: "Backlog",
  todo: "To do",
  in_progress: "In progress",
  in_review: "In review",
  blocked: "Blocked",
  done: "Done",
  cancelled: "Cancelled",
};

function Stat({ label, value, tone }: { label: string; value: string; tone?: "bad" }) {
  return (
    <div className="flex flex-col gap-1 rounded-md border bg-card p-4">
      <span className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
        {label}
      </span>
      <span
        className={cn("text-lg font-semibold tabular-nums", tone === "bad" && "text-destructive")}
      >
        {value}
      </span>
    </div>
  );
}

function ProjectView({ view }: { view: ProjectSummaryView }) {
  const pct = view.progress.pct;
  return (
    <div className="flex w-full max-w-3xl flex-col gap-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat
          label="Progress"
          value={pct === null ? "—" : `${pct}%`}
        />
        <Stat label="Done" value={`${view.progress.done}/${view.progress.committed}`} />
        <Stat
          label="Overdue"
          value={String(view.overdueCount)}
          tone={view.overdueCount > 0 ? "bad" : undefined}
        />
        <Stat
          label="Deadline"
          value={
            view.daysToShow >= 0
              ? `${view.daysToShow} day${view.daysToShow === 1 ? "" : "s"}`
              : `${Math.abs(view.daysToShow)} days ago`
          }
        />
      </div>

      {pct !== null ? (
        <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-foreground" style={{ width: `${pct}%` }} />
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <CalendarClock className="size-3.5" />
          {dt.format(new Date(view.showDate))} WIB
        </span>
        {view.phaseName ? (
          <span>
            Phase {view.phaseIndex}/{view.phaseTotal} — {view.phaseName}
          </span>
        ) : null}
        <span
          className={cn(
            "rounded-full border px-2 py-0.5 font-medium",
            view.health === "critical" && "border-destructive text-destructive",
            view.health === "at_risk" && "border-priority-high text-priority-high",
          )}
        >
          {HEALTH_LABEL[view.health] ?? view.health}
        </span>
      </div>

      {view.divisions.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            By division
          </h2>
          <ul className="flex flex-col divide-y rounded-md border bg-card">
            {view.divisions.map((d) => (
              <li key={d.name} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <span className="min-w-0 flex-1 truncate">{d.name}</span>
                {d.overdue > 0 ? (
                  <span className="shrink-0 text-xs text-destructive">{d.overdue} overdue</span>
                ) : null}
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {d.done}/{d.total}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Tasks ({view.tasks.length})
        </h2>
        <ul className="flex flex-col divide-y rounded-md border bg-card">
          {view.tasks.length === 0 ? (
            <li className="px-4 py-6 text-center text-sm text-muted-foreground">
              No tasks yet.
            </li>
          ) : null}
          {view.tasks.map((t, i) => (
            <li key={`${t.title}-${i}`} className="flex items-center gap-3 px-4 py-2.5 text-sm">
              {t.status === "done" ? (
                <CheckCircle2 className="size-4 shrink-0 text-status-done" />
              ) : t.overdue ? (
                <AlertTriangle className="size-4 shrink-0 text-destructive" />
              ) : (
                <Circle className="size-4 shrink-0 text-muted-foreground" />
              )}
              <span
                className={cn(
                  "min-w-0 flex-1 truncate",
                  t.status === "done" && "text-muted-foreground line-through",
                )}
              >
                {t.title}
              </span>
              <span className="shrink-0 text-[10px] uppercase tracking-wider text-muted-foreground">
                {STATUS_LABEL[t.status] ?? t.status}
              </span>
              <span
                className={cn(
                  "w-24 shrink-0 text-right text-xs tabular-nums",
                  t.overdue ? "text-destructive" : "text-muted-foreground",
                )}
              >
                {t.dueDate ? dt.format(new Date(t.dueDate)) : "—"}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function TaskView({ view }: { view: TaskSummaryView }) {
  const { checklist } = view;
  return (
    <div className="flex w-full max-w-2xl flex-col gap-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Status" value={STATUS_LABEL[view.status] ?? view.status} />
        <Stat label="Priority" value={view.priority} />
        <Stat
          label="Deadline"
          value={view.dueDate ? dt.format(new Date(view.dueDate)) : "—"}
          tone={view.overdue ? "bad" : undefined}
        />
        <Stat
          label="Checklist"
          value={checklist.pct === null ? "—" : `${checklist.pct}%`}
        />
      </div>

      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <span>{view.divisionName}</span>
        {view.startDate ? <span>Starts {dt.format(new Date(view.startDate))}</span> : null}
        {view.overdue ? <span className="text-destructive">Past its deadline</span> : null}
      </div>

      {view.description.trim() ? (
        <p className="whitespace-pre-wrap rounded-md border bg-card p-4 text-sm">
          {view.description}
        </p>
      ) : null}

      {checklist.total > 0 ? (
        <div className="flex flex-col gap-2">
          <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            <ListChecks className="size-3.5" /> Checklist {checklist.done}/{checklist.total}
          </h2>
          <ul className="flex flex-col divide-y rounded-md border bg-card">
            {checklist.items.map((item, i) => (
              <li key={`${item.title}-${i}`} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                {item.done ? (
                  <CheckCircle2 className="size-4 shrink-0 text-status-done" />
                ) : (
                  <Circle className="size-4 shrink-0 text-muted-foreground" />
                )}
                <span
                  className={cn(
                    "min-w-0 flex-1 truncate",
                    item.done && "text-muted-foreground line-through",
                  )}
                >
                  {item.title}
                </span>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {item.dueDate ? dt.format(new Date(item.dueDate)) : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export default async function ProgressPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const branding = await getBranding();
  const jar = await cookies();
  const pass = readSharePass(token, jar.get(SHARE_COOKIE)?.value);

  const resolution = await resolveSummaryShare(token, {
    email: pass?.email ?? undefined,
    passcodeVerified: pass?.passcodeOk,
  });

  if (resolution.ok) {
    // counted here rather than in the gate: this is the request that actually
    // renders the numbers to a human
    await recordSummaryOpen(resolution.linkId, resolution.viewerEmail);
  }

  const heading = !resolution.ok
    ? "Shared with you"
    : resolution.view.kind === "project"
      ? resolution.view.name
      : resolution.view.title;

  return (
    <main className="flex min-h-svh flex-col items-center gap-6 bg-background p-6 sm:py-12">
      <div className="flex flex-col items-center gap-1.5 text-center">
        <h1 className="text-xl font-semibold">{heading}</h1>
        {resolution.ok && resolution.view.kind === "task" ? (
          <p className="text-xs text-muted-foreground">{resolution.view.projectName}</p>
        ) : null}
        <p className="text-xs text-muted-foreground">
          Progress shared by {branding.orgName} — view only
        </p>
      </div>

      {!resolution.ok ? (
        <GateForm
          token={token}
          needsPasscode={resolution.needsPasscode}
          needsEmail={resolution.needsEmail}
          message={
            resolution.needsEmail || resolution.needsPasscode ? null : resolution.message
          }
        />
      ) : resolution.view.kind === "project" ? (
        <ProjectView view={resolution.view} />
      ) : (
        <TaskView view={resolution.view} />
      )}

      {resolution.ok ? (
        <p className="max-w-2xl text-center text-[11px] text-muted-foreground">
          This is a read-only snapshot. The link expires, and whoever sent it can
          withdraw it at any time. Opens are recorded.
        </p>
      ) : null}
    </main>
  );
}
