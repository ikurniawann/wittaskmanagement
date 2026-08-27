-- Carry the existing Tessera integration into the two-channel shape
-- (Owner 2026-08-17: "ada 2 channel — tessera dan megatix").
--
-- Data-only: 0038 created the new tables, 0040 drops the old ones. Splitting
-- it this way keeps every statement reversible in isolation and means no
-- generated DROP can ever run before the rows have been copied.

-- every event that was mapped to Tessera becomes a "tessera" channel row
INSERT INTO "event_ticket_channels" ("event_id", "provider", "provider_event_id")
SELECT "id", 'tessera', "tessera_event_id"
FROM "events"
WHERE "tessera_event_id" IS NOT NULL
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- every stored transaction keeps its id, money and raw payload untouched;
-- quantity is 1 because Tessera reports one row PER TICKET
INSERT INTO "ticket_transactions" (
  "id", "event_id", "provider", "provider_txn_id", "order_id", "buyer_email",
  "buyer_name", "category", "status", "promo_code", "currency", "purchased_at",
  "quantity", "ticket_price", "gross_sales", "total_fees", "net_sales",
  "discount_amount", "refunded_amount", "vat", "raw", "synced_at"
)
SELECT
  "id", "event_id", 'tessera', "tessera_id", "order_id", "buyer_email",
  "buyer_name", "category", "status", "promo_code", "currency", "purchased_at",
  1, "ticket_price", "gross_sales", "total_fees", "net_sales",
  "discount_amount", "refunded_amount", "vat", "raw", "synced_at"
FROM "tessera_transactions"
ON CONFLICT DO NOTHING;
