"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { profiles } from "@/db/schema";
import { rm } from "node:fs/promises";
import path from "node:path";
import { sessionActor } from "@/lib/auth/session-actor";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { env } from "@/lib/env";
import { saveImageUpload } from "@/lib/uploads";

// Self-service notification preferences (T-100). A user can only ever
// mutate their OWN row — the id comes from the session, never the form.
export async function updateMyPreferencesAction(formData: FormData) {
  const actor = await sessionActor();
  if (!actor) return;

  const phone = String(formData.get("phone") ?? "").trim();
  await db
    .update(profiles)
    .set({
      emailNotifications: formData.get("emailNotifications") === "on",
      whatsappNotifications: formData.get("whatsappNotifications") === "on",
      dailyDigest: formData.get("dailyDigest") === "on",
      weeklyDigest: formData.get("weeklyDigest") === "on",
      phone: phone || null,
      updatedAt: new Date(),
    })
    .where(eq(profiles.id, actor.id));

  revalidatePath("/settings");
}

export interface ProfileActionState {
  error?: string;
  ok?: boolean;
}

/** Display name only. Email is deliberately not editable here: it is the
 *  login identity, and changing it safely needs verification of the new
 *  address — an admin can still correct one directly if ever needed. */
export async function updateMyProfileAction(
  _prev: ProfileActionState,
  formData: FormData,
): Promise<ProfileActionState> {
  const actor = await sessionActor();
  if (!actor) return { error: "Not signed in." };
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Your name cannot be empty." };
  if (name.length > 80) return { error: "That name is too long." };

  await db
    .update(profiles)
    .set({ name, updatedAt: new Date() })
    .where(eq(profiles.id, actor.id));
  revalidatePath("/settings");
  return { ok: true };
}

/**
 * Requires the CURRENT password even though the user is signed in: an
 * unlocked laptop must not be enough to take over the account by swapping
 * its password.
 */
export async function changeMyPasswordAction(
  _prev: ProfileActionState,
  formData: FormData,
): Promise<ProfileActionState> {
  const actor = await sessionActor();
  if (!actor) return { error: "Not signed in." };

  const current = String(formData.get("current") ?? "");
  const next = String(formData.get("next") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (next.length < 8) {
    return { error: "The new password needs at least 8 characters." };
  }
  if (next !== confirm) {
    return { error: "The new passwords do not match." };
  }

  const [me] = await db
    .select({ passwordHash: profiles.passwordHash })
    .from(profiles)
    .where(eq(profiles.id, actor.id))
    .limit(1);
  if (!me?.passwordHash) {
    // external accounts sign in by magic link and have no password to change
    return { error: "This account signs in without a password." };
  }
  if (!verifyPassword(current, me.passwordHash)) {
    return { error: "The current password is not right." };
  }

  await db
    .update(profiles)
    .set({ passwordHash: hashPassword(next), updatedAt: new Date() })
    .where(eq(profiles.id, actor.id));
  return { ok: true };
}

/** Deletes an old avatar file, refusing anything outside the uploads root.
 *  The path comes from the user's own row, but a guard costs one line. */
async function removeAvatarFile(relative: string) {
  const root = path.resolve(env.UPLOADS_DIR);
  const absolute = path.resolve(root, relative);
  if (!absolute.startsWith(root + path.sep)) return;
  await rm(absolute, { force: true }).catch(() => {});
}

export async function uploadMyAvatarAction(
  _prev: ProfileActionState,
  formData: FormData,
): Promise<ProfileActionState> {
  const actor = await sessionActor();
  if (!actor) return { error: "Not signed in." };
  const file = formData.get("avatar");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose an image first." };
  }

  let stored: string;
  try {
    // jpg/png/webp, 5 MB cap — enforced inside saveImageUpload
    stored = await saveImageUpload(file, "avatars");
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Could not save the image.",
    };
  }

  const [me] = await db
    .select({ avatarPath: profiles.avatarPath })
    .from(profiles)
    .where(eq(profiles.id, actor.id))
    .limit(1);
  await db
    .update(profiles)
    .set({ avatarPath: stored, updatedAt: new Date() })
    .where(eq(profiles.id, actor.id));
  // the old file goes only AFTER the row points at the new one, so a failed
  // write can never leave the profile pointing at nothing
  if (me?.avatarPath) await removeAvatarFile(me.avatarPath);

  revalidatePath("/profile");
  return { ok: true };
}

export async function removeMyAvatarAction(): Promise<ProfileActionState> {
  const actor = await sessionActor();
  if (!actor) return { error: "Not signed in." };
  const [me] = await db
    .select({ avatarPath: profiles.avatarPath })
    .from(profiles)
    .where(eq(profiles.id, actor.id))
    .limit(1);
  await db
    .update(profiles)
    .set({ avatarPath: null, updatedAt: new Date() })
    .where(eq(profiles.id, actor.id));
  if (me?.avatarPath) await removeAvatarFile(me.avatarPath);
  revalidatePath("/profile");
  return { ok: true };
}

/**
 * Turns one integration on or off for the whole organisation.
 *
 * Gated in the service by org.manage — the tab is only rendered for an admin,
 * but a server action is a public endpoint and the hidden tab proves nothing.
 */
export async function setIntegrationAction(
  key: string,
  enabled: boolean,
): Promise<{ error?: string } | void> {
  const actor = await sessionActor();
  if (!actor) return { error: "Not signed in." };
  try {
    const { setIntegrationEnabled } = await import("@/lib/integrations/service");
    await setIntegrationEnabled(actor, key as "megatix", enabled);
    revalidatePath("/settings");
    revalidatePath("/admin");
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Could not change that.",
    };
  }
}

// ---- Reddie AI provider (Owner 2026-09-06) --------------------------------
// All three re-check org.manage inside the service: the panel is only shown to
// an admin, but a server action is a public endpoint and a hidden panel proves
// nothing. The key travels in one direction only — into the database.

export interface AiSettingsState {
  ok?: boolean;
  error?: string;
  message?: string;
}

export async function saveAiSettingsAction(
  _prev: AiSettingsState,
  formData: FormData,
): Promise<AiSettingsState> {
  const actor = await sessionActor();
  if (!actor) return { error: "Not signed in." };
  try {
    const { saveAiSettings } = await import("@/lib/ai/provider");
    await saveAiSettings(actor, {
      provider: String(formData.get("provider") ?? "openai") as "openai" | "deepseek" | "custom",
      baseUrl: String(formData.get("baseUrl") ?? ""),
      model: String(formData.get("model") ?? ""),
      apiKey: String(formData.get("apiKey") ?? ""),
    });
    revalidatePath("/settings");
    revalidatePath("/assistant");
    return { ok: true, message: "Saved." };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not save." };
  }
}

export async function testAiConnectionAction(): Promise<AiSettingsState> {
  const actor = await sessionActor();
  if (!actor) return { error: "Not signed in." };
  try {
    const { testAiConnection } = await import("@/lib/ai/provider");
    const r = await testAiConnection(actor);
    return r.ok ? { ok: true, message: r.message } : { error: r.message };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Test failed." };
  }
}

export async function clearAiKeyAction(): Promise<AiSettingsState> {
  const actor = await sessionActor();
  if (!actor) return { error: "Not signed in." };
  try {
    const { clearAiKey } = await import("@/lib/ai/provider");
    await clearAiKey(actor);
    revalidatePath("/settings");
    revalidatePath("/assistant");
    return { ok: true, message: "Key removed." };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not remove the key." };
  }
}
