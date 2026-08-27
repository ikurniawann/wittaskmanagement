import { describe, expect, it } from "vitest";
import {
  extractEvents,
  extractOrders,
  extractPresenters,
  parseMegatixTime,
  summariseOrders,
} from "./extract";

// Pinned from the Megatix Data API documentation (v2024.10.14). When their
// shape changes, this test is what tells us — not a silent column of zeros.
const ORDERS_PAYLOAD = {
  event: { name: "Pineapple Club Season Opener", currency_code: "AUD" },
  data: [
    {
      event_name: "Pineapple Club Season Opener",
      completed_at: "2024-07-01 11:36:54",
      order_number: "6024360934",
      start_datetime: "2024-11-20 11:36:00",
      discount: null,
      discount_amount: null,
      ticket_subtotal: 248,
      upsales_amount: null,
      delivery_fee: null,
      quantity: 2,
      first_name: "Ryan",
      last_name: "Posling",
      email: "pos2@megatix.com.au",
      phone: null,
      amount: 253.5,
      transaction_fee: 3.65,
    },
  ],
  page: 1,
  page_size: 1,
  page_size_limit: 1000,
};

describe("megatix orders", () => {
  it("reads the documented row end to end", () => {
    const [order] = extractOrders(ORDERS_PAYLOAD);
    expect(order.orderNumber).toBe("6024360934");
    expect(order.buyerName).toBe("Ryan Posling");
    expect(order.buyerEmail).toBe("pos2@megatix.com.au");
    expect(order.buyerPhone).toBeNull();
    expect(order.quantity).toBe(2);
    expect(order.currency).toBe("AUD");
  });

  it("keeps money as exact strings — 3.65 must not meet a float", () => {
    const [order] = extractOrders(ORDERS_PAYLOAD);
    expect(order.transactionFee).toBe("3.65");
    expect(order.ticketSubtotal).toBe("248");
    expect(order.amount).toBe("253.5");
    // absent money is null, never "0" — a zero would read as "no fee charged"
    expect(order.discountAmount).toBeNull();
    expect(order.deliveryFee).toBeNull();
  });

  it("keeps the raw row and the untouched timestamp string", () => {
    const [order] = extractOrders(ORDERS_PAYLOAD);
    expect(order.completedAtRaw).toBe("2024-07-01 11:36:54");
    expect(order.raw.upsales_amount).toBeNull();
    expect(order.raw.event_name).toBe("Pineapple Club Season Opener");
  });

  it("drops rows with no order_number rather than inventing an identity", () => {
    const orders = extractOrders({ data: [{ amount: 100, quantity: 1 }] });
    expect(orders).toEqual([]);
  });

  it("refuses a shape it does not recognise instead of returning zeros", () => {
    expect(extractOrders(null)).toEqual([]);
    expect(extractOrders({ orders: [{ order_number: "x" }] })).toEqual([]);
  });
});

describe("megatix timestamps", () => {
  it("reads the zone-less wall clock as WIB", () => {
    // 11:36:54 in Jakarta is 04:36:54Z
    expect(parseMegatixTime("2024-07-01 11:36:54")!.toISOString()).toBe(
      "2024-07-01T04:36:54.000Z",
    );
  });

  it("an early-morning order stays on its own WIB day", () => {
    // 02:00 WIB on the 2nd is 19:00Z on the 1st — the trap that would file it
    // under the previous day if it were read as UTC
    const at = parseMegatixTime("2024-07-02 02:00:00")!;
    expect(at.toISOString()).toBe("2024-07-01T19:00:00.000Z");
  });

  it("refuses garbage", () => {
    expect(parseMegatixTime("")).toBeNull();
    expect(parseMegatixTime("last tuesday")).toBeNull();
    expect(parseMegatixTime(null)).toBeNull();
  });
});

describe("megatix summaries", () => {
  it("counts TICKETS, not orders — one order can carry several", () => {
    const orders = extractOrders({
      event: { currency_code: "IDR" },
      data: [
        { order_number: "A", quantity: 2, amount: 253.5, transaction_fee: 3.65 },
        { order_number: "B", quantity: 3, amount: 300, transaction_fee: 5 },
      ],
    });
    expect(summariseOrders(orders)).toEqual({
      tickets: 5,
      revenue: 553.5,
      fees: 8.65,
    });
  });

  it("an empty channel summarises to zeros, not NaN", () => {
    expect(summariseOrders([])).toEqual({ tickets: 0, revenue: 0, fees: 0 });
  });
});

