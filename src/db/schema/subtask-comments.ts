import {
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { profiles } from "./org";
import { summaryShareLinks } from "./summary-shares";
import { taskChecklistItems, tasks } from "./tasks";

// Conversation on a sub-task, between the team and whoever holds a progress
// link (Owner 2026-08-27).
//
// Two kinds of author share one thread, so the columns carry both shapes
// rather than pretending a guest is a user: an internal author has
// authorId, a guest has guestEmail plus the link they arrived through. A row
// always has exactly one of the two — enforced in the service, since a guest
// who later gets an account should not have their old messages reattributed.

export const subtaskComments = pgTable(
  "subtask_comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    checklistItemId: uuid("checklist_item_id")
      .notNull()
      .references(() => taskChecklistItems.id, { onDelete: "cascade" }),
    /** denormalised so a thread can be scoped without joining the checklist */
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    /** set when a signed-in colleague wrote it */
    authorId: uuid("author_id").references(() => profiles.id, {
      onDelete: "set null",
    }),
    /** the name shown; kept as text so a deleted account keeps its history */
    authorName: text("author_name").notNull(),
    /** set when someone outside wrote it */
    guestEmail: text("guest_email"),
    /** which link they came through — revoking it does not erase the thread */
    shareLinkId: uuid("share_link_id").references(() => summaryShareLinks.id, {
      onDelete: "set null",
    }),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("subtask_comments_item_idx").on(t.checklistItemId),
    index("subtask_comments_task_idx").on(t.taskId),
  ],
);

/**
 * How far each reader has got, so a bubble can show what is new.
 *
 * `readerKey` is a synthetic identity rather than a foreign key, because the
 * two kinds of reader have nothing in common to point at: a colleague is
 * "profile:<uuid>", a guest is "guest:<linkId>:<email or anon>". Keeping it
 * as one text column means one table answers "what is unread for whoever is
 * looking" without a union.
 */
export const subtaskCommentReads = pgTable(
  "subtask_comment_reads",
  {
    checklistItemId: uuid("checklist_item_id")
      .notNull()
      .references(() => taskChecklistItems.id, { onDelete: "cascade" }),
    readerKey: text("reader_key").notNull(),
    lastReadAt: timestamp("last_read_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.checklistItemId, t.readerKey] })],
);
