import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { divisionMembers, divisions, profiles, tasks } from "@/db/schema";
import { logActivity } from "@/lib/activity";
import { hashPassword } from "@/lib/auth/password";
import { assertCan, type Actor, type DivisionRole } from "@/lib/permissions";
import { normalizeMsisdn } from "@/lib/whatsapp/normalize";

// Org administration service (T-013). Every function takes the acting user
// and enforces capability + audit logging here — UI layers never touch the
// tables directly.

export async function listDivisions() {
  return db.select().from(divisions).orderBy(asc(divisions.sortOrder));
}

export async function listUsersWithMemberships() {
  const users = await db
    .select()
    .from(profiles)
    .orderBy(asc(profiles.createdAt));
  const memberships = await db.select().from(divisionMembers);
  const byUser = new Map<string, typeof memberships>();
  for (const m of memberships) {
    const list = byUser.get(m.userId) ?? [];
    list.push(m);
    byUser.set(m.userId, list);
  }
  return users.map((u) => ({
    ...u,
    memberships: byUser.get(u.id) ?? [],
  }));
}

// ---- division master data (Owner 2026-08-12) ------------------------------

/** Stable slug from a display name: "Media & Press" → "media-press". */
export function divisionSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, " ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export async function createDivision(actor: Actor, name: string) {
  assertCan(actor, "org.manage");
  const clean = name.trim();
  if (clean.length < 2) throw new Error("A division needs a name.");
  const id = divisionSlug(clean);
  if (!id) throw new Error("That name has no usable characters.");
  const [existing] = await db
    .select({ id: divisions.id })
    .from(divisions)
    .where(eq(divisions.id, id))
    .limit(1);
  if (existing) throw new Error(`A division with the slug “${id}” already exists.`);

  await db.insert(divisions).values({ id, name: clean });
  await logActivity({
    actorId: actor.id,
    action: "division.create",
    entity: `division:${id}`,
    detail: { name: clean },
  });
  return { id };
}

/** Display name only. The slug is an identifier woven through tasks, folders
 *  and permissions — renaming it would be a data migration, not an edit. */
export async function renameDivision(actor: Actor, id: string, name: string) {
  assertCan(actor, "org.manage");
  const clean = name.trim();
  if (clean.length < 2) throw new Error("A division needs a name.");
  await db.update(divisions).set({ name: clean }).where(eq(divisions.id, id));
  await logActivity({
    actorId: actor.id,
    action: "division.rename",
    entity: `division:${id}`,
    detail: { name: clean },
  });
}

/**
 * Refuses while anything still points at the division, with the numbers —
 * the database would refuse anyway via FK, but "23503 foreign key violation"
 * tells an admin nothing they can act on.
 */
export async function deleteDivision(actor: Actor, id: string) {
  assertCan(actor, "org.manage");
  const [{ taskCount }] = await db
    .select({ taskCount: sql<number>`count(*)::int` })
    .from(tasks)
    .where(eq(tasks.divisionId, id));
  const [{ memberCount }] = await db
    .select({ memberCount: sql<number>`count(*)::int` })
    .from(divisionMembers)
    .where(eq(divisionMembers.divisionId, id));
  const blockers = [
    taskCount > 0 ? `${taskCount} task(s)` : null,
    memberCount > 0 ? `${memberCount} member(s)` : null,
  ].filter(Boolean);
  if (blockers.length > 0) {
    throw new Error(
      `“${id}” still has ${blockers.join(" and ")}. Move or remove them first.`,
    );
  }
  try {
    await db.delete(divisions).where(eq(divisions.id, id));
  } catch {
    // budgets, documents, templates or handoffs still reference it — rarer,
    // so counted lazily rather than on every delete attempt
    throw new Error(
      `“${id}” is still referenced by budgets, documents or history and cannot be deleted.`,
    );
  }
  await logActivity({
    actorId: actor.id,
    action: "division.delete",
    entity: `division:${id}`,
  });
}

