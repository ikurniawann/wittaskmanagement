import { createHash, randomBytes } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  divisionMembers,
  divisions,
  events,
  externalInvites,
  formSubmissions,
  profiles,
  taskAssignees,
  tasks,
} from "@/db/schema";
import { logActivity } from "@/lib/activity";
import { sendEmail } from "@/lib/email";
import { env } from "@/lib/env";
import { notify, notifyMany } from "@/lib/notifications";
import { assertCan, can, PermissionError, type Actor } from "@/lib/permissions";
import { FORM_TYPES, validateSubmission, type FormType } from "./forms";

// External collaborator service (T-071..T-074). Scope, expiry, and
// revocation are re-checked on EVERY guest request — never trusted from the
// session token.

const INVITE_LIFETIME_AFTER_SHOW_DAYS = 21; // ≈ settlement + 7d (PLAN §5)
const MIN_LIFETIME_DAYS = 14;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// ---- invites --------------------------------------------------------------

export async function createInvite(
  actor: Actor,
  input: {
    email: string;
    name: string;
    eventId: string;
    divisionId: string;
    requestedForms: FormType[];
  },
) {
  assertCan(actor, "external.invite", { divisionId: input.divisionId });

  const email = input.email.toLowerCase().trim();
  const [existing] = await db
    .select()
    .from(profiles)
    .where(eq(profiles.email, email))
    .limit(1);
  if (existing && existing.role !== "external") {
    throw new Error("That email belongs to an internal user.");
  }
  const profile =
    existing ??
    (
      await db
        .insert(profiles)
        .values({ email, name: input.name.trim(), role: "external" })
        .returning()
    )[0];

  const [event] = await db
    .select()
    .from(events)
    .where(eq(events.id, input.eventId))
    .limit(1);
  if (!event) throw new Error("Project not found.");

  const now = Date.now();
  const expiresAt = new Date(
    Math.max(
      event.showDate.getTime() + INVITE_LIFETIME_AFTER_SHOW_DAYS * 86_400_000,
      now + MIN_LIFETIME_DAYS * 86_400_000,
    ),
  );

  const token = randomBytes(32).toString("hex");
  const values = {
    profileId: profile.id,
    eventId: input.eventId,
    divisionId: input.divisionId,
    requestedForms: input.requestedForms.filter((f) => FORM_TYPES.includes(f)),
    tokenHash: hashToken(token),
    expiresAt,
    revokedAt: null,
    lastSentAt: new Date(),
    invitedBy: actor.id,
  };
  const [invite] = await db
    .insert(externalInvites)
    .values(values)
    .onConflictDoUpdate({
      target: [externalInvites.profileId, externalInvites.eventId],
      set: values,
    })
    .returning();

  const magicLink = `${env.APP_URL}/guest/login?token=${token}`;
  const { getBranding, fullName } = await import("@/lib/org/branding");
  const brand = fullName(await getBranding());
  await sendEmail({
    to: email,
    subject: `[${brand}] You're invited to collaborate on ${event.name}`,
    text: `Hi ${profile.name},\n\nYou've been invited to collaborate on "${event.name}" with the ${input.divisionId} division.\n\nOpen your portal (no password needed):\n${magicLink}\n\nThis link is personal — please don't share it. It expires on ${expiresAt.toDateString()}.\n\n— ${brand}`,
  });

  await logActivity({
    actorId: actor.id,
    action: "external.invite",
    entity: `profile:${profile.id}`,
    detail: { eventId: input.eventId, divisionId: input.divisionId, forms: values.requestedForms },
    eventId: input.eventId,
  });
  return { invite, magicLink };
}

export async function revokeInvite(actor: Actor, inviteId: string) {
  const [invite] = await db
    .select()
    .from(externalInvites)
    .where(eq(externalInvites.id, inviteId))
    .limit(1);
  if (!invite) return;
  assertCan(actor, "external.invite", { divisionId: invite.divisionId });
  await db
    .update(externalInvites)
    .set({ revokedAt: new Date() })
    .where(eq(externalInvites.id, inviteId));
  await logActivity({
    actorId: actor.id,
    action: "external.revoke",
    entity: `profile:${invite.profileId}`,
    eventId: invite.eventId,
  });
}

export async function listInvites(actor: Actor, eventId: string) {
  const rows = await db
    .select({
      invite: externalInvites,
      guestName: profiles.name,
      guestEmail: profiles.email,
    })
    .from(externalInvites)
    .innerJoin(profiles, eq(externalInvites.profileId, profiles.id))
    .where(eq(externalInvites.eventId, eventId))
    .orderBy(desc(externalInvites.createdAt));
  return rows.filter((r) =>
    can(actor, "external.invite", { divisionId: r.invite.divisionId }),
  );
}

// ---- guest context (checked every request) --------------------------------

export async function redeemToken(token: unknown) {
  if (typeof token !== "string" || token.length < 32) return null;
  const [row] = await db
    .select({
      invite: externalInvites,
      profile: profiles,
    })
    .from(externalInvites)
    .innerJoin(profiles, eq(externalInvites.profileId, profiles.id))
    .where(eq(externalInvites.tokenHash, hashToken(token)))
    .limit(1);
  if (!row) return null;
  const { invite, profile } = row;
  if (invite.revokedAt || invite.expiresAt < new Date()) return null;
  if (!profile.isActive || profile.role !== "external") return null;
  return { id: profile.id, email: profile.email, name: profile.name, role: "external" as const };
}

