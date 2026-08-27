import { describe, expect, it } from "vitest";
import { rollUpChannels } from "./rollup-rules";

// The shape that matters: cumulative per-channel totals, one of which may be
// stale because its provider's token died.
const day = "2026-08-18";

describe("rollUpChannels", () => {
  it("sums both channels when both reported today", () => {
    expect(
      rollUpChannels(
        [
          { provider: "tessera", lastDay: day, lastTickets: 54, lastRevenue: 20_250_000 },
          { provider: "megatix", lastDay: day, lastTickets: 19, lastRevenue: 7_125_000 },
        ],
        day,
      ),
    ).toEqual({
      tickets: 73,
      revenue: 27_375_000,
      note: "Synced from Megatix + Tessera",
    });
  });

  it("carries a stale channel forward instead of dropping it", () => {
    // the exact case that made the show look like it fell from 54 to 19
    const result = rollUpChannels(
      [
        { provider: "tessera", lastDay: "2026-08-16", lastTickets: 54, lastRevenue: 20_250_000 },
        { provider: "megatix", lastDay: day, lastTickets: 19, lastRevenue: 7_125_000 },
      ],
      day,
    );
    expect(result.tickets).toBe(73);
    expect(result.note).toContain("as of 2026-08-16");
  });

  it("ignores a channel that has never reported", () => {
    expect(
      rollUpChannels(
        [
          { provider: "tessera", lastDay: null, lastTickets: null, lastRevenue: null },
          { provider: "megatix", lastDay: day, lastTickets: 19, lastRevenue: 7_125_000 },
        ],
        day,
      ),
    ).toEqual({ tickets: 19, revenue: 7_125_000, note: "Synced from Megatix" });
  });

  it("no channels at all sums to nothing rather than NaN", () => {
    expect(rollUpChannels([], day)).toEqual({
      tickets: 0,
      revenue: 0,
      note: "Synced from —",
    });
  });
});