export async function createUser(
  actor: Actor,
  input: {
    email: string;
    name: string;
    role: "owner" | "admin" | "member" | "external";
    password?: string;
    /** raw as typed; normalised to an msisdn before it is stored */
    phone?: string;
  },
) {
  assertCan(actor, "org.manage");
  const email = input.email.toLowerCase().trim();
  const phone = input.phone?.trim() ? normalizeMsisdn(input.phone) : null;
  if (input.phone?.trim() && !phone) {
    throw new Error("That phone number doesn't look valid.");
  }
  const [user] = await db
    .insert(profiles)
    .values({
      email,
      name: input.name.trim(),
      role: input.role,
      phone,
      // a number is only worth storing if it will be used — setting one in
      // Admin turns the channel on, otherwise nothing would ever send
      whatsappNotifications: Boolean(phone),
      passwordHash:
        input.role !== "external" && input.password
          ? hashPassword(input.password)
          : null,
    })
    .returning();
  await logActivity({
    actorId: actor.id,
    action: "user.create",
    entity: `profile:${user.id}`,
    detail: { email, role: input.role },
  });
  return user;
}

/**
 * Admin password reset (Owner 2026-08-27). Until this existed a password could
 * only be set when the account was created, so a person who forgot theirs had
 * no way back in — there is no reset-by-email flow in this app.
 *
 * Unlike the self-service change in settings/actions.ts this does NOT ask for
 * the current password: the whole point is that nobody knows it. That makes it
 * a takeover primitive, so it is fenced twice — `org.manage`, and an admin may
 * not reset an OWNER's password. Without that second rule any admin could
 * seize the owner account, which is a privilege escalation wearing a support
 * task's clothes. Only an owner may reset another owner.
 *
 * The new password is never logged: the audit entry records who reset whose
 * account, never the secret.
 */
export async function resetUserPassword(
  actor: Actor,
  userId: string,
  password: string,
) {
  assertCan(actor, "org.manage");
  if (password.length < 8) {
    throw new Error("The new password needs at least 8 characters.");
  }

  const [target] = await db
    .select({ id: profiles.id, email: profiles.email, role: profiles.role })
    .from(profiles)
    .where(eq(profiles.id, userId))
    .limit(1);
  if (!target) throw new Error("That user no longer exists.");

  if (target.role === "external") {
    throw new Error("External guests sign in by magic link — they have no password.");
  }
  if (target.role === "owner" && actor.role !== "owner") {
    throw new Error("Only an owner can reset an owner's password.");
  }

  await db
    .update(profiles)
    .set({ passwordHash: hashPassword(password), updatedAt: new Date() })
    .where(eq(profiles.id, userId));

  await logActivity({
    actorId: actor.id,
    action: "user.password_reset",
    entity: `profile:${userId}`,
    detail: { email: target.email },
  });
}

/**
 * Admin-side contact details (EPIC-016 follow-up). Until this existed a
 * number could only be set by each person in their own Settings, so the
 * WhatsApp gateway had no recipients at all.
 *
 * Clearing the number also switches the channel off: keeping the flag on
 * with nowhere to send is a silent no-op that looks like it works.
 */
export async function setUserContact(
  actor: Actor,
  userId: string,
  input: { phone: string; whatsappNotifications: boolean },
) {
  assertCan(actor, "org.manage");
  const raw = input.phone.trim();
  const phone = raw ? normalizeMsisdn(raw) : null;
  if (raw && !phone) {
    throw new Error(
      "That phone number doesn't look valid. Use 08…, 62… or +62… .",
    );
  }
  await db
    .update(profiles)
    .set({
      phone,
      whatsappNotifications: phone ? input.whatsappNotifications : false,
      updatedAt: new Date(),
    })
    .where(eq(profiles.id, userId));
  await logActivity({
    actorId: actor.id,
    action: "user.contact_update",
    entity: `profile:${userId}`,
    // the number itself stays out of the audit detail
    detail: { hasPhone: Boolean(phone), whatsapp: Boolean(phone) && input.whatsappNotifications },
  });
}

