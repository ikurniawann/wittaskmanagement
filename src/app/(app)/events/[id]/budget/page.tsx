import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { formatIDR } from "@/app/(app)/approvals/shared";
import { sessionActor } from "@/lib/auth/session-actor";
import {
  eventBudgetRollup,
  listEventExpenses,
} from "@/lib/budgets/service";
import { getEvent } from "@/lib/events/service";
import { listDivisions } from "@/lib/org/service";
import { can } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { markPaidAction, removeLineAction } from "./actions";
import { AddLineForm, NewExpenseForm } from "./forms";
import { PageHeader } from "@/components/page-header";

export const metadata: Metadata = { title: "Budget" };

const EXPENSE_STATUS_META: Record<string, { label: string; className: string }> = {
  pending_approval: { label: "Pending approval", className: "text-status-in-progress" },
  committed: { label: "Committed", className: "text-status-todo" },
  paid: { label: "Paid", className: "text-status-done" },
  rejected: { label: "Rejected", className: "text-status-blocked" },
  changes_requested: { label: "Changes requested", className: "text-status-in-review" },
};

export default async function BudgetPage({
  params,
}: PageProps<"/events/[id]/budget">) {
  const actor = await sessionActor();
  if (!actor) redirect("/login");

  const { id } = await params;
  const event = await getEvent(actor, id);
  if (!event) notFound();

  const [{ lines, totals }, expenses, divisions] = await Promise.all([
    eventBudgetRollup(actor, id),
    listEventExpenses(actor, id),
    listDivisions(),
  ]);

  const canManage = can(actor, "budget.manage");
  const canPay = can(actor, "expense.markPaid");
  const myExpenseDivisions = divisions.filter((d) =>
    can(actor, "expense.create", { divisionId: d.id }),
  );
  const divisionName = new Map(divisions.map((d) => [d.id, d.name]));
  const remaining = totals.planned - totals.committed - totals.actual;

  return (
    <section className="flex flex-col gap-8">
      <PageHeader title={<>Budget</>} />

      {/* totals strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Planned", value: totals.planned, className: "" },
          { label: "Committed", value: totals.committed, className: "text-status-todo" },
          { label: "Actual (paid)", value: totals.actual, className: "text-status-done" },
          {
            label: "Remaining",
            value: remaining,
            className: remaining < 0 ? "text-status-blocked" : "",
          },
        ].map((cell) => (
          <div key={cell.label} className="flex flex-col gap-1 rounded-md border p-4">
            <span className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              {cell.label}
            </span>
            <span className={cn("text-lg font-semibold tabular-nums", cell.className)}>
              {formatIDR(cell.value)}
            </span>
          </div>
        ))}
      </div>

      {/* budget lines */}
      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">
          Budget lines
        </h2>
        {lines.length === 0 ? (
          <p className="rounded-md border px-4 py-6 text-sm text-muted-foreground">
            {canManage
              ? "No budget lines yet — add the first one below."
              : "No budget lines visible to you."}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-2.5 font-medium">Division</th>
                  <th className="px-4 py-2.5 font-medium">Line</th>
                  <th className="px-4 py-2.5 text-right font-medium">Planned</th>
                  <th className="px-4 py-2.5 text-right font-medium">Committed</th>
                  <th className="px-4 py-2.5 text-right font-medium">Paid</th>
                  <th className="px-4 py-2.5 text-right font-medium">Left</th>
                  {canManage ? <th className="px-4 py-2.5" /> : null}
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => {
                  const left = line.planned - line.committed - line.actual;
                  return (
                    <tr key={line.id} className="border-b last:border-0">
                      <td className="px-4 py-2.5 text-xs text-muted-foreground">
                        {line.divisionName}
                      </td>
                      <td className="px-4 py-2.5 font-medium">{line.name}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        {formatIDR(line.planned)}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-status-todo">
                        {formatIDR(line.committed)}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-status-done">
                        {formatIDR(line.actual)}
                      </td>
                      <td
                        className={cn(
                          "px-4 py-2.5 text-right tabular-nums",
                          left < 0 && "text-status-blocked",
                        )}
                      >
                        {formatIDR(left)}
                      </td>
                      {canManage ? (
                        <td className="px-4 py-2.5 text-right">
                          <form action={removeLineAction}>
                            <input type="hidden" name="eventId" value={id} />
                            <input type="hidden" name="lineId" value={line.id} />
                            <button
                              type="submit"
                              aria-label={`Remove ${line.name}`}
                              className="text-xs text-muted-foreground hover:text-foreground"
                            >
                              ×
                            </button>
                          </form>
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {canManage ? (
          <AddLineForm
            eventId={id}
            divisions={divisions.map((d) => ({ id: d.id, name: d.name }))}
          />
        ) : null}
      </div>

      {/* expenses */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">
            Expense requests
          </h2>
          {myExpenseDivisions.length > 0 ? (
            <NewExpenseForm
              eventId={id}
              divisions={myExpenseDivisions.map((d) => ({ id: d.id, name: d.name }))}
              lines={lines.map((l) => ({
                id: l.id,
                label: `${l.divisionName} · ${l.name}`,
                divisionId: l.divisionId,
              }))}
            />
          ) : null}
        </div>
        {expenses.length === 0 ? (
          <p className="rounded-md border px-4 py-6 text-sm text-muted-foreground">
            No expense requests yet.
          </p>
        ) : (
          <ul className="flex flex-col divide-y rounded-md border">
            {expenses.map((expense) => {
              const meta = EXPENSE_STATUS_META[expense.status];
              return (
                <li
                  key={expense.id}
                  className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm"
                >
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {expense.title}
                  </span>
                  {expense.vendor ? (
                    <span className="text-xs text-muted-foreground">
                      {expense.vendor}
                    </span>
                  ) : null}
                  <span className="text-xs text-muted-foreground">
                    {divisionName.get(expense.divisionId)}
                  </span>
                  <span className="tabular-nums text-xs">
                    {formatIDR(expense.amount)}
                  </span>
                  <span className={cn("text-xs font-medium", meta.className)}>
                    {meta.label}
                  </span>
                  <Link
                    href={`/approvals/${expense.approvalId}`}
                    className="text-xs text-muted-foreground underline-offset-4 hover:underline"
                  >
                    chain ↗
                  </Link>
                  {canPay && expense.status === "committed" ? (
                    <form action={markPaidAction}>
                      <input type="hidden" name="eventId" value={id} />
                      <input type="hidden" name="expenseId" value={expense.id} />
                      <Button type="submit" size="sm" variant="outline">
                        Mark paid
                      </Button>
                    </form>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
