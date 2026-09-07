CREATE TABLE "play_badge_awards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"badge_key" text NOT NULL,
	"awarded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "play_badges" (
	"key" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"icon" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "play_profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"xp" integer DEFAULT 0 NOT NULL,
	"level" integer DEFAULT 0 NOT NULL,
	"cosmetics" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"leaderboard_opt_in" boolean DEFAULT false NOT NULL,
	"season_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "play_quests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"day" date NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"target_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"target_count" integer DEFAULT 1 NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "play_seasons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"starts_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ends_at" timestamp with time zone,
	"archive" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "play_xp_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"activity_id" uuid NOT NULL,
	"rule" text NOT NULL,
	"points" integer NOT NULL,
	"ref" text,
	"event_id" uuid,
	"division_id" text,
	"flagged" boolean DEFAULT false NOT NULL,
	"reason" text,
	"day" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "play_badge_awards" ADD CONSTRAINT "play_badge_awards_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "play_badge_awards" ADD CONSTRAINT "play_badge_awards_badge_key_play_badges_key_fk" FOREIGN KEY ("badge_key") REFERENCES "public"."play_badges"("key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "play_profiles" ADD CONSTRAINT "play_profiles_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "play_profiles" ADD CONSTRAINT "play_profiles_season_id_play_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."play_seasons"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "play_quests" ADD CONSTRAINT "play_quests_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "play_xp_ledger" ADD CONSTRAINT "play_xp_ledger_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "play_xp_ledger" ADD CONSTRAINT "play_xp_ledger_activity_id_activity_log_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activity_log"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "play_badge_awards_user_badge_idx" ON "play_badge_awards" USING btree ("user_id","badge_key");--> statement-breakpoint
CREATE UNIQUE INDEX "play_quests_user_day_kind_idx" ON "play_quests" USING btree ("user_id","day","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "play_xp_ledger_activity_rule_idx" ON "play_xp_ledger" USING btree ("activity_id","rule");--> statement-breakpoint
CREATE INDEX "play_xp_ledger_user_created_idx" ON "play_xp_ledger" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "play_xp_ledger_user_day_idx" ON "play_xp_ledger" USING btree ("user_id","day");