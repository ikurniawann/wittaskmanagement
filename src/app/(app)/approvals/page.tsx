import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { APPROVER_LABELS } from "@/lib/approvals/chains";
import {
  getThresholds,
  listMyQueue,
  listMyRequests,
} from "@/lib/approvals/service";
import { sessionActor } from "@/lib/auth/session-actor";
import { listActiveEvents } from "@/lib/events/service";
import { listDivisions } from "@/lib/org/service";
import { can } from "@/lib/permissions";
import { NewApprovalForm } from "./new-approval-form";
import { APPROVAL_STATUS_META, formatIDR, TYPE_LABELS } from "./shared";
import { PageHeader } from "@/components/page-header";

export const metadata: Metadata = { title: "Approvals" };

const dt = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeZone: "Asia/Jakarta",
});

export default async function ApprovalsPage() {
  const actor = await sessionActor();
  if (!actor) redirect("/login");

  const [queue, requests, divisions, events, thresholds] = await Promise.all([
    listMyQueue(actor),
    listMyRequests(actor),
    listDivisions(),
    can(actor, "event.view") ? listActiveEvents(actor) : [],
    getThresholds(),
  ]);

  const myDivisions = divisions.filter((d) =>
    can(actor, "expense.create", { divisionId: d.id }),
  );
  const divisionName = new Map(divisions.map((d) => [d.id, d.name]));

  return (
    <section className="flex flex-col gap-10">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <PageHeader title={<>Approvals</>} description={<>Requests waiting for a decision, and where yours stand.</>} />
        {myDivisions.length > 0 ? (
          <NewApprovalForm
            divisions={myDivisions.map((d) => ({ id: d.id, name: d.name }))}
            events={events.map((e) => ({ id: e.id, name: e.name }))}
            thresholds={thresholds}
          />
        ) : null}
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">
          Waiting on you{queue.length > 0 ? ` · ${queue.length}` : ""}
        </h2>
        {queue.length === 0 ? (
          <p className="rounded-md border px-4 py-6 text-sm text-muted-foreground">
            Nothing waiting for your decision.
          </p>
        ) : (
          <ul className="flex flex-col divide-y rounded-md border">
            {queue.map((approval) => (
              <li key={approval.id}>
                <Link
                  href={`/approvals/${approval.id}`}
                  className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm transition-colors hover:bg-surface-2"
                >
                  <span className="rounded-sm border px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                    {TYPE_LABELS[approval.type]}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {approval.title}
                  </span>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {formatIDR(approval.amount)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {divisionName.get(approval.divisionId)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {dt.format(approval.createdAt)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">
          Your requests
        </h2>
        {requests.length === 0 ? (
          <p className="rounded-md border px-4 py-6 text-sm text-muted-foreground">
            You haven&apos;t submitted any requests yet.
          </p>
        ) : (
          <ul className="flex flex-col divide-y rounded-md border">
            {requests.map((approval) => {
              const meta = APPROVAL_STATUS_META[approval.status];
              return (
                <li key={approval.id}>
                  <Link
                    href={`/approvals/${approval.id}`}
                    className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm transition-colors hover:bg-surface-2"
                  >
                    <span className="rounded-sm border px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                      {TYPE_LABELS[approval.type]}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-medium">
                      {approval.title}
                    </span>
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {formatIDR(approval.amount)}
                    </span>
                    <span className={`text-xs font-medium ${meta.className}`}>
                      {meta.label}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Expense chains: ≤ {formatIDR(thresholds.a)} → Division Head · ≤{" "}
        {formatIDR(thresholds.b)} → + Finance · above → + Owner. Other types
        follow their fixed chains ({APPROVER_LABELS.legal}, {APPROVER_LABELS.owner},
        …). Thresholds are org settings.
      </p>
    </section>
  );
}
