import {
  bigint,
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
import { divisions, profiles } from "./org";

// Dataroom (EPIC-017). One room per event; the bytes live on the 3.6 TB disk
// behind src/lib/dataroom/storage.ts, and this schema is only the index.
//
// Replaces the per-event `documents` module, which never held a file.

export const dataroomVisibilityEnum = pgEnum("dataroom_visibility", [
  "sealed", // only the people listed in dataroom_folder_members
  "division", // one division's members (+ owner/admin)
  "event", // anyone who can view the event
  "organisation", // every internal user
]);

export const dataroomFolders = pgTable(
  "dataroom_folders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    // null = a top-level folder in this event's room
    parentId: uuid("parent_id"),
    name: text("name").notNull(),
    visibility: dataroomVisibilityEnum("visibility").notNull().default("event"),
    // required when visibility = 'division'; access denies when it is missing
    divisionId: text("division_id").references(() => divisions.id, {
      onDelete: "restrict",
    }),
    createdBy: uuid("created_by").references(() => profiles.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("dataroom_folders_event_idx").on(t.eventId),
    index("dataroom_folders_parent_idx").on(t.parentId),
  ],
);

/** Explicit grants — only meaningful for a sealed folder. */
export const dataroomFolderMembers = pgTable(
  "dataroom_folder_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    folderId: uuid("folder_id")
      .notNull()
      .references(() => dataroomFolders.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    /** false = read only */
    canEdit: boolean("can_edit").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("dataroom_folder_members_folder_idx").on(t.folderId),
    // one grant per person; re-sharing updates the existing row
    uniqueIndex("dataroom_folder_members_folder_user_idx").on(t.folderId, t.userId),
  ],
);

export const dataroomFiles = pgTable(
  "dataroom_files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // denormalised from the folder so quota sums never need a join
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    folderId: uuid("folder_id")
      .notNull()
      .references(() => dataroomFolders.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** which version is current; every earlier one is still on disk */
    currentVersion: integer("current_version").notNull().default(1),
    // trash: the bytes stay (and keep counting against the quota) until a
    // purge job removes them after the retention window
    trashedAt: timestamp("trashed_at", { withTimezone: true }),
    trashedBy: uuid("trashed_by").references(() => profiles.id, {
      onDelete: "set null",
    }),
    createdBy: uuid("created_by").references(() => profiles.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("dataroom_files_event_idx").on(t.eventId),
    index("dataroom_files_folder_idx").on(t.folderId),
    index("dataroom_files_trashed_idx").on(t.trashedAt),
  ],
);

/** Never overwritten: a careless re-upload cannot destroy a signed contract. */
export const dataroomFileVersions = pgTable(
  "dataroom_file_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    fileId: uuid("file_id")
      .notNull()
      .references(() => dataroomFiles.id, { onDelete: "cascade" }),
    versionNo: integer("version_no").notNull(),
    // bigint: a 3.6 TB disk outgrows a 32-bit byte count
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    mimeType: text("mime_type").notNull().default("application/octet-stream"),
    uploadedBy: uuid("uploaded_by").references(() => profiles.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("dataroom_file_versions_file_idx").on(t.fileId),
    uniqueIndex("dataroom_file_versions_file_no_idx").on(t.fileId, t.versionNo),
  ],
);

/**
 * A link handed to someone with no account (EPIC-018).
 *
 * Never a public link: an expiry is required, revocation is one column, and
 * the token is stored only as a hash so a database leak yields nothing that
 * opens.
 *
 * One link opens exactly one TARGET — either a single file, or a folder the
 * recipient may browse (Owner 2026-08-27). The two columns are mutually
 * exclusive and the database enforces it: a row carrying both would be a
 * link with an ambiguous scope, which is the kind of ambiguity that ends in
 * handing out more than was meant.
 */
export const dataroomShareLinks = pgTable(
  "dataroom_share_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** set for a single-file link; null when this shares a folder */
    fileId: uuid("file_id").references(() => dataroomFiles.id, {
      onDelete: "cascade",
    }),
    /** set for a folder link; the recipient may browse it and its subfolders */
    folderId: uuid("folder_id").references(() => dataroomFolders.id, {
      onDelete: "cascade",
    }),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    /** sha256 of the token; the plaintext exists only in the URL, once */
    tokenHash: text("token_hash").notNull(),
    label: text("label"),
    /** NOT NULL on purpose — a link with no end date is the failure mode */
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    /** scrypt, via the existing hashPassword */
    passcodeHash: text("passcode_hash"),
    /** ask the visitor who they are before opening the file */
    requireEmail: boolean("require_email").notNull().default(true),
    /** when set, only these addresses may proceed */
    allowedEmails: jsonb("allowed_emails"),
    /** false = view in the browser, no download button */
    allowDownload: boolean("allow_download").notNull().default(true),
    /**
     * Stamp the recipient's identity into every page on the way out
     * (EPIC-019). Never stored watermarked — the mark is per viewer, per
     * request, so there is no cache carrying the wrong name.
     */
    watermark: boolean("watermark").notNull().default(false),
    createdBy: uuid("created_by").references(() => profiles.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("dataroom_share_links_token_idx").on(t.tokenHash),
    index("dataroom_share_links_file_idx").on(t.fileId),
    index("dataroom_share_links_folder_idx").on(t.folderId),
    index("dataroom_share_links_event_idx").on(t.eventId),
    check(
      "dataroom_share_links_one_target",
      sql`(("file_id" IS NOT NULL)::int + ("folder_id" IS NOT NULL)::int) = 1`,
    ),
  ],
);

export const dataroomActionEnum = pgEnum("dataroom_action", [
  "view",
  "download",
  "upload",
  "trash",
  "restore",
  // the share lifecycle joins the same trail (Owner 2026-08-12): who sent a
  // document out is as much a part of "who touched this" as who opened it
  "share_created",
  "share_revoked",
]);

/**
 * Who opened what, and when.
 *
 * Deliberately carries NO foreign key to the file, and denormalises its name:
 * the record of who read a contract must outlive the contract. A purge that
 * erased the audit alongside the bytes would defeat the point of the room.
 */
export const dataroomAccessLog = pgTable(
  "dataroom_access_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // null for someone outside the system; viewerEmail names them instead
    actorId: uuid("actor_id").references(() => profiles.id, {
      onDelete: "set null",
    }),
    /** the address an outside visitor gave before the file opened */
    viewerEmail: text("viewer_email"),
    /** which link let them in — kept after the link is revoked or deleted */
    shareLinkId: uuid("share_link_id"),
    /**
     * Kept as a plain column, not a reference — see above. Null for an entry
     * about a FOLDER share (Owner 2026-08-27): the trail still names the
     * folder through folderId + fileName, and inventing a file id to satisfy
     * a constraint would put a lie in the audit log.
     */
    fileId: uuid("file_id"),
    /**
     * Also denormalised, and for a different reason: the activity view has to
     * be filtered by the SAME access rules as the files themselves, or it
     * would list the names of sealed documents to everyone who can see the
     * event — defeating the folder it is meant to audit.
     */
    folderId: uuid("folder_id"),
    eventId: uuid("event_id").notNull(),
    fileName: text("file_name").notNull(),
    versionNo: integer("version_no"),
    action: dataroomActionEnum("action").notNull(),
    /** human detail — the link's label, its recipients, the gate settings */
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("dataroom_access_log_file_idx").on(t.fileId),
    index("dataroom_access_log_event_idx").on(t.eventId),
    index("dataroom_access_log_actor_idx").on(t.actorId),
  ],
);
