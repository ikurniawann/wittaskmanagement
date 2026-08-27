import {
  bigint,
  integer,
  pgTable,
  pgEnum,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { divisions, profiles } from "./org";

// Events (T-020): one concert = one workspace. The lifecycle workflow is
// PER-EVENT data (Owner request 2026-08-06): each event owns an ordered list
// of phases (add/rename/delete/reorder) and a pointer to the current one.

export const eventHealthEnum = pgEnum("event_health", [
  "on_track",
  "at_risk",
  "critical",
]);

export const events = pgTable("events", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  // display list, e.g. "YE · Special Guest" — structured lineup later if needed
  artists: text("artists").notNull().default(""),
  venue: text("venue").notNull().default(""),
  showDate: timestamp("show_date", { withTimezone: true }).notNull(),
  capacity: integer("capacity"),
  currentPhaseId: uuid("current_phase_id").references(
    (): AnyPgColumn => eventPhases.id,
    { onDelete: "set null" },
  ),
  health: eventHealthEnum("health").notNull().default("on_track"),
  // identity swatch in the sidebar and the grid (Owner 2026-08-12); null
  // means "use the colour derived from the id", so no event is ever grey
  color: text("color"),
  // stored relative to UPLOADS_DIR, served auth-gated via /api/files
  coverImagePath: text("cover_image_path"),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  // Dataroom storage cap for this event (EPIC-017). null = use the global
  // default in app_settings. Lowering it never deletes anything: it only
  // refuses new uploads until usage falls back under.
  dataroomQuotaBytes: bigint("dataroom_quota_bytes", { mode: "number" }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// per-event workflow phases, ordered by sortOrder
export const eventPhases = pgTable(
  "event_phases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [
    uniqueIndex("event_phases_event_name_idx").on(t.eventId, t.name),
    // structurally prevents the sort_order-collision class of bug (Owner
    // report 2026-08-07) — see migration 0023 for the historical cleanup
    uniqueIndex("event_phases_event_sort_idx").on(t.eventId, t.sortOrder),
  ],
);

// Divisions active on an event (defaults to all 11 at creation).
export const eventDivisions = pgTable(
  "event_divisions",
  {
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    divisionId: text("division_id")
      .notNull()
      .references(() => divisions.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.eventId, table.divisionId] })],
);

// Event-level crew (Owner 2026-08-13): a PIC and members assigned to the
// EVENT itself, not to tasks — picked while creating the event, editable
// after. Being on this list is also a visibility grant: an event member
// sees the event even before any task is handed to them.
export const eventPeople = pgTable(
  "event_people",
  {
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    /** "pic" (one per event by convention, not constraint) or "member" */
    role: text("role").notNull().default("member"),
  },
  (table) => [primaryKey({ columns: [table.eventId, table.userId] })],
);

/**
 * Ticketing channels an event sells through (Owner 2026-08-17: "ada 2
 * channel — tessera dan megatix"). A row per channel, so one show can be
 * live on BOTH platforms at once and each channel keeps its own event id.
 *
 * This replaced a single events.tessera_event_id column: that shape could
 * only ever express one platform, and a promoter running the same show on
 * two ticketing sites would have had to pick which half of their sales the
 * system was allowed to see.
 */
export const eventTicketChannels = pgTable(
  "event_ticket_channels",
  {
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    /** "tessera" | "megatix" */
    provider: text("provider").notNull(),
    /** the provider's own event id — text; theirs are numeric or uuid */
    providerEventId: text("provider_event_id").notNull(),
    /** Megatix scopes events under a presenter; null for Tessera */
    providerAccountId: text("provider_account_id"),
    // Each channel's OWN latest daily numbers. Kept per channel because the
    // shared ticket_sales_snapshots row is keyed (event, day): with two
    // channels live on one show, each sync would otherwise overwrite the
    // other's figures and the headline would show whichever ran last
    // instead of the sum.
    lastDay: text("last_day"),
    lastTickets: integer("last_tickets"),
    lastRevenue: bigint("last_revenue", { mode: "number" }),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    connectedAt: timestamp("connected_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.eventId, t.provider] })],
);
