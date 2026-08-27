import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { formatIDR } from "@/app/(app)/approvals/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { sessionActor } from "@/lib/auth/session-actor";
import { TesseraMap } from "./tessera-map";
import { apiHealth } from "@/lib/tessera/health";
import { getEvent } from "@/lib/events/service";
import { can, PermissionError } from "@/lib/permissions";
import {
  listSnapshots,
  recordSnapshot,
  wibDayKey,
} from "@/lib/tickets/service";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Ticket sales" };

// T-093: daily manual ticket sales — entry for Ticketing, curve for all.
export default async function TicketsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await sessionActor();
  if (!actor) redirect("/login");

  const { id } = await params;
  const sp = await searchParams;
  const event = await getEvent(actor, id);
  if (!event) notFound();

  const snapshots = await listSnapshots(actor, id);
  const canRecord = can(actor, "tickets.record");
  const canMapTessera = can(actor, "org.manage");
  const tab = sp.tab === "manual" ? "manual" : "connect";

  // The Connect tab reads the DATABASE, not Tessera (Owner 2026-08-13):
  // sync stores every transaction as-is, so rendering this page costs zero
  // calls to their unofficial API — and when the five-day token dies, the
  // tab shows the last-synced truth with its timestamp instead of a blank.
  const connect: {
    kpis: { sold: number | null; revenue: number | null } | null;
    transactions: Array<{
      id: string;
      orderId: string | null;
      buyerEmail: string | null;
      category: string | null;
      status: string | null;
      promoCode: string | null;
      purchasedAt: Date | null;
      ticketPrice: string | null;
      totalFees: string | null;
      netSales: string | null;
    }>;
    sums: { gross: number; fees: number; net: number; refunded: number } | null;
    error: string | null;
    status: Awaited<ReturnType<typeof import("@/lib/tessera/client").getTesseraStatus>> | null;
  } = { kpis: null, transactions: [], sums: null, error: null, status: null };
  if (tab === "connect" && canRecord) {
    const { getTesseraStatus } = await import("@/lib/tessera/client");
    connect.status = canMapTessera ? await getTesseraStatus(actor) : null;
    if (event.tesseraEventId) {
      const { db } = await import("@/db");
      const { tesseraTransactions } = await import("@/db/schema");
      const { desc, eq: eqOp, sql } = await import("drizzle-orm");
      const latest = snapshots.at(-1);
      connect.kpis = latest
        ? { sold: latest.ticketsSold, revenue: latest.revenue }
        : null;
      connect.transactions = await db
        .select({
          id: tesseraTransactions.id,
          orderId: tesseraTransactions.orderId,
          buyerEmail: tesseraTransactions.buyerEmail,
          category: tesseraTransactions.category,
          status: tesseraTransactions.status,
          promoCode: tesseraTransactions.promoCode,
          purchasedAt: tesseraTransactions.purchasedAt,
          ticketPrice: tesseraTransactions.ticketPrice,
          totalFees: tesseraTransactions.totalFees,
          netSales: tesseraTransactions.netSales,
        })
        .from(tesseraTransactions)
        .where(eqOp(tesseraTransactions.eventId, id))
        .orderBy(desc(tesseraTransactions.purchasedAt))
        .limit(200);
      const [sums] = await db
        .select({
          gross: sql<number>`coalesce(sum(gross_sales), 0)::float`,
          fees: sql<number>`coalesce(sum(total_fees), 0)::float`,
          net: sql<number>`coalesce(sum(net_sales), 0)::float`,
          refunded: sql<number>`coalesce(sum(refunded_amount), 0)::float`,
        })
        .from(tesseraTransactions)
        .where(eqOp(tesseraTransactions.eventId, id));
      connect.sums = sums ?? null;
    }
  }
  // the aggregate cards are gone (Owner 2026-08-12): the headline numbers
  // come from Tessera on the Connect tab, and two competing totals on one
  // page is how people stop trusting either
  const maxDay = Math.max(1, ...snapshots.map((s) => s.ticketsSold));

  async function recordAction(formData: FormData) {
    "use server";
    const actorInner = await sessionActor();
    if (!actorInner) throw new PermissionError("tickets.record");
    await recordSnapshot(actorInner, {
      eventId: id,
      day: String(formData.get("day")),
      ticketsSold: Number(formData.get("ticketsSold") ?? 0),
      revenue: Number(String(formData.get("revenue") ?? "0").replaceAll(".", "")),
      note: String(formData.get("note") ?? ""),
    });
    revalidatePath(`/events/${id}/tickets`);
  }

  return (
    <section className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">
          Ticket sales
        </h1>
        {/* Manual | Connect — the source of truth stays ONE table either way;
            Connect only automates what the form does by hand */}
        <div className="flex w-fit rounded-md border p-0.5 text-sm">
          <a
            href={`/events/${id}/tickets`}
            className={cn(
              "rounded px-3 py-1 transition-colors",
              tab === "connect" ? "bg-accent font-medium" : "text-muted-foreground hover:text-foreground",
            )}
          >
            Connect (Tessera)
          </a>
          <a
            href={`/events/${id}/tickets?tab=manual`}
            className={cn(
              "rounded px-3 py-1 transition-colors",
              tab === "manual" ? "bg-accent font-medium" : "text-muted-foreground hover:text-foreground",
            )}
          >
            Manual
          </a>
        </div>
      </div>

      {tab === "connect" ? (
        <div className="flex flex-col gap-4">
          {!canRecord ? (
            <p className="rounded-md border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
              Connecting ticketing needs the tickets.record capability.
            </p>
          ) : (
            <>
              {canMapTessera ? (
                <TesseraMap eventId={id} mappedId={event.tesseraEventId} />
              ) : null}
              {connect.status ? (
                (() => {
                  const h = apiHealth(connect.status);
                  const tone =
                    h.state === "live"
                      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                      : h.state === "expiring"
                        ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400"
                        : h.state === "off"
                          ? "border-border bg-muted/40 text-muted-foreground"
                          : "border-destructive/40 bg-destructive/10 text-destructive";
                  const dot =
                    h.state === "live"
                      ? "bg-emerald-500"
                      : h.state === "expiring"
                        ? "bg-amber-500"
                        : h.state === "off"
                          ? "bg-muted-foreground/50"
                          : "bg-destructive";
                  return (
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${tone}`}
                      >
                        <span className={`size-1.5 rounded-full ${dot}`} aria-hidden />
                        {h.label}
                      </span>
                      {h.detail ? (
                        <span className="text-xs text-muted-foreground">{h.detail}</span>
                      ) : null}
                    </div>
                  );
                })()
              ) : null}
              {connect.status && !connect.status.configured ? (
                <p className="rounded-md border border-dashed px-4 py-4 text-sm text-muted-foreground">
                  No Tessera token is connected yet. Paste one in{" "}
                  <a href="/admin" className="underline underline-offset-4">Admin → Tessera ticketing</a>{" "}
                  — one token serves the whole organisation, so it lives there
                  rather than on each project.
                </p>
              ) : null}
              {connect.error ? (
                <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                  {connect.error}
                </p>
              ) : null}
              {connect.status?.lastOkAt ? (
                <p className="text-xs text-muted-foreground">
                  Last sync with Tessera:{" "}
                  {new Date(connect.status.lastOkAt).toLocaleString("en-GB", {
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                    timeZone: "Asia/Jakarta",
                  })}{" "}
                  WIB — refreshed hourly, or from Admin → Sync now.
                </p>
              ) : null}
              {event.tesseraEventId && connect.kpis ? (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                  {[
                    { label: "Tickets sold", value: connect.kpis.sold?.toLocaleString("en") ?? "—" },
                    { label: "Revenue", value: connect.kpis.revenue !== null ? formatIDR(connect.kpis.revenue) : "—" },
                    { label: "Gross sales", value: connect.sums ? formatIDR(Math.round(connect.sums.gross)) : "—" },
                    { label: "Fees", value: connect.sums ? formatIDR(Math.round(connect.sums.fees)) : "—" },
                    { label: "Net sales", value: connect.sums ? formatIDR(Math.round(connect.sums.net)) : "—" },
                    { label: "Refunded", value: connect.sums ? formatIDR(Math.round(connect.sums.refunded)) : "—" },
                  ].map((cell) => (
                    <div key={cell.label} className="flex flex-col gap-1 rounded-md border bg-card p-4">
                      <span className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                        {cell.label}
                      </span>
                      <span className="text-base font-semibold tabular-nums">{cell.value}</span>
                    </div>
                  ))}
                </div>
              ) : null}
              {event.tesseraEventId ? (
                connect.transactions.length > 0 ? (
                  <div className="flex flex-col gap-2">
                    <h2 className="text-sm font-semibold">
                      Transactions{" "}
                      <span className="font-normal text-muted-foreground">
                        — stored from Tessera, {connect.transactions.length} row(s)
                      </span>
                    </h2>
                    <div className="overflow-x-auto rounded-md border bg-card">
                      <table className="w-full min-w-[860px] text-sm">
                        <thead>
                          <tr className="border-b text-left text-xs uppercase tracking-wider text-muted-foreground">
                            <th className="px-3 py-2.5 font-medium">Order</th>
                            <th className="px-3 py-2.5 font-medium">Email</th>
                            <th className="px-3 py-2.5 font-medium">Category</th>
                            <th className="px-3 py-2.5 font-medium">Status</th>
                            <th className="px-3 py-2.5 font-medium">Promo</th>
                            <th className="px-3 py-2.5 font-medium">Purchased (WIB)</th>
                            <th className="px-3 py-2.5 text-right font-medium">Price</th>
                            <th className="px-3 py-2.5 text-right font-medium">Fees</th>
                            <th className="px-3 py-2.5 text-right font-medium">Net</th>
                          </tr>
                        </thead>
                        <tbody>
                          {connect.transactions.map((row) => (
                            <tr key={row.id} className="border-b last:border-0">
                              <td className="px-3 py-2 font-mono text-xs">{row.orderId ?? "—"}</td>
                              <td className="px-3 py-2 text-xs text-muted-foreground">{row.buyerEmail ?? "—"}</td>
                              <td className="px-3 py-2 text-xs">{row.category ?? "—"}</td>
                              <td className="px-3 py-2 text-xs">{row.status ?? "—"}</td>
                              <td className="px-3 py-2 text-xs text-muted-foreground">{row.promoCode ?? "—"}</td>
                              <td className="px-3 py-2 text-xs text-muted-foreground">
                                {row.purchasedAt
                                  ? row.purchasedAt.toLocaleString("en-GB", {
                                      day: "numeric",
                                      month: "short",
                                      hour: "2-digit",
                                      minute: "2-digit",
                                      timeZone: "Asia/Jakarta",
                                    })
                                  : "—"}
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums">
                                {row.ticketPrice ? formatIDR(Math.round(Number(row.ticketPrice))) : "—"}
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                                {row.totalFees ? formatIDR(Math.round(Number(row.totalFees))) : "—"}
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums">
                                {row.netSales ? formatIDR(Math.round(Number(row.netSales))) : "—"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : !connect.error ? (
                  <p className="rounded-md border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
                    No transactions stored yet — run Admin → Sync now, or wait
                    for the hourly sync.
                  </p>
                ) : null
              ) : (
                <p className="text-xs text-muted-foreground">
                  Link a Tessera event above to see its transactions here.
                </p>
              )}
            </>
          )}
        </div>
      ) : null}

      {tab === "manual" && canRecord ? (
        <form
          action={recordAction}
          className="flex flex-wrap items-end gap-3 rounded-md border bg-card p-4"
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ts-day" className="text-xs">
              Date (WIB)
            </Label>
            <Input
              id="ts-day"
              name="day"
              type="date"
              required
              defaultValue={wibDayKey(new Date())}
              className="h-9 w-40"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ts-sold" className="text-xs">
              Tickets sold today
            </Label>
            <Input
              id="ts-sold"
              name="ticketsSold"
              type="number"
              min={0}
              required
              className="h-9 w-36"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ts-revenue" className="text-xs">
              Revenue (IDR)
            </Label>
            <Input
              id="ts-revenue"
              name="revenue"
              inputMode="numeric"
              placeholder="0"
              className="h-9 w-44"
            />
          </div>
          <div className="flex min-w-48 flex-1 flex-col gap-1.5">
            <Label htmlFor="ts-note" className="text-xs">
              Note
            </Label>
            <Input id="ts-note" name="note" className="h-9" />
          </div>
          <Button type="submit">Record</Button>
        </form>
      ) : null}

      {/* daily curve — manual view of the same snapshot table */}
      {tab !== "manual" ? null : snapshots.length === 0 ? (
        <p className="rounded-md border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
          No sales recorded yet.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold">
            Daily sales
          </h2>
          <div className="flex items-end gap-1.5 overflow-x-auto rounded-md border bg-card p-4">
            {snapshots.map((s) => (
              <div
                key={s.id}
                className="flex min-w-9 flex-col items-center gap-1"
                title={`${s.day}: ${s.ticketsSold.toLocaleString("en")} tickets · ${formatIDR(s.revenue)}${s.note ? ` — ${s.note}` : ""}`}
              >
                <span className="text-[9px] tabular-nums text-muted-foreground">
                  {s.ticketsSold.toLocaleString("en")}
                </span>
                <div
                  className={cn("w-6 rounded-t-sm bg-foreground/70")}
                  style={{
                    height: `${Math.max(6, Math.round((s.ticketsSold / maxDay) * 120))}px`,
                  }}
                />
                <span className="text-[9px] tabular-nums text-muted-foreground">
                  {s.day.slice(5)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
