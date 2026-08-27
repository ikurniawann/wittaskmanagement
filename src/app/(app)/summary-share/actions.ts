"use server";

import { revalidatePath } from "next/cache";
import { sessionActor } from "@/lib/auth/session-actor";
import { parseAllowedEmails } from "@/lib/dataroom/share-rules";
import {
  createProjectShare,
  createTaskShare,
  listProjectShares,
  listTaskShares,
  revokeSummaryShare,
} from "@/lib/summary-share/service";

// Shared by the project page and the task drawer — one dialog serves both, so
// the actions live in one place rather than being duplicated per route.

export interface SummaryShareState {
  url?: string;
  expiresAt?: string;
  error?: string;
}

function gates(formData: FormData) {
  return {
    expiryDays: Number(formData.get("expiryDays") ?? 14),
    passcode: String(formData.get("passcode") ?? "") || undefined,
    allowedEmails: parseAllowedEmails(String(formData.get("allowedEmails") ?? "")),
    requireEmail: formData.get("requireEmail") === "on",
    allowUpload: formData.get("allowUpload") === "on",
    label: String(formData.get("label") ?? "") || undefined,
  };
}

export async function createSummaryShareAction(
  _prev: SummaryShareState,
  formData: FormData,
): Promise<SummaryShareState> {
  const actor = await sessionActor();
  if (!actor) return { error: "Not signed in." };
  const kind = String(formData.get("kind") ?? "");
  const targetId = String(formData.get("targetId") ?? "");
  try {
    const created =
      kind === "task"
        ? await createTaskShare(actor, targetId, gates(formData))
        : await createProjectShare(actor, targetId, gates(formData));
    revalidatePath(kind === "task" ? `/tasks/${targetId}` : `/events/${targetId}`);
    return { url: created.url, expiresAt: created.expiresAt.toISOString() };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Could not create the link.",
    };
  }
}

export async function listSummarySharesAction(kind: string, targetId: string) {
  const actor = await sessionActor();
  if (!actor) return [];
  const rows =
    kind === "task"
      ? await listTaskShares(actor, targetId).catch(() => [])
      : await listProjectShares(actor, targetId).catch(() => []);
  return rows;
}

export async function revokeSummaryShareAction(formData: FormData): Promise<void> {
  const actor = await sessionActor();
  if (!actor) return;
  const kind = String(formData.get("kind") ?? "");
  const targetId = String(formData.get("targetId") ?? "");
  await revokeSummaryShare(actor, String(formData.get("linkId") ?? "")).catch(() => {});
  revalidatePath(kind === "task" ? `/tasks/${targetId}` : `/events/${targetId}`);
}