export async function getGuestContext(profileId: string) {
  const rows = await db
    .select({
      invite: externalInvites,
      eventName: events.name,
      showDate: events.showDate,
      divisionName: divisions.name,
    })
    .from(externalInvites)
    .innerJoin(events, eq(externalInvites.eventId, events.id))
    .innerJoin(divisions, eq(externalInvites.divisionId, divisions.id))
    .where(
      and(
        eq(externalInvites.profileId, profileId),
        isNull(externalInvites.revokedAt),
      ),
    )
    .orderBy(desc(externalInvites.createdAt));
  const active = rows.find((r) => r.invite.expiresAt >= new Date());
  return active ?? null;
}

export async function listGuestTasks(profileId: string, eventId: string) {
  return db
    .select({ task: tasks })
    .from(taskAssignees)
    .innerJoin(tasks, eq(taskAssignees.taskId, tasks.id))
    .where(and(eq(taskAssignees.userId, profileId), eq(tasks.eventId, eventId)))
    .orderBy(asc(tasks.dueDate))
    .then((rows) => rows.map((r) => r.task));
}

// ---- form submissions -----------------------------------------------------

export async function saveSubmission(
  guestProfileId: string,
  input: { type: FormType; data: Record<string, unknown>; submit: boolean },
) {
  const context = await getGuestContext(guestProfileId);
  if (!context) throw new PermissionError("form.submit");
  const requested = context.invite.requestedForms as FormType[];
  if (!requested.includes(input.type)) {
    throw new Error("This form was not requested from you.");
  }

  if (input.submit) {
    const problems = validateSubmission(input.type, input.data);
    if (problems.length > 0) throw new Error(problems.join(" "));
  }

  const [existing] = await db
    .select()
    .from(formSubmissions)
    .where(
      and(
        eq(formSubmissions.inviteId, context.invite.id),
        eq(formSubmissions.type, input.type),
      ),
    )
    .limit(1);

  if (existing && ["submitted", "accepted"].includes(existing.status)) {
    throw new Error("This form is already submitted.");
  }

  const status = input.submit ? ("submitted" as const) : ("draft" as const);
  const base = {
    data: input.data,
    status,
    submittedAt: input.submit ? new Date() : null,
    updatedAt: new Date(),
  };
  const [submission] = existing
    ? await db
        .update(formSubmissions)
        .set(base)
        .where(eq(formSubmissions.id, existing.id))
        .returning()
    : await db
        .insert(formSubmissions)
        .values({
          ...base,
          inviteId: context.invite.id,
          profileId: guestProfileId,
          eventId: context.invite.eventId,
          divisionId: context.invite.divisionId,
          type: input.type,
        })
        .returning();

  if (input.submit) {
    const heads = await db
      .select({ userId: divisionMembers.userId })
      .from(divisionMembers)
      .where(
        and(
          eq(divisionMembers.divisionId, context.invite.divisionId),
          eq(divisionMembers.role, "head"),
        ),
      );
    await notifyMany(
      heads.map((h) => h.userId),
      {
        type: "submission_received",
        title: `External submission: ${input.type.replaceAll("_", " ")} (${context.eventName})`,
        href: `/events/${context.invite.eventId}/guests`,
      },
    );
    await logActivity({
      actorId: guestProfileId,
      action: "form.submit",
      entity: `submission:${submission.id}`,
      detail: { type: input.type },
      eventId: context.invite.eventId,
    });
  }
  return submission;
}

export async function listGuestSubmissions(profileId: string, inviteId: string) {
  return db
    .select()
    .from(formSubmissions)
    .where(
      and(
        eq(formSubmissions.profileId, profileId),
        eq(formSubmissions.inviteId, inviteId),
      ),
    );
}

export async function listSubmissionsForReview(actor: Actor, eventId: string) {
  const rows = await db
    .select({
      submission: formSubmissions,
      guestName: profiles.name,
      guestEmail: profiles.email,
    })
    .from(formSubmissions)
    .innerJoin(profiles, eq(formSubmissions.profileId, profiles.id))
    .where(
      and(
        eq(formSubmissions.eventId, eventId),
        inArray(formSubmissions.status, [
          "submitted",
          "accepted",
          "changes_requested",
        ]),
      ),
    )
    .orderBy(desc(formSubmissions.updatedAt));
  return rows.filter((r) =>
    can(actor, "submission.review", { divisionId: r.submission.divisionId }),
  );
}

export async function reviewSubmission(
  actor: Actor,
  submissionId: string,
  decision: "accepted" | "changes_requested",
  note: string,
) {
  const [submission] = await db
    .select()
    .from(formSubmissions)
    .where(eq(formSubmissions.id, submissionId))
    .limit(1);
  if (!submission || submission.status !== "submitted") {
    throw new Error("Submission not found or not awaiting review.");
  }
  assertCan(actor, "submission.review", { divisionId: submission.divisionId });
  if (decision === "changes_requested" && !note.trim()) {
    throw new Error("Tell the guest what to change.");
  }
  await db
    .update(formSubmissions)
    .set({
      status: decision,
      reviewNote: note.trim(),
      reviewedBy: actor.id,
      updatedAt: new Date(),
    })
    .where(eq(formSubmissions.id, submissionId));

  await notify({
    userId: submission.profileId,
    type: "submission_decided",
    title: `Your ${submission.type.replaceAll("_", " ")} was ${
      decision === "accepted" ? "accepted" : "returned for changes"
    }`,
    href: "/guest",
  });
  await logActivity({
    actorId: actor.id,
    action: `submission.${decision}`,
    entity: `submission:${submissionId}`,
    eventId: submission.eventId,
  });
}
