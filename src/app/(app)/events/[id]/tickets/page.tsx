import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { formatIDR } from "@/app/(app)/approvals/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { sessionActor } from "@/lib/auth/session-actor";
import { ChannelMap } from "./channel-map";
import { apiHealth } from "@/lib/tessera/health";
import { formatMoney } from "@/lib/tickets/money";
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
  const canManageChannels = can(actor, "org.manage");
  // One tab PER CHANNEL (Owner 2026-08-17: "buatkan tab baru di bagian ticket
  // ya" · "dipisahkan saja ya page nya"). Each platform gets its own surface
  // so their numbers are never read as one blended figure; Manual keeps the
  // hand-entered curve.
  //
  // Overall leads (Owner 2026-08-18): the first question about a show is how
  // it is selling in total, and only then which platform did what. It is a
  // summary ONLY — no transaction table — so the per-channel tabs stay the
  // single place detail lives.
  const tab =
    sp.tab === "manual" || sp.tab === "megatix" || sp.tab === "tessera"
      ? sp.tab
      : "overall";
  const isChannelTab = tab === "tessera" || tab === "megatix";
  const channelFilter = isChannelTab ? tab : "all";

  // The Connect tab reads the DATABASE, never the providers (Owner
  // 2026-08-13, extended for Megatix 2026-08-17): each sync stores every
  // transaction as-is, so rendering this page costs zero API calls — and
  // when a token dies the tab still shows the last-synced truth under its
  // timestamp instead of going blank.
  //
  // Two channels now (Owner: "ada 2 channel — tessera dan megatix"). A show
  // can sell on both at once, so totals are per channel AND combined; a
  // single blended number would hide which platform stopped reporting.
  type ChannelKey = "tessera" | "megatix";
  interface ChannelView {
    provider: ChannelKey;
    providerEventId: string | null;
    presenterId: string | null;
    lastDay: string | null;
    lastSyncedAt: Date | null;
    tickets: number;
    /** the tickets' face value — what the show earned */
    revenue: number;
    /** total charged to buyers, face value plus their fees */
    paid: number;
    fees: number;
    currency: string | null;
    rows: number;
  }
  const connect: {
    channels: ChannelView[];
    transactions: Array<{
      id: string;
      provider: string;
      orderId: string | null;
      buyerName: string | null;
      buyerEmail: string | null;
      category: string | null;
      status: string | null;
      promoCode: string | null;
      purchasedAt: Date | null;
      quantity: number;
      currency: string | null;
      ticketPrice: string | null;
      grossSales: string | null;
      totalFees: string | null;
      netSales: string | null;
    }>;
    tesseraStatus: Awaited<
      ReturnType<typeof import("@/lib/tessera/client").getTesseraStatus>
    > | null;
    megatixStatus: Awaited<
      ReturnType<typeof import("@/lib/megatix/client").getMegatixStatus>
    > | null;
  } = { channels: [], transactions: [], tesseraStatus: null, megatixStatus: null };

  if ((isChannelTab || tab === "overall") && canRecord) {
    const { db } = await import("@/db");
    const { eventTicketChannels, ticketTransactions } = await import("@/db/schema");
    const { and: andOp, desc, eq: eqOp, sql } = await import("drizzle-orm");

    if (canManageChannels) {
      if (tab !== "megatix") {
        const { getTesseraStatus } = await import("@/lib/tessera/client");
        connect.tesseraStatus = await getTesseraStatus(actor);
      }
      if (tab !== "tessera") {
        const { getMegatixStatus } = await import("@/lib/megatix/client");
        connect.megatixStatus = await getMegatixStatus(actor);
      }
    }

    const linked = await db
      .select({
        provider: eventTicketChannels.provider,
        providerEventId: eventTicketChannels.providerEventId,
        presenterId: eventTicketChannels.providerAccountId,
        lastDay: eventTicketChannels.lastDay,
        lastSyncedAt: eventTicketChannels.lastSyncedAt,
      })
      .from(eventTicketChannels)
      .where(eqOp(eventTicketChannels.eventId, id));
    const linkedBy = new Map(linked.map((l) => [l.provider, l]));

    // per-channel aggregates straight from the stored rows: tickets are the
    // SUM of quantity, because a Megatix order can carry several
    const perChannel = await db
      .select({
        provider: ticketTransactions.provider,
        tickets: sql<number>`coalesce(sum(quantity), 0)::int`,
        // Revenue is the tickets' FACE VALUE, matching the daily snapshot and
        // Tessera's own KPI. gross_sales is what buyers paid — face value plus
        // the platform's fee — and is shown beside it, never instead of it.
        revenue: sql<number>`coalesce(sum(ticket_price), 0)::float`,
        paid: sql<number>`coalesce(sum(gross_sales), 0)::float`,
        fees: sql<number>`coalesce(sum(total_fees), 0)::float`,
        currency: sql<string | null>`max(currency)`,
        rows: sql<number>`count(*)::int`,
      })
      .from(ticketTransactions)
      .where(eqOp(ticketTransactions.eventId, id))
      .groupBy(ticketTransactions.provider);
    const statsBy = new Map(perChannel.map((c) => [c.provider, c]));

    for (const provider of ["tessera", "megatix"] as ChannelKey[]) {
      const link = linkedBy.get(provider);
      const stats = statsBy.get(provider);
      // a channel appears when it is linked OR when it still holds history
      if (!link && !stats) continue;
      connect.channels.push({
        provider,
        providerEventId: link?.providerEventId ?? null,
        presenterId: link?.presenterId ?? null,
        lastDay: link?.lastDay ?? null,
        lastSyncedAt: link?.lastSyncedAt ?? null,
        tickets: stats?.tickets ?? 0,
        revenue: stats?.revenue ?? 0,
        paid: stats?.paid ?? 0,
        fees: stats?.fees ?? 0,
        currency: stats?.currency ?? null,
        rows: stats?.rows ?? 0,
      });
    }

    // Overall is a summary: it never loads transaction rows.
    if (isChannelTab)
    connect.transactions = await db
      .select({
        id: ticketTransactions.id,
        provider: ticketTransactions.provider,
        orderId: ticketTransactions.orderId,
        buyerName: ticketTransactions.buyerName,
        buyerEmail: ticketTransactions.buyerEmail,
        category: ticketTransactions.category,
        status: ticketTransactions.status,
        promoCode: ticketTransactions.promoCode,
        purchasedAt: ticketTransactions.purchasedAt,
        quantity: ticketTransactions.quantity,
        currency: ticketTransactions.currency,
        ticketPrice: ticketTransactions.ticketPrice,
        grossSales: ticketTransactions.grossSales,
        totalFees: ticketTransactions.totalFees,
        netSales: ticketTransactions.netSales,
      })
      .from(ticketTransactions)
      .where(
        channelFilter === "all"
          ? eqOp(ticketTransactions.eventId, id)
          : andOp(
              eqOp(ticketTransactions.eventId, id),
              eqOp(ticketTransactions.provider, channelFilter),
            ),
      )
      .orderBy(desc(ticketTransactions.purchasedAt))
      .limit(200);
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
        {/* Tessera | Megatix | Manual — a tab per channel so neither
            platform's figures are ever read as the whole show */}
        <div className="flex w-fit rounded-md border p-0.5 text-sm">
          {(
            [
              ["overall", "Overall"],
              ["megatix", "Megatix"],
              ["tessera", "Tessera (legacy)"],
              ["manual", "Manual"],
            ] as const
          ).map(([key, label]) => (
            <a
              key={key}
              href={`/events/${id}/tickets${key === "overall" ? "" : `?tab=${key}`}`}
              className={cn(
                "rounded px-3 py-1 transition-colors",
                tab === key
                  ? "bg-accent font-medium"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </a>
          ))}
        </div>
      </div>

      {tab === "overall" ? (
        !canRecord ? (
          <p className="rounded-md border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
            Ticket figures need the tickets.record capability.
          </p>
        ) : (() => {
          const live = connect.channels.filter((c) => c.rows > 0);
          if (live.length === 0) {
            return (
              <p className="rounded-md border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
                No ticketing channel has reported sales for this project yet.
              </p>
            );
          }
          // Adding IDR to AUD would produce a number that means nothing, so
          // the total is withheld rather than fabricated when the channels
          // disagree about currency.
          const currencies = new Set(live.map((c) => c.currency ?? "IDR"));
          const oneCurrency = currencies.size === 1;
          const currency = live[0].currency;
          const sum = (pick: (c: (typeof live)[number]) => number) =>
            live.reduce((total, c) => total + pick(c), 0);

          return (
            <div className="flex flex-col gap-5">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  {
                    label: "Tickets sold",
                    value: sum((c) => c.tickets).toLocaleString("en"),
                    hint: "Every channel added together",
                  },
                  {
                    label: "Revenue",
                    value: oneCurrency
                      ? formatMoney(sum((c) => c.revenue), currency)
                      : "—",
                    hint: "Ticket face value — what the show earned",
                  },
                  {
                    label: "Buyer fees",
                    value: oneCurrency ? formatMoney(sum((c) => c.fees), currency) : "—",
                    hint: "Charged on top by the platforms",
                  },
                  {
                    label: "Paid by buyers",
                    value: oneCurrency ? formatMoney(sum((c) => c.paid), currency) : "—",
                    hint: "Face value plus fees",
                  },
                ].map((cell) => (
                  <div
                    key={cell.label}
                    title={cell.hint}
                    className="flex flex-col gap-1 rounded-md border bg-card p-4"
                  >
                    <span className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                      {cell.label}
                    </span>
                    <span className="text-lg font-semibold tabular-nums">
                      {cell.value}
                    </span>
                  </div>
                ))}
              </div>

              {!oneCurrency ? (
                <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
                  The channels report different currencies (
                  {[...currencies].join(", ")}), so the money is not added up.
                  Ticket counts still are.
                </p>
              ) : null}

              {/* the split behind the total — still a summary, one line each */}
              <div className="overflow-x-auto rounded-md border bg-card">
                <table className="w-full min-w-[520px] text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs uppercase tracking-wider text-muted-foreground">
                      <th className="px-4 py-2.5 font-medium">Channel</th>
                      <th className="px-4 py-2.5 text-right font-medium">Tickets</th>
                      <th className="px-4 py-2.5 text-right font-medium">Revenue</th>
                      <th className="px-4 py-2.5 text-right font-medium">Fees</th>
                      <th className="px-4 py-2.5 font-medium">Last sync</th>
                    </tr>
                  </thead>
                  <tbody>
                    {live.map((channel) => (
                      <tr key={channel.provider} className="border-b last:border-0">
                        <td className="px-4 py-2.5 font-medium capitalize">
                          {channel.provider}
                          {channel.providerEventId ? null : (
                            <span className="ml-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                              unlinked
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums">
                          {channel.tickets.toLocaleString("en")}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums">
                          {formatMoney(channel.revenue, channel.currency)}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                          {formatMoney(channel.fees, channel.currency)}
                        </td>
                        <td className="px-4 py-2.5 text-xs text-muted-foreground">
                          {channel.lastSyncedAt
                            ? channel.lastSyncedAt.toLocaleString("en-GB", {
                                day: "numeric",
                                month: "short",
                                hour: "2-digit",
                                minute: "2-digit",
                                timeZone: "Asia/Jakarta",
                              })
                            : "never"}
                        </td>
                      </tr>
                    ))}
                    <tr className="bg-muted/30">
                      <td className="px-4 py-2.5 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                        Total
                      </td>
                      <td className="px-4 py-2.5 text-right font-semibold tabular-nums">
                        {sum((c) => c.tickets).toLocaleString("en")}
                      </td>
                      <td className="px-4 py-2.5 text-right font-semibold tabular-nums">
                        {oneCurrency ? formatMoney(sum((c) => c.revenue), currency) : "—"}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                        {oneCurrency ? formatMoney(sum((c) => c.fees), currency) : "—"}
                      </td>
                      <td />
                    </tr>
                  </tbody>
                </table>
              </div>

              <p className="text-xs text-muted-foreground">
                Figures are cumulative totals from each platform, stored at the
                last sync — a channel that has stopped reporting keeps its last
                known number rather than dropping to zero. Open a channel tab
                for its transactions.
              </p>
            </div>
          );
        })()
      ) : null}

      {isChannelTab ? (
        <div className="flex flex-col gap-4">
          {!canRecord ? (
            <p className="rounded-md border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
              Connecting ticketing needs the tickets.record capability.
            </p>
          ) : (
            <>
              {tab === "tessera" ? (
                <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
                  Tessera is being discontinued — new sales are tracked on the
                  Megatix tab. What is stored here stays readable, so past
                  shows keep their history.
                </p>
              ) : null}
              {canManageChannels ? (
                <ChannelMap
                  eventId={id}
                  provider={tab}
                  mappedId={
                    connect.channels.find((c) => c.provider === tab)
                      ?.providerEventId ?? null
                  }
                  presenterId={
                    connect.channels.find((c) => c.provider === tab)
                      ?.presenterId ?? null
                  }
                />
              ) : null}

              {/* the health of THIS channel; the other tab answers for its own */}
              {(() => {
                const status =
                  tab === "tessera" ? connect.tesseraStatus : connect.megatixStatus;
                if (!status) return null;
                const h =
                  tab === "tessera"
                    ? apiHealth(connect.tesseraStatus!)
                    : apiHealth({
                        configured: status.configured,
                        // Megatix signs in again by itself, so there is no
                        // expiry countdown to warn about
                        daysLeft: null,
                        lastOkAt: status.lastOkAt,
                        lastError: status.lastError,
                      });
                return (
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium",
                        h.state === "live"
                          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                          : h.state === "expiring"
                            ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400"
                            : h.state === "off"
                              ? "border-border bg-muted/40 text-muted-foreground"
                              : "border-destructive/40 bg-destructive/10 text-destructive",
                      )}
                    >
                      <span
                        aria-hidden
                        className={cn(
                          "size-1.5 rounded-full",
                          h.state === "live"
                            ? "bg-emerald-500"
                            : h.state === "expiring"
                              ? "bg-amber-500"
                              : h.state === "off"
                                ? "bg-muted-foreground/50"
                                : "bg-destructive",
                        )}
                      />
                      {h.label}
                    </span>
                    {h.detail ? (
                      <span className="text-xs text-muted-foreground">{h.detail}</span>
                    ) : null}
                    {!status.configured && canManageChannels ? (
                      <a href="/admin" className="text-xs underline underline-offset-4">
                        Connect it in Admin
                      </a>
                    ) : null}
                  </div>
                );
              })()}

              {(() => {
                const channel = connect.channels.find((c) => c.provider === tab);
                if (!channel) {
                  return (
                    <p className="rounded-md border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
                      This project is not linked to {tab === "tessera" ? "Tessera" : "Megatix"} yet.
                      {canManageChannels
                        ? " Link it above — credentials live in Admin, one set for the whole organisation."
                        : " An org admin can link it from this page."}
                    </p>
                  );
                }
                return (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {[
                      { label: "Tickets", value: channel.tickets.toLocaleString("en") },
                      {
                        label: "Revenue",
                        value: formatMoney(channel.revenue, channel.currency),
                        hint: "Ticket face value — the figure the daily snapshot uses",
                      },
                      {
                        label: "Buyer fees",
                        value: formatMoney(channel.fees, channel.currency),
                        hint: "Charged on top by the platform",
                      },
                      {
                        label: "Paid by buyers",
                        value: formatMoney(channel.paid, channel.currency),
                        hint: "Face value plus fees — what left the buyers' pockets",
                      },
                    ].map((cell) => (
                      <div
                        key={cell.label}
                        title={"hint" in cell ? cell.hint : undefined}
                        className="flex flex-col gap-1 rounded-md border bg-card p-4"
                      >
                        <span className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                          {cell.label}
                        </span>
                        <span className="text-base font-semibold tabular-nums">
                          {cell.value}
                        </span>
                      </div>
                    ))}
                  </div>
                );
              })()}

              {/* No cross-channel total here (Owner 2026-08-17: "dibuat satu
                  satu saja jangan digabung"). Each tab answers for its own
                  platform; the event-level daily snapshot still sums them,
                  because the dashboard, event health and the settlement PDF
                  each need ONE figure per show. */}

              {connect.transactions.length > 0 ? (
                <div className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 className="text-sm font-semibold">
                      Transactions{" "}
                      <span className="font-normal text-muted-foreground">
                        — stored as sent from {tab === "tessera" ? "Tessera" : "Megatix"},{" "}
                      {connect.transactions.length} row(s)
                      </span>
                    </h2>
                  </div>
                  <div className="overflow-x-auto rounded-md border bg-card">
                    <table className="w-full min-w-[900px] text-sm">
                      <thead>
                        <tr className="border-b text-left text-xs uppercase tracking-wider text-muted-foreground">
                          <th className="px-3 py-2.5 font-medium">Order</th>
                          <th className="px-3 py-2.5 font-medium">Buyer</th>
                          <th className="px-3 py-2.5 font-medium">Category</th>
                          <th className="px-3 py-2.5 font-medium">Status</th>
                          <th className="px-3 py-2.5 font-medium">Promo</th>
                          <th className="px-3 py-2.5 font-medium">Purchased (WIB)</th>
                          <th className="px-3 py-2.5 text-right font-medium">Qty</th>
                          <th className="px-3 py-2.5 text-right font-medium">Price</th>
                          <th className="px-3 py-2.5 text-right font-medium">Gross</th>
                          <th className="px-3 py-2.5 text-right font-medium">Fees</th>
                          <th className="px-3 py-2.5 text-right font-medium">Net</th>
                        </tr>
                      </thead>
                      <tbody>
                        {connect.transactions.map((row) => (
                          <tr key={row.id} className="border-b last:border-0">
                            <td className="px-3 py-2 font-mono text-xs">
                              {row.orderId ?? "—"}
                            </td>
                            <td className="px-3 py-2 text-xs text-muted-foreground">
                              {row.buyerEmail ?? row.buyerName ?? "—"}
                            </td>
                            <td className="px-3 py-2 text-xs">{row.category ?? "—"}</td>
                            <td className="px-3 py-2 text-xs">{row.status ?? "—"}</td>
                            <td className="px-3 py-2 text-xs text-muted-foreground">
                              {row.promoCode ?? "—"}
                            </td>
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
                              {row.quantity}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              {formatMoney(
                                row.ticketPrice ? Number(row.ticketPrice) : null,
                                row.currency,
                              )}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              {formatMoney(
                                row.grossSales ? Number(row.grossSales) : null,
                                row.currency,
                              )}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                              {formatMoney(
                                row.totalFees ? Number(row.totalFees) : null,
                                row.currency,
                              )}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              {/* Megatix reports no promoter-net figure, so this
                                  stays blank rather than being guessed */}
                              {formatMoney(
                                row.netSales ? Number(row.netSales) : null,
                                row.currency,
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : connect.channels.some((c) => c.provider === tab) ? (
                <p className="rounded-md border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
                  No transactions stored yet — run Admin → Sync now, or wait for
                  the hourly sync.
                </p>
              ) : null}
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
