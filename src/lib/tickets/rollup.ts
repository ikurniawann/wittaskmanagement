import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { eventTicketChannels } from "@/db/schema";
import { ticketSalesSnapshots } from "@/db/schema";
import { rollUpChannels } from "./rollup-rules";

// Daily roll-up across ticketing channels (Owner 2026-08-17).
//
// ticket_sales_snapshots is keyed (event, day) and is what event health, the
// dashboard, the AI and the settlement PDF all read. With two channels live
// on one show, each provider's sync used to write that row directly — so the
// last sync of the hour won and the headline showed ONE channel's sales as
// if they were the whole show. Each channel now records its own numbers and
// the shared row is recomputed as their sum.

export interface ChannelDaily {
  eventId: string;
  provider: string;
  day: string;
  tickets: number;
  revenue: number;
}

/**
 * Records one channel's figures for a day, then rewrites the shared snapshot
 * as the sum of every channel's LATEST known total.
 *
 * These figures are cumulative — tickets sold to date, not sales made today —
 * so a channel that did not report this run must be carried forward at its
 * last known value, not dropped. Dropping it was the first version of this
 * function, and the moment the Tessera token expired the show appeared to
 * fall from 54 tickets to 19 overnight. The note names any channel whose
 * number is stale, so nobody reads a carried-forward figure as fresh.
 */
export async function recordChannelDaily(input: ChannelDaily): Promise<void> {
  await db
    .update(eventTicketChannels)
    .set({
      lastDay: input.day,
      lastTickets: input.tickets,
      lastRevenue: Math.round(input.revenue),
      lastSyncedAt: new Date(),
    })
    .where(
      and(
        eq(eventTicketChannels.eventId, input.eventId),
        eq(eventTicketChannels.provider, input.provider),
      ),
    );

  const channels = await db
    .select({
      provider: eventTicketChannels.provider,
      lastDay: eventTicketChannels.lastDay,
      lastTickets: eventTicketChannels.lastTickets,
      lastRevenue: eventTicketChannels.lastRevenue,
    })
    .from(eventTicketChannels)
    .where(eq(eventTicketChannels.eventId, input.eventId));

  const totals = rollUpChannels(channels, input.day);

  const values = {
    eventId: input.eventId,
    day: input.day,
    ticketsSold: totals.tickets,
    revenue: totals.revenue,
    note: totals.note,
    recordedBy: null,
  };
  await db
    .insert(ticketSalesSnapshots)
    .values(values)
    .onConflictDoUpdate({
      target: [ticketSalesSnapshots.eventId, ticketSalesSnapshots.day],
      set: values,
    });
}
