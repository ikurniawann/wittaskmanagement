/**
 * EPIC-025 T-250 — pure diff engine. An activity_log row comes in, animation
 * intents come out. The scene executes intents; it never interprets rows.
 * Unknown task-shaped rows fall back to "refetch this one task" — never the
 * whole world.
 */
export type ActivityRow = {
  id: string;
  action: string;
  entity: string;
  detail: Record<string, unknown> | null;
  actorId: string | null;
  eventId: string | null;
  createdAt: string;
};

export type Intent =
  | { kind: "task"; id: string; effect: "restack" | "complete" | "spawn" }
  | { kind: "handoffs" }
  | { kind: "approvals" }
  | { kind: "bubble"; personId: string; text: string };

export function entityOf(entity: string): { type: string; id: string } {
  const i = entity.indexOf(":");
  return i < 0 ? { type: entity, id: "" } : { type: entity.slice(0, i), id: entity.slice(i + 1) };
}

const APPROVAL_TEXT: Record<string, string> = {
  "approval.approved": "Approved ✓",
  "approval.rejected": "Rejected ✕",
  "approval.changes_requested": "Changes requested",
  "approval.create": "Approval requested",
};

export function applyDiff(row: ActivityRow): Intent[] {
  const { type, id } = entityOf(row.entity);
  const out: Intent[] = [];
  const bubble = (text: string) => { if (row.actorId) out.push({ kind: "bubble", personId: row.actorId, text }); };

  if (type === "task" && id) {
    if (row.action === "task.status") {
      const to = row.detail?.to;
      if (to === "done") { out.push({ kind: "task", id, effect: "complete" }); bubble("Done ✓"); }
      else if (to === "cancelled") out.push({ kind: "task", id, effect: "complete" });
      else { out.push({ kind: "task", id, effect: "restack" }); if (to === "blocked") bubble("Blocked"); }
    } else if (row.action === "task.create") {
      out.push({ kind: "task", id, effect: "spawn" });
    } else if (row.action === "task.priority_auto_bump") {
      out.push({ kind: "task", id, effect: "restack" });
    } else {
      // update / assign / lead_* / dependency_* / external_dep_* / auto_revert / anything new
      out.push({ kind: "task", id, effect: "restack" });
    }
    return out;
  }
  if (type === "handoff") {
    out.push({ kind: "handoffs" });
    if (row.action === "handoff.request") bubble("Handoff requested");
    else if (row.action === "handoff.accept") bubble("Handoff accepted");
    else if (row.action === "handoff.decline") bubble("Handoff declined");
    return out;
  }
  if (type === "approval") {
    out.push({ kind: "approvals" });
    const text = APPROVAL_TEXT[row.action];
    if (text) bubble(text);
    return out;
  }
  return out; // auth.*, user.*, play.*, setting:* … nothing to draw
}

/** Fold a batch into the minimal set (one refetch per task, one per list). */
export function coalesce(intents: Intent[]): Intent[] {
  const tasks = new Map<string, Intent>();
  let handoffs = false, approvals = false;
  const bubbles: Intent[] = [];
  for (const i of intents) {
    if (i.kind === "task") {
      const prev = tasks.get(i.id);
      // complete beats restack; spawn then restack stays spawn
      if (!prev || i.effect === "complete" || (prev.kind === "task" && prev.effect === "restack")) tasks.set(i.id, i);
    } else if (i.kind === "handoffs") handoffs = true;
    else if (i.kind === "approvals") approvals = true;
    else bubbles.push(i);
  }
  const out: Intent[] = [...tasks.values()];
  if (handoffs) out.push({ kind: "handoffs" });
  if (approvals) out.push({ kind: "approvals" });
  return out.concat(bubbles.slice(-6)); // never more than a handful of bubbles per batch
}
