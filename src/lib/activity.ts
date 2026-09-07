import { and, desc, eq, gte, like, lt } from "drizzle-orm";
import { db } from "@/db";
import { activityLog, profiles } from "@/db/schema";
import { assertCan, type Actor } from "@/lib/permissions";

interface LogInput {
  actorId: string | null;
  action: string;
  entity: string;
  detail?: Record<string, unknown>;
  eventId?: string;
}

// Fire-and-record audit write (T-014). Callers await it inside the same
// mutation flow so a logged action implies the mutation happened. Never put
// secrets or password hashes in `detail`.
export interface ActivityFilters {
  actorId?: string;
  /** entity prefix, e.g. "task", "approval", "profile" */
  entityType?: string;
  eventId?: string;
  from?: Date;
  to?: Date;
}

// Audit query (T-063) — Owner/Admin only.
export async function listActivity(
  actor: Actor,
  filters: ActivityFilters = {},
  limit = 100,
) {
  assertCan(actor, "audit.view");
  const conditions = [];
  if (filters.actorId) conditions.push(eq(activityLog.actorId, filters.actorId));
  if (filters.entityType)
    conditions.push(like(activityLog.entity, `${filters.entityType}:%`));
  if (filters.eventId) conditions.push(eq(activityLog.eventId, filters.eventId));
  if (filters.from) conditions.push(gte(activityLog.createdAt, filters.from));
  if (filters.to) conditions.push(lt(activityLog.createdAt, filters.to));

  const rows = await db
    .select({
      id: activityLog.id,
      action: activityLog.action,
      entity: activityLog.entity,
      detail: activityLog.detail,
      eventId: activityLog.eventId,
      createdAt: activityLog.createdAt,
      actorName: profiles.name,
    })
    .from(activityLog)
    .leftJoin(profiles, eq(activityLog.actorId, profiles.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(activityLog.createdAt))
    .limit(limit);

  const { actionLabel, resolveEntityLabels } = await import(
    "@/lib/activity-labels"
  );
  const entityLabels = await resolveEntityLabels(rows.map((r) => r.entity));
  return rows.map((r) => ({
    ...r,
    actionLabel: actionLabel(r.action),
    entityLabel: entityLabels.get(r.entity) ?? "",
  }));
}

export async function logActivity(input: LogInput): Promise<void> {
  const [row] = await db
    .insert(activityLog)
    .values({
      actorId: input.actorId,
      action: input.action,
      entity: input.entity,
      detail: input.detail ?? null,
      eventId: input.eventId ?? null,
    })
    .returning();
  // Backstage Play (EPIC-026 T-261): the XP ledger is derived from this log.
  // Scored after the row exists, never awaited — a scoring failure must not
  // fail the mutation that produced the row, and never delays it.
  if (row && row.actorId) {
    void import("@/lib/play/xp/service")
      .then((m) => m.onActivityLogged(row))
      .catch((error) => console.error("[play] scoring failed:", error));
  }
}
