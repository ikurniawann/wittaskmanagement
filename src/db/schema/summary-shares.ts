import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { events } from "./events";
import { profiles } from "./org";
import { tasks } from "./tasks";

// Read-only progress links (Owner 2026-08-27).
//
// A separate table from dataroom_share_links on purpose: that one carries
// watermarking and a download switch, neither of which means anything for a
// summary page, and its columns are file/folder shaped. What the two DO share
// is the gate — expiry, passcode, email allowlist, revocation — and that
// already lives as pure functions in lib/dataroom/share-rules.ts, so the rules
// are reused rather than re-implemented.
//
// Same stance as the dataroom: never a link without an end date.

export const summaryShareKindEnum = pgEnum("summary_share_kind", ["project", "task"]);

export const summaryShareLinks = pgTable(
  "summary_share_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: summaryShareKindEnum("kind").notNull(),
    /** always set — a task link carries its project too, for scoping */
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    /** set only for kind = 'task' */
    taskId: uuid("task_id").references(() => tasks.id, { onDelete: "cascade" }),
    /** sha256 of the token; the plaintext exists only in the URL, once */
    tokenHash: text("token_hash").notNull(),
    label: text("label"),
    /** NOT NULL on purpose — a link with no end date is the failure mode */
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    /** scrypt, via the existing hashPassword */
    passcodeHash: text("passcode_hash"),
    /** ask the visitor who they are before the page opens */
    requireEmail: boolean("require_email").notNull().default(true),
    /** when set, only these addresses may proceed */
    allowedEmails: jsonb("allowed_emails"),
    /**
     * Lets the recipient upload into the task's dataroom folders (Owner
     * 2026-08-27). Default FALSE and deliberately so: every link handed out
     * before this existed stays read-only, and turning a link into one that
     * can WRITE into the room should be a decision someone made on purpose,
     * not a capability that arrived with an upgrade.
     */
    allowUpload: boolean("allow_upload").notNull().default(false),
    /** counted in place of a second log table; the audit trail gets an
     *  activity_log row per open as well */
    opens: integer("opens").notNull().default(0),
    lastViewedAt: timestamp("last_viewed_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => profiles.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("summary_share_links_token_idx").on(t.tokenHash),
    index("summary_share_links_event_idx").on(t.eventId),
    index("summary_share_links_task_idx").on(t.taskId),
    // the kind and the columns must agree: a 'task' link without a task, or a
    // 'project' link carrying one, is a link whose scope is a guess
    check(
      "summary_share_links_kind_target",
      sql`("kind" = 'task' AND "task_id" IS NOT NULL) OR ("kind" = 'project' AND "task_id" IS NULL)`,
    ),
  ],
);
