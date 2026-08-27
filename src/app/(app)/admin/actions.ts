"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import {
  assignMembership,
  createUser,
  removeMembership,
  setUserActive,
  setUserContact,
  resetUserPassword,
  updateUser,
  createDivision,
  renameDivision,
  deleteDivision,
} from "@/lib/org/service";
import { getActor } from "@/lib/permissions/actor";
import { PermissionError } from "@/lib/permissions";

// Server actions are public endpoints: each one rebuilds the actor from the
// session and lets the service layer enforce capabilities.
async function requireActor() {
  const session = await auth();
  if (!session?.user?.id) throw new PermissionError("org.manage");
  const actor = await getActor(session.user.id);
  if (!actor) throw new PermissionError("org.manage");
  return actor;
}

export interface ActionState {
  error?: string;
  ok?: boolean;
}

function asError(error: unknown): ActionState {
  if (error instanceof PermissionError) return { error: "Not allowed." };
  if (
    error instanceof Error &&
    /duplicate key|unique/i.test(error.message)
  ) {
    return { error: "A user with that email already exists." };
  }
  throw error;
}

export async function createUserAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const actor = await requireActor();
    const user = await createUser(actor, {
      email: String(formData.get("email") ?? ""),
      name: String(formData.get("name") ?? ""),
      role: String(formData.get("role")) as
        | "owner"
        | "admin"
        | "member"
        | "external",
      password: String(formData.get("password") ?? "") || undefined,
      phone: String(formData.get("phone") ?? "") || undefined,
    });
    // optional initial divisions — a user can belong to several
    const divisionIds = formData.getAll("divisionIds").map(String).filter(Boolean);
    const divisionRole = String(formData.get("divisionRole") || "staff") as
      | "head"
      | "staff";
    for (const divisionId of divisionIds) {
      await assignMembership(actor, user.id, divisionId, divisionRole);
    }
    revalidatePath("/admin");
    return { ok: true };
  } catch (error) {
    return asError(error);
  }
}

export async function setUserContactAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const actor = await requireActor();
    await setUserContact(actor, String(formData.get("userId")), {
      phone: String(formData.get("phone") ?? ""),
      whatsappNotifications: formData.get("whatsapp") === "on",
    });
    revalidatePath("/admin");
    return { ok: true };
  } catch (error) {
    return asError(error);
  }
}

export async function resetUserPasswordAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const actor = await requireActor();
    const next = String(formData.get("password") ?? "");
    const confirm = String(formData.get("confirm") ?? "");
    // checked here as well as in the service so the admin gets the mismatch
    // back as a field error rather than a thrown one
    if (next !== confirm) return { error: "The two passwords do not match." };
    await resetUserPassword(actor, String(formData.get("userId")), next);
    revalidatePath("/admin");
    return { ok: true };
  } catch (error) {
    return asError(error);
  }
}

export async function updateUserAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const actor = await requireActor();
    await updateUser(actor, String(formData.get("userId")), {
      name: String(formData.get("name") ?? ""),
      email: String(formData.get("email") ?? ""),
      role: String(formData.get("role") ?? "member") as
        | "owner"
        | "admin"
        | "member"
        | "external",
    });
    revalidatePath("/admin");
    return { ok: true };
  } catch (error) {
    return asError(error);
  }
}

export async function toggleActiveAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  await setUserActive(
    actor,
    String(formData.get("userId")),
    formData.get("isActive") === "true",
  );
  revalidatePath("/admin");
}

export async function assignMembershipAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const actor = await requireActor();
    const userId = String(formData.get("userId"));
    const role = String(formData.get("role")) as "head" | "staff";
    // multi-division: assign every checked division in one go
    const divisionIds = formData.getAll("divisionIds").map(String).filter(Boolean);
    if (divisionIds.length === 0) {
      return { error: "Pick at least one division." };
    }
    for (const divisionId of divisionIds) {
      await assignMembership(actor, userId, divisionId, role);
    }
    revalidatePath("/admin");
    return { ok: true };
  } catch (error) {
    return asError(error);
  }
}

export async function removeMembershipAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  await removeMembership(
    actor,
    String(formData.get("userId")),
    String(formData.get("divisionId")),
  );
  revalidatePath("/admin");
}

export async function updateBrandingAction(
  _prev: { error?: string },
  formData: FormData,
): Promise<{ error?: string }> {
  try {
    const actor = await requireActor();
    const { updateBranding } = await import("@/lib/org/branding");
    await updateBranding(actor, {
      orgName: String(formData.get("orgName") ?? ""),
      orgShortName: String(formData.get("orgShortName") ?? ""),
      productName: String(formData.get("productName") ?? ""),
      assistantName: String(formData.get("assistantName") ?? ""),
    });
    // branding shows in the shell on every page
    revalidatePath("/", "layout");
    return {};
  } catch (error) {
    return {
      error:
        error instanceof PermissionError
          ? "Not allowed."
          : error instanceof Error
            ? error.message
            : "Failed to save branding.",
    };
  }
}

export async function createDivisionAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const actor = await requireActor();
    await createDivision(actor, String(formData.get("name") ?? ""));
    revalidatePath("/admin");
    return { ok: true };
  } catch (error) {
    return asError(error);
  }
}

export async function renameDivisionAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const actor = await requireActor();
    await renameDivision(
      actor,
      String(formData.get("divisionId")),
      String(formData.get("name") ?? ""),
    );
    revalidatePath("/admin");
    return { ok: true };
  } catch (error) {
    return asError(error);
  }
}

export async function deleteDivisionAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const actor = await requireActor();
    await deleteDivision(actor, String(formData.get("divisionId")));
    revalidatePath("/admin");
    return { ok: true };
  } catch (error) {
    // the guard's message carries the counts; show it as-is
    return asError(error);
  }
}
