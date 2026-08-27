// The pure half of the channel roll-up, kept apart from the queries so it can
// be tested without a database — the same split as dataroom/access.ts and
// events/visibility-rules.ts.

export interface ChannelTotals {
  provider: string;
  lastDay: string | null;
  lastTickets: number | null;
  lastRevenue: number | null;
}

/**
 * Sums every channel's LATEST cumulative total.
 *
 * These figures are cumulative — tickets sold to date, not sales made today —
 * so a channel that did not report this run is carried forward at its last
 * known value rather than dropped. Dropping it was the first version of this
 * rule, and the moment the Tessera token expired the show appeared to fall
 * from 54 tickets to 19 overnight. The note names any channel whose number is
 * stale, so a carried-forward figure is never read as fresh.
 */
export function rollUpChannels(
  channels: ChannelTotals[],
  day: string,
): { tickets: number; revenue: number; note: string } {
  const reported = channels.filter((c) => c.lastDay !== null);
  const tickets = reported.reduce((sum, c) => sum + (c.lastTickets ?? 0), 0);
  const revenue = reported.reduce((sum, c) => sum + (c.lastRevenue ?? 0), 0);
  const names = [...reported]
    .sort((a, b) => a.provider.localeCompare(b.provider))
    .map((c) => {
      const name = c.provider.charAt(0).toUpperCase() + c.provider.slice(1);
      return c.lastDay === day ? name : `${name} (as of ${c.lastDay})`;
    });
  return { tickets, revenue, note: `Synced from ${names.join(" + ") || "—"}` };
}