describe("megatix presenters & events", () => {
  it("reads presenters", () => {
    const rows = extractPresenters({
      data: [{ id: 12, name: "Pineapple Club", country_code: "AU", subdomain: "pineapple" }],
    });
    expect(rows).toEqual([{ id: "12", name: "Pineapple Club", countryCode: "AU" }]);
  });

  it("reads events with their currency", () => {
    const rows = extractEvents({
      data: [
        {
          id: 901,
          name: "Season Opener",
          start_datetime: "2024-11-20 11:36:00",
          currency_code: "AUD",
        },
      ],
    });
    expect(rows[0]).toEqual({
      id: "901",
      name: "Season Opener",
      startAt: "2024-11-20 11:36:00",
      currency: "AUD",
    });
  });

  it("drops nameless rows", () => {
    expect(extractEvents({ data: [{ id: 5 }] })).toEqual([]);
    expect(extractPresenters({ data: [{ name: "no id" }] })).toEqual([]);
  });
});

// Added after meeting the live API (2026-08-17): the real responses carry an
// explicit offset, which the documented samples do not.
describe("megatix timestamps — live shapes", () => {
  it("honours an explicit +0700 offset instead of assuming one", () => {
    expect(parseMegatixTime("2026-08-24T20:00:00+0700")!.toISOString()).toBe(
      "2026-08-24T13:00:00.000Z",
    );
  });

  it("honours a NON-Jakarta offset — the case that would silently corrupt", () => {
    expect(parseMegatixTime("2026-08-24T20:00:00+1000")!.toISOString()).toBe(
      "2026-08-24T10:00:00.000Z",
    );
    expect(parseMegatixTime("2026-08-24T20:00:00Z")!.toISOString()).toBe(
      "2026-08-24T20:00:00.000Z",
    );
  });

  it("still falls back to WIB when no zone is stated", () => {
    expect(parseMegatixTime("2026-08-24 20:00:00")!.toISOString()).toBe(
      "2026-08-24T13:00:00.000Z",
    );
  });
});

// The LIVE payload, pinned from a real response on 2026-08-17 (buyer details
// replaced). It differs from the published sample in ways that matter: one
// `name` field instead of first/last, and refund columns the docs never show.
const LIVE_ORDER = {
  data: [
    {
      name: "Buyer Example",
      email: "buyer@example.com",
      phone: "0812000000",
      amount: 822750,
      discount: null,
      quantity: 2,
      event_name: "RAW VISION COLLECTIVE X LE CIRQUE PRESENT : MOODYMANN",
      completed_at: "2026-08-15T14:29:49+0700",
      order_number: "1533350455",
      start_datetime: "2026-08-24T20:00:00+0700",
      upsales_amount: null,
      discount_amount: null,
      extras_quantity: 0,
      refunded_amount: 0,
      ticket_subtotal: 750000,
      transaction_fee: 8311,
      upsales_booking_fee: null,
      refunded_extras_amount: 0,
      refunded_ticket_amount: 0,
    },
  ],
  event: { currency_code: "IDR" },
};

describe("megatix orders — live payload", () => {
  it("reads the single `name` field the docs do not mention", () => {
    const [order] = extractOrders(LIVE_ORDER);
    expect(order.buyerName).toBe("Buyer Example");
    expect(order.buyerPhone).toBe("0812000000");
  });

  it("carries refunds through instead of dropping them", () => {
    const [order] = extractOrders(LIVE_ORDER);
    expect(order.refundedAmount).toBe("0");
  });

  it("reads the offset-bearing purchase time", () => {
    const [order] = extractOrders(LIVE_ORDER);
    expect(order.completedAt!.toISOString()).toBe("2026-08-15T07:29:49.000Z");
  });

  it("still totals this order correctly", () => {
    expect(summariseOrders(extractOrders(LIVE_ORDER))).toEqual({
      tickets: 2,
      revenue: 822750,
      fees: 8311,
    });
  });
});