/**
 * Edit a user's name, email and role (Owner 2026-08-27). Until this existed a
 * role was fixed at creation, so promoting someone meant deleting and
 * recreating their account — losing their history with it.
 *
 * Two guards beyond org.manage, both about the same danger — an admin quietly
 * becoming, or unmaking, an owner:
 *
 *   1. Only an owner may grant or remove the `owner` role. An admin promoting
 *      themselves would be a one-click takeover.
 *   2. The last owner cannot be demoted. An organisation with no owner has
 *      nobody who can appoint one, which is a locked door with the key inside.
 */
export async function updateUser(
  actor: Actor,
  userId: string,
  input: { name: string; email: string; role: "owner" | "admin" | "member" | "external" },
) {
  assertCan(actor, "org.manage");

  const [target] = await db
    .select()
    .from(profiles)
    .where(eq(profiles.id, userId))
    .limit(1);
  if (!target) throw new Error("That user no longer exists.");

  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  if (name.length < 2) throw new Error("A name is required.");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new Error("That email address does not look valid.");
  }

  if (email !== target.email) {
    const [clash] = await db
      .select({ id: profiles.id })
      .from(profiles)
      .where(eq(profiles.email, email))
      .limit(1);
    if (clash && clash.id !== userId) {
      throw new Error("Another account already uses that email.");
    }
  }

  const roleChanged = input.role !== target.role;
  if (roleChanged) {
    if ((input.role === "owner" || target.role === "owner") && actor.role !== "owner") {
      throw new Error("Only an owner can grant or remove the owner role.");
    }
    if (target.role === "owner" && input.role !== "owner") {
      const [{ count }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(profiles)
        .where(and(eq(profiles.role, "owner"), eq(profiles.isActive, true)));
      if (count <= 1) {
        throw new Error("This is the last owner — appoint another one first.");
      }
    }
    if (input.role === "external" && target.passwordHash) {
      // an external signs in by magic link; leaving a usable password behind
      // would be a second, unadvertised way in
      await db.update(profiles).set({ passwordHash: null }).where(eq(profiles.id, userId));
    }
  }

  await db
    .update(profiles)
    .set({ name, email, role: input.role, updatedAt: new Date() })
    .where(eq(profiles.id, userId));

  await logActivity({
    actorId: actor.id,
    action: "user.update",
    entity: `profile:${userId}`,
    detail: {
      email,
      ...(roleChanged ? { roleFrom: target.role, roleTo: input.role } : {}),
    },
  });
}

export async function setUserActive(
  actor: Actor,
  userId: string,
  isActive: boolean,
) {
  assertCan(actor, "org.manage");
  await db
    .update(profiles)
    .set({ isActive, updatedAt: new Date() })
    .where(eq(profiles.id, userId));
  await logActivity({
    actorId: actor.id,
    action: isActive ? "user.activate" : "user.deactivate",
    entity: `profile:${userId}`,
  });
}

export async function assignMembership(
  actor: Actor,
  userId: string,
  divisionId: string,
  role: DivisionRole,
) {
  assertCan(actor, "org.manage");
  await db
    .insert(divisionMembers)
    .values({ userId, divisionId, role })
    .onConflictDoUpdate({
      target: [divisionMembers.divisionId, divisionMembers.userId],
      set: { role },
    });
  await logActivity({
    actorId: actor.id,
    action: "membership.assign",
    entity: `profile:${userId}`,
    detail: { divisionId, role },
  });
}

export async function removeMembership(
  actor: Actor,
  userId: string,
  divisionId: string,
) {
  assertCan(actor, "org.manage");
  await db
    .delete(divisionMembers)
    .where(
      and(
        eq(divisionMembers.userId, userId),
        eq(divisionMembers.divisionId, divisionId),
      ),
    );
  await logActivity({
    actorId: actor.id,
    action: "membership.remove",
    entity: `profile:${userId}`,
    detail: { divisionId },
  });
}
