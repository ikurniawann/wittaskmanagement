import { agentRoute } from "@/lib/agent/respond";
import { listSnapshots, recordSnapshot, wibDayKey } from "@/lib/tickets/service";

/**
 * GET /tickets?eventId=… — per-channel figures + the daily curve.
 * Channel rows come from the same stored aggregates the Overall tab shows.
 */
export async function GET(request: Request) {
  return agentRoute(request, async ({ actor }) => {
    const eventId = new URL(request.url).searchParams.get("eventId");
    if (!eventId) throw new Error("Pass ?eventId=…");
    const snapshots = await listSnapshots(actor, eventId);
    const { db } = await import("@/db");
    const { eventTicketChannels } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    const channels = await db
      .select({
        provider: eventTicketChannels.provider,
        lastDay: eventTicketChannels.lastDay,
        tickets: eventTicketChannels.lastTickets,
        revenue: eventTicketChannels.lastRevenue,
        lastSyncedAt: eventTicketChannels.lastSyncedAt,
      })
      .from(eventTicketChannels)
      .where(eq(eventTicketChannels.eventId, eventId));
    return { channels, snapshots };
  });
}

/** POST { eventId, ticketsSold, revenue, day?, note? } — a MANUAL snapshot. */
export async function POST(request: Request) {
  return agentRoute(request, async ({ actor, keyName }) => {
    const body = (await request.json().catch(() => null)) as {
      eventId?: string;
      day?: string;
      ticketsSold?: number;
      revenue?: number;
      note?: string;
    } | null;
    if (!body?.eventId || body.ticketsSold === undefined) {
      throw new Error("eventId and ticketsSold are required.");
    }
    await recordSnapshot(actor, {
      eventId: body.eventId,
      day: body.day ?? wibDayKey(new Date()),
      ticketsSold: body.ticketsSold,
      revenue: body.revenue ?? 0,
      note: `${body.note ?? "Manual entry"} — via ${keyName}`,
    });
    return { recorded: true };
  });
}
