CREATE TYPE "public"."summary_share_kind" AS ENUM('project', 'task');--> statement-breakpoint
CREATE TABLE "summary_share_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "summary_share_kind" NOT NULL,
	"event_id" uuid NOT NULL,
	"task_id" uuid,
	"token_hash" text NOT NULL,
	"label" text,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"passcode_hash" text,
	"require_email" boolean DEFAULT true NOT NULL,
	"allowed_emails" jsonb,
	"opens" integer DEFAULT 0 NOT NULL,
	"last_viewed_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "summary_share_links_kind_target" CHECK (("kind" = 'task' AND "task_id" IS NOT NULL) OR ("kind" = 'project' AND "task_id" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "summary_share_links" ADD CONSTRAINT "summary_share_links_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "summary_share_links" ADD CONSTRAINT "summary_share_links_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "summary_share_links" ADD CONSTRAINT "summary_share_links_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "summary_share_links_token_idx" ON "summary_share_links" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "summary_share_links_event_idx" ON "summary_share_links" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "summary_share_links_task_idx" ON "summary_share_links" USING btree ("task_id");