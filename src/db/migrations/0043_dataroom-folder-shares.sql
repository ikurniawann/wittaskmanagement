ALTER TABLE "dataroom_access_log" ALTER COLUMN "file_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "dataroom_share_links" ALTER COLUMN "file_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "dataroom_share_links" ADD COLUMN "folder_id" uuid;--> statement-breakpoint
ALTER TABLE "dataroom_share_links" ADD CONSTRAINT "dataroom_share_links_folder_id_dataroom_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."dataroom_folders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dataroom_share_links_folder_idx" ON "dataroom_share_links" USING btree ("folder_id");--> statement-breakpoint
ALTER TABLE "dataroom_share_links" ADD CONSTRAINT "dataroom_share_links_one_target" CHECK ((("file_id" IS NOT NULL)::int + ("folder_id" IS NOT NULL)::int) = 1);