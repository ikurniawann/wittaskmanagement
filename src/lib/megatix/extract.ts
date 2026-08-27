// Readers for the Megatix Data API (v2024.10.14), Owner 2026-08-17.
//
// Unlike Tessera, Megatix publishes a documented shape, so these readers are
// strict about field NAMES and tolerant only about presence: a documented
// field that stops arriving yields null, never a zero. Money is kept as
// validated strings — Megatix reports fees like 3.65, and a float that has
// been through JSON arithmetic is not a number anyone should settle against.
//
// Every reader also returns `raw`, so the caller can store the row exactly
// as it arrived; a field we do not read today is not lost before we learn
// to read it.

export interface MegatixPresenter {
  id: string;
  name: string;
  countryCode: string | null;
}

export interface MegatixEventRow {
  id: string;
  name: string;
  startAt: string | null;
  currency: string | null;
}

export interface MegatixOrder {
  /** order_number — the upsert key */
  orderNumber: string;
  buyerName: string | null;
  buyerEmail: string | null;
  buyerPhone: string | null;
  quantity: number;
  /** local wall-clock string exactly as sent, e.g. "2024-07-01 11:36:54" */
  completedAtRaw: string | null;
  completedAt: Date | null;
  currency: string | null;
  /** money as validated numeric strings, or null when absent */
  ticketSubtotal: string | null;
  amount: string | null;
  transactionFee: string | null;
  discountAmount: string | null;
  deliveryFee: string | null;
  refundedAmount: string | null;
  raw: Record<string, unknown>;
}

function str(value: unknown): string | null {
  if (typeof value === "string" && value.trim() !== "") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

/** Money kept as a string; only shapes that are unambiguously numeric pass. */
function moneyStr(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string") {
    const clean = value.trim();
    if (clean !== "" && !Number.isNaN(Number(clean))) return clean;
  }
  return null;
}

/**
 * Megatix sends timestamps in two shapes, confirmed against the live API on
 * 2026-08-17: the documentation's zone-less "YYYY-MM-DD HH:MM:SS", and the
 * real responses' "2026-08-24T20:00:00+0700" WITH an offset.
 *
 * An explicit offset is always honoured — inventing WIB over a stated zone
 * would corrupt any event outside Jakarta. Only when no zone is given does
 * this fall back to WIB, because the value is then the presenter's local
 * wall clock and reading it as UTC would file Jakarta orders seven hours
 * early, some onto the wrong sales day. The untouched string is kept in
 * `completedAtRaw` (and in `raw`) so the assumption stays auditable.
 */
export function parseMegatixTime(value: unknown): Date | null {
  const text = str(value);
  if (!text) return null;
  const match =
    /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)\s*(Z|[+-]\d{2}:?\d{2})?/.exec(text);
  if (!match) return null;
  const [, day, clock, zone] = match;
  const time = clock.length === 5 ? `${clock}:00` : clock;
  // normalise "+0700" to "+07:00"; absent zone means the presenter's WIB
  const offset = !zone
    ? "+07:00"
    : zone === "Z"
      ? "Z"
      : zone.includes(":")
        ? zone
        : `${zone.slice(0, 3)}:${zone.slice(3)}`;
  const date = new Date(`${day}T${time}${offset}`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** `{ data: [...] }` is Megatix's envelope on every list endpoint. */
export function unwrapList(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === "object") {
    const box = payload as Record<string, unknown>;
    if (Array.isArray(box.data)) return box.data as unknown[];
  }
  return [];
}

export function extractPresenters(payload: unknown): MegatixPresenter[] {
  return unwrapList(payload).flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const row = raw as Record<string, unknown>;
    const id = str(row.id);
    const name = str(row.name);
    if (!id || !name) return [];
    return [{ id, name, countryCode: str(row.country_code) }];
  });
}

export function extractEvents(payload: unknown): MegatixEventRow[] {
  return unwrapList(payload).flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const row = raw as Record<string, unknown>;
    const id = str(row.id);
    const name = str(row.name);
    if (!id || !name) return [];
    return [
      {
        id,
        name,
        startAt: str(row.start_datetime),
        currency: str(row.currency_code),
      },
    ];
  });
}

/** The currency lives on the report's `event` header, not on each order. */
export function extractOrdersCurrency(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const event = (payload as Record<string, unknown>).event;
  if (!event || typeof event !== "object") return null;
  return str((event as Record<string, unknown>).currency_code);
}

/**
 * Orders from /reports/orders. A row without an order_number is dropped: it
 * has no identity, so re-syncing it would either duplicate it forever or
 * overwrite an unrelated row.
 */
export function extractOrders(payload: unknown): MegatixOrder[] {
  const currency = extractOrdersCurrency(payload);
  return unwrapList(payload).flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const row = raw as Record<string, unknown>;
    const orderNumber = str(row.order_number);
    if (!orderNumber) return [];

    // The live API sends a single `name`; the documented sample splits it
    // into first_name/last_name. Read both — trusting the docs alone left
    // every buyer nameless (found against real data 2026-08-17).
    const name =
      str(row.name) ??
      ([str(row.first_name), str(row.last_name)].filter(Boolean).join(" ") || null);
    const quantityRaw = row.quantity;
    const quantity =
      typeof quantityRaw === "number" && Number.isFinite(quantityRaw) && quantityRaw > 0
        ? Math.trunc(quantityRaw)
        : 1;

    return [
      {
        orderNumber,
        buyerName: name,
        buyerEmail: str(row.email),
        buyerPhone: str(row.phone),
        quantity,
        completedAtRaw: str(row.completed_at),
        completedAt: parseMegatixTime(row.completed_at),
        currency,
        ticketSubtotal: moneyStr(row.ticket_subtotal),
        amount: moneyStr(row.amount),
        transactionFee: moneyStr(row.transaction_fee),
        discountAmount: moneyStr(row.discount_amount),
        deliveryFee: moneyStr(row.delivery_fee),
        // live-only field: a refunded order still occupies a row, and its
        // money must not read as revenue
        refundedAmount: moneyStr(row.refunded_amount),
        raw: row,
      },
    ];
  });
}

/**
 * Channel totals computed from the orders themselves.
 *
 * Tickets are the SUM of quantity, not the row count — a Megatix order can
 * carry several tickets, so counting rows would undercount the show.
 */
export function summariseOrders(orders: MegatixOrder[]): {
  tickets: number;
  revenue: number;
  fees: number;
} {
  let tickets = 0;
  let revenue = 0;
  let fees = 0;
  for (const order of orders) {
    tickets += order.quantity;
    revenue += order.amount ? Number(order.amount) : 0;
    fees += order.transactionFee ? Number(order.transactionFee) : 0;
  }
  return {
    tickets,
    // rounded at the boundary only: the per-row strings stay exact in the DB
    revenue: Math.round(revenue * 100) / 100,
    fees: Math.round(fees * 100) / 100,
  };
}
