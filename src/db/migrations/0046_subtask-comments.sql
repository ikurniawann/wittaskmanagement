CREATE TABLE "subtask_comment_reads" (
	"checklist_item_id" uuid NOT NULL,
	"reader_key" text NOT NULL,
	"last_read_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subtask_comment_reads_checklist_item_id_reader_key_pk" PRIMARY KEY("checklist_item_id","reader_key")
);
--> statement-breakpoint
CREATE TABLE "subtask_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"checklist_item_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"author_id" uuid,
	"author_name" text NOT NULL,
	"guest_email" text,
	"share_link_id" uuid,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "subtask_comment_reads" ADD CONSTRAINT "subtask_comment_reads_checklist_item_id_task_checklist_items_id_fk" FOREIGN KEY ("checklist_item_id") REFERENCES "public"."task_checklist_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subtask_comments" ADD CONSTRAINT "subtask_comments_checklist_item_id_task_checklist_items_id_fk" FOREIGN KEY ("checklist_item_id") REFERENCES "public"."task_checklist_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subtask_comments" ADD CONSTRAINT "subtask_comments_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subtask_comments" ADD CONSTRAINT "subtask_comments_author_id_profiles_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subtask_comments" ADD CONSTRAINT "subtask_comments_share_link_id_summary_share_links_id_fk" FOREIGN KEY ("share_link_id") REFERENCES "public"."summary_share_links"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "subtask_comments_item_idx" ON "subtask_comments" USING btree ("checklist_item_id");--> statement-breakpoint
CREATE INDEX "subtask_comments_task_idx" ON "subtask_comments" USING btree ("task_id");