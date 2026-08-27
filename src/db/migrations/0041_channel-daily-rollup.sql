ALTER TABLE "event_ticket_channels" ADD COLUMN "last_day" text;--> statement-breakpoint
ALTER TABLE "event_ticket_channels" ADD COLUMN "last_tickets" integer;--> statement-breakpoint
ALTER TABLE "event_ticket_channels" ADD COLUMN "last_revenue" bigint;--> statement-breakpoint
ALTER TABLE "event_ticket_channels" ADD COLUMN "last_synced_at" timestamp with time zone;