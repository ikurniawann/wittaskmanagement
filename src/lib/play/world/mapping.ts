import type { PlayTask } from "../types";

/**
 * Pure task → visual-state mapping, following the PRD "World mapping" table.
 * The engine renders exactly what this returns.
 */
export type DeskTarget =
  | { kind: "person"; personId: string }
  | { kind: "whiteboard"; divisionId: string };

export type TaskVisual = {
  taskId: string;
  visible: boolean;
  target: DeskTarget;
  /** 1..3 paper-stack height bucket from checklist size. */
  stackHeight: 1 | 2 | 3;
  /** Hex colour of the stack. */
  colour: string;
  /** Owner character clip when this is their most urgent visible task. */
  ownerClip: "idle" | "work" | "panic";
  aura: boolean;
  smoke: boolean;
  chain: boolean;
  /** Ghost waiters to draw (capped) and the overflow label. */
  ghosts: number;
  overflow: string | null;
  urgentSign: boolean;
};

export const STATUS_COLOUR: Record<PlayTask["status"], string> = {
  backlog: "#9A9A96",
  todo: "#8C8F94",
  in_progress: "#3B82F6",
  in_review: "#E0A426",
  blocked: "#D43F2F",
  done: "#3FA46B",
  cancelled: "#6B6B68",
};

export const GHOST_CAP = 6;

export function mapTask(t: PlayTask): TaskVisual {
  const hidden = t.status === "done" || t.status === "cancelled";
  const target: DeskTarget = t.assigneeIds[0]
    ? { kind: "person", personId: t.assigneeIds[0] }
    : t.leadId
      ? { kind: "person", personId: t.leadId }
      : { kind: "whiteboard", divisionId: t.divisionId };
  const stackHeight: 1 | 2 | 3 = t.checklistTotal >= 6 ? 3 : t.checklistTotal >= 2 ? 2 : 1;
  const ghosts = Math.min(GHOST_CAP, t.waiters);
  return {
    taskId: t.id,
    visible: !hidden,
    target,
    stackHeight,
    colour: STATUS_COLOUR[t.status],
    ownerClip: hidden ? "idle" : t.critical || (t.overdue && t.status === "blocked") ? "panic" : t.status === "in_progress" ? "work" : "idle",
    aura: !hidden && t.critical,
    smoke: !hidden && t.overdue,
    chain: !hidden && t.status === "blocked",
    ghosts: hidden ? 0 : ghosts,
    overflow: !hidden && t.waiters > GHOST_CAP ? `+${t.waiters - GHOST_CAP}` : null,
    urgentSign: !hidden && t.critical,
  };
}

/** Which clip a person plays given all their visible task visuals (panic > work > idle). */
export function personClip(visuals: readonly TaskVisual[]): "idle" | "work" | "panic" {
  let best: "idle" | "work" | "panic" = "idle";
  for (const v of visuals) {
    if (!v.visible) continue;
    if (v.ownerClip === "panic") return "panic";
    if (v.ownerClip === "work") best = "work";
  }
  return best;
}
