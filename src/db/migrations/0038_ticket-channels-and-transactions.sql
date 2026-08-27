CREATE TABLE "event_ticket_channels" (
	"event_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_event_id" text NOT NULL,
	"provider_account_id" text,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_ticket_channels_event_id_provider_pk" PRIMARY KEY("event_id","provider")
);
--> statement-breakpoint
CREATE TABLE "ticket_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_txn_id" text NOT NULL,
	"order_id" text,
	"buyer_email" text,
	"buyer_name" text,
	"buyer_phone" text,
	"category" text,
	"status" text,
	"promo_code" text,
	"currency" text,
	"purchased_at" timestamp with time zone,
	"quantity" integer DEFAULT 1 NOT NULL,
	"ticket_price" numeric(14, 2),
	"gross_sales" numeric(14, 2),
	"total_fees" numeric(14, 2),
	"net_sales" numeric(14, 2),
	"discount_amount" numeric(14, 2),
	"refunded_amount" numeric(14, 2),
	"vat" numeric(14, 2),
	"raw" jsonb NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "event_ticket_channels" ADD CONSTRAINT "event_ticket_channels_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_transactions" ADD CONSTRAINT "ticket_transactions_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ticket_tx_provider_event_row_idx" ON "ticket_transactions" USING btree ("provider","event_id","provider_txn_id");--> statement-breakpoint
CREATE INDEX "ticket_tx_event_idx" ON "ticket_transactions" USING btree ("event_id");