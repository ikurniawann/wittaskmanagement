"use server";

import { revalidatePath } from "next/cache";
import { sessionActor } from "@/lib/auth/session-actor";
import { createAgentKey, revokeAgentKey } from "@/lib/agent/auth";

export interface AgentKeyActionState {
  error?: string;
  /** plaintext, present ONLY in the response right after creation */
  token?: string;
}

export async function createAgentKeyAction(
  _prev: AgentKeyActionState,
  formData: FormData,
): Promise<AgentKeyActionState> {
  const actor = await sessionActor();
  if (!actor) return { error: "Not signed in." };
  try {
    const { token } = await createAgentKey(actor, String(formData.get("name") ?? ""));
    revalidatePath("/admin");
    return { token };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not create." };
  }
}

export async function revokeAgentKeyAction(formData: FormData): Promise<void> {
  const actor = await sessionActor();
  if (!actor) return;
  await revokeAgentKey(actor, String(formData.get("keyId")));
  revalidatePath("/admin");
}
