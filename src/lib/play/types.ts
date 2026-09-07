/**
 * The Play world snapshot contract. Produced by `getPlayWorld(actor)` (server,
 * permission-scoped) and consumed by the pure world modules and the engine.
 * Everything here is already filtered by what the actor may see.
 */
export type TaskStatus = "backlog" | "todo" | "in_progress" | "in_review" | "blocked" | "done" | "cancelled";
export type TaskPriority = "low" | "medium" | "high" | "urgent";

export type PlayDivision = {
  id: string;
  name: string;
  /** Hex colour like "#E62E2E"; derived deterministically when the org has none. */
  color: string;
  headId: string | null;
  memberIds: string[];
};

export type PlayPerson = {
  id: string;
  name: string;
  initials: string;
  avatarUrl: string | null;
  divisionId: string | null;
  isHead: boolean;
};

export type PlayTask = {
  id: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  divisionId: string;
  eventId: string;
  assigneeIds: string[];
  leadId: string | null;
  dueDate: string | null;
  overdue: boolean;
  checklistTotal: number;
  checklistDone: number;
  /** Open tasks waiting on this one (EPIC-012 fan-in). */
  waiters: number;
  /** EPIC-012 critical bottleneck flag (threshold already applied server-side). */
  critical: boolean;
};

export type PlayHandoff = {
  id: string;
  fromDivisionId: string;
  toDivisionId: string;
  title: string;
};

export type PlayEvent = {
  id: string;
  name: string;
  showDate: string | null;
  phase: string | null;
  health: string | null;
};

export type PlayWorld = {
  me: { id: string; divisionId: string | null };
  divisions: PlayDivision[];
  people: PlayPerson[];
  tasks: PlayTask[];
  handoffs: PlayHandoff[];
  events: PlayEvent[];
  approvalsWaiting: number;
  unreadNotifications: number;
  /** Latest activity_log id at snapshot time — EPIC-025 streams from here. */
  cursor: string | null;
  generatedAt: string;
};
