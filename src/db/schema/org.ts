import {
  boolean,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

// Org structure (T-010). Global role lives on the profile; head/staff are
// DIVISION-scoped via division_members (a user can head one division and be
// plain staff in another). "member" = internal user whose authority comes
// entirely from division memberships. Multi-brand note (Owner 2026-08-06):
// keep only email globally unique — an `organizations` scope can be added
// later without breaking these keys.

export const globalRoleEnum = pgEnum("global_role", [
  "owner",
  "admin",
  "member",
  "external",
]);

export const divisionRoleEnum = pgEnum("division_role", ["head", "staff"]);

export const profiles = pgTable("profiles", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  // null for external guests (magic-link only, EPIC-007)
  passwordHash: text("password_hash"),
  role: globalRoleEnum("role").notNull().default("member"),
  // E.164, used by the WhatsApp channel (T-064); optional
  phone: text("phone"),
  // profile photo, relative to UPLOADS_DIR under avatars/ (Owner 2026-08-12);
  // null falls back to initials everywhere
  avatarPath: text("avatar_path"),
  // channel preferences (T-062/T-064): email defaults on, WhatsApp opt-in
  emailNotifications: boolean("email_notifications").notNull().default(true),
  whatsappNotifications: boolean("whatsapp_notifications")
    .notNull()
    .default(false),
  // digest opt-ins (T-100): daily personal digest for anyone, weekly
  // executive digest only meaningful for owner/admin (dashboard.view)
  dailyDigest: boolean("daily_digest").notNull().default(false),
  weeklyDigest: boolean("weekly_digest").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const divisions = pgTable("divisions", {
  // stable slug pk ("production", "legal-licensing") — referenced everywhere
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const divisionMembers = pgTable(
  "division_members",
  {
    divisionId: text("division_id")
      .notNull()
      .references(() => divisions.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    role: divisionRoleEnum("role").notNull().default("staff"),
  },
  (table) => [primaryKey({ columns: [table.divisionId, table.userId] })],
);

// API keys for external agents (EPIC-023, Owner 2026-08-18: OpenClaw/Hermes
// over WhatsApp). Only a SHA-256 hash of the token is stored — the plaintext
// is shown once at creation and never again. A key authenticates the AGENT;
// the human it acts for arrives per request (X-On-Behalf-Of, a phone number
// matched against profiles.phone), so every action runs under a real user's
// permissions and there is deliberately no "god token" to leak.
export const agentApiKeys = pgTable("agent_api_keys", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  /** last 4 chars of the plaintext, so the list can say which key is which */
  tokenTail: text("token_tail").notNull().default(""),
  createdBy: uuid("created_by").references(() => profiles.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});
