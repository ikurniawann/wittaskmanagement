"use server";

import { revalidatePath } from "next/cache";
import { sessionActor } from "@/lib/auth/session-actor";
import {
  clearMegatixCredentials,
  listMegatixPresenters,
  saveMegatixCredentials,
  syncMegatixSales,
} from "@/lib/megatix/client";

export interface MegatixActionState {
  error?: string;
  ok?: boolean;
  presenterCount?: number;
  presenterNames?: string[];
  syncedCount?: number;
}

export async function saveMegatixAction(
  _prev: MegatixActionState,
  formData: FormData,
): Promise<MegatixActionState> {
  const actor = await sessionActor();
  if (!actor) return { error: "Not signed in." };
  try {
    await saveMegatixCredentials(actor, {
      email: String(formData.get("email") ?? ""),
      password: String(formData.get("password") ?? ""),
      baseUrl: String(formData.get("baseUrl") ?? ""),
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not save." };
  }
  revalidatePath("/admin");
  return { ok: true };
}

export async function clearMegatixAction(
  _prev: MegatixActionState,
  _formData: FormData,
): Promise<MegatixActionState> {
  void _prev;
  void _formData;
  const actor = await sessionActor();
  if (!actor) return { error: "Not signed in." };
  try {
    await clearMegatixCredentials(actor);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not clear." };
  }
  revalidatePath("/admin");
  return { ok: true };
}

/** Test = list presenters; it is the cheapest call that proves the login. */
export async function testMegatixAction(
  _prev: MegatixActionState,
  _formData: FormData,
): Promise<MegatixActionState> {
  void _prev;
  void _formData;
  const actor = await sessionActor();
  if (!actor) return { error: "Not signed in." };
  try {
    const rows = await listMegatixPresenters(actor);
    revalidatePath("/admin");
    return {
      ok: true,
      presenterCount: rows.length,
      presenterNames: rows.slice(0, 5).map((r) => r.name),
    };
  } catch (error) {
    revalidatePath("/admin");
    return {
      error: error instanceof Error ? error.message : "Connection failed.",
    };
  }
}

export async function syncMegatixNowAction(
  _prev: MegatixActionState,
  _formData: FormData,
): Promise<MegatixActionState> {
  void _prev;
  void _formData;
  const actor = await sessionActor();
  if (!actor) return { error: "Not signed in." };
  const result = await syncMegatixSales();
  revalidatePath("/admin");
  if (result.authFailed) {
    return { error: "Megatix rejected the credentials — check the email and password." };
  }
  return { ok: true, syncedCount: result.synced };
}
