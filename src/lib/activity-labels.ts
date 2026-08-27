import { inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  approvals,
  budgetLines,
  divisions,
  events,
  expenseRequests,
  handoffs,
  profiles,
  tasks,
} from "@/db/schema";

// Humanizes activity-log rows for the dashboard feed and audit UI:
// action codes → readable labels, "type:uuid" entities → real names.

export const ACTION_LABELS: Record<string, string> = {
  "auth.signin": "signed in",
  "user.create": "created user",
  "user.activate": "activated user",
  "user.deactivate": "deactivated user",
  "membership.assign": "assigned division",
  "membership.remove": "removed from division",
  "event.create": "created project",
  "event.updatePhase": "advanced project phase",
  "event.archive": "archived project",
  "event.unarchive": "unarchived project",
  "task.create": "created task",
  "task.update": "updated task",
  "task.status": "moved task",
  "task.assign": "assigned task",
  "handoff.request": "requested handoff",
  "handoff.accept": "accepted handoff",
  "handoff.decline": "declined handoff",
  "approval.create": "submitted approval request",
  "approval.approved": "approved",
  "approval.rejected": "rejected",
  "approval.changes_requested": "requested changes on",
  "budget.line.create": "added budget line",
  "budget.line.delete": "removed budget line",
  "expense.paid": "marked expense paid",
};

export function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action.replaceAll(".", " ").replaceAll("_", " ");
}

type EntityRef = { type: string; id: string };

function parseEntity(entity: string): EntityRef | null {
  const [type, id] = entity.split(":");
  return type && id ? { type, id } : null;
}

// Batch-resolve "type:id" strings to display names. Unknown/deleted records
// fall back to the bare type name — never a raw uuid.
export async function resolveEntityLabels(
  entities: string[],
): Promise<Map<string, string>> {
  const refs = entities
    .map((e) => ({ raw: e, ref: parseEntity(e) }))
    .filter((e): e is { raw: string; ref: EntityRef } => e.ref !== null);

  const idsByType = new Map<string, string[]>();
  for (const { ref } of refs) {
    idsByType.set(ref.type, [...(idsByType.get(ref.type) ?? []), ref.id]);
  }

  const names = new Map<string, string>(); // "type:id" → name
  const put = (type: string, id: string, name: string) =>
    names.set(`${type}:${id}`, name);

  const lookups: Array<Promise<void>> = [];
  const ids = (type: string) => idsByType.get(type) ?? [];

  if (ids("profile").length > 0) {
    lookups.push(
      db
        .select({ id: profiles.id, name: profiles.name })
        .from(profiles)
        .where(inArray(profiles.id, ids("profile")))
        .then((rows) => rows.forEach((r) => put("profile", r.id, r.name))),
    );
  }
  if (ids("event").length > 0) {
    lookups.push(
      db
        .select({ id: events.id, name: events.name })
        .from(events)
        .where(inArray(events.id, ids("event")))
        .then((rows) => rows.forEach((r) => put("event", r.id, r.name))),
    );
  }
  if (ids("task").length > 0) {
    lookups.push(
      db
        .select({ id: tasks.id, title: tasks.title })
        .from(tasks)
        .where(inArray(tasks.id, ids("task")))
        .then((rows) => rows.forEach((r) => put("task", r.id, `“${r.title}”`))),
    );
  }
  if (ids("approval").length > 0) {
    lookups.push(
      db
        .select({ id: approvals.id, title: approvals.title })
        .from(approvals)
        .where(inArray(approvals.id, ids("approval")))
        .then((rows) => rows.forEach((r) => put("approval", r.id, `“${r.title}”`))),
    );
  }
  if (ids("handoff").length > 0) {
    lookups.push(
      db
        .select({ id: handoffs.id, title: handoffs.title })
        .from(handoffs)
        .where(inArray(handoffs.id, ids("handoff")))
        .then((rows) => rows.forEach((r) => put("handoff", r.id, `“${r.title}”`))),
    );
  }
  if (ids("budget_line").length > 0) {
    lookups.push(
      db
        .select({ id: budgetLines.id, name: budgetLines.name })
        .from(budgetLines)
        .where(inArray(budgetLines.id, ids("budget_line")))
        .then((rows) => rows.forEach((r) => put("budget_line", r.id, r.name))),
    );
  }
  if (ids("expense").length > 0) {
    lookups.push(
      db
        .select({ id: expenseRequests.id, title: expenseRequests.title })
        .from(expenseRequests)
        .where(inArray(expenseRequests.id, ids("expense")))
        .then((rows) => rows.forEach((r) => put("expense", r.id, `“${r.title}”`))),
    );
  }
  if (ids("division").length > 0) {
    lookups.push(
      db
        .select({ id: divisions.id, name: divisions.name })
        .from(divisions)
        .where(inArray(divisions.id, ids("division")))
        .then((rows) => rows.forEach((r) => put("division", r.id, r.name))),
    );
  }
  await Promise.all(lookups);

  const result = new Map<string, string>();
  for (const { raw, ref } of refs) {
    result.set(raw, names.get(`${ref.type}:${ref.id}`) ?? ref.type.replaceAll("_", " "));
  }
  return result;
}
