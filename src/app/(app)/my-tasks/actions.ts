"use server";

import { sessionActor } from "@/lib/auth/session-actor";
import {
  listMyWorkDrilldown,
  type MyWorkFilter,
  type MyWorkRow,
  type MyWorkSource,
} from "@/lib/tasks/my-work";

/**
 * Rows behind a Summary number. Scoped to the caller — every branch of the
 * query is keyed on their own id, there are no cross-user reads — so being
 * signed in is the whole gate, the same as the page that shows the numbers.
 */
export async function myWorkDrilldownAction(
  source: MyWorkSource,
  filter: MyWorkFilter,
): Promise<{ rows: MyWorkRow[] } | { error: string }> {
  const actor = await sessionActor();
  if (!actor) return { error: "Not signed in." };
  try {
    return { rows: await listMyWorkDrilldown(actor, source, filter) };
  } catch {
    return { error: "Could not load these tasks." };
  }
}
