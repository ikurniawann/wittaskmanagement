// Central authorization module (T-012) — PROTECTED PATH.
// Every service-layer read/write goes through `can`/`assertCan`. No component
// or route may hand-roll a role check. Implements the PLAN §4 matrix:
// role (global) × division membership × event scope.
//
// Design notes:
// - Global roles: owner/admin (org-wide), member (internal; authority comes
//   from division memberships: head|staff), external (guest, EPIC-007).
// - The Finance division sees ALL financial data; other Heads only their own
//   division's budget lines; Staff/External none.
// - Admin explicitly does NOT hold approval powers (tier1 = Owner/Head,
//   final = Owner alone).
// - Event scoping: internal visibility is division-first; per-event access for
//   externals is enforced by invite scope (eventId in context, EPIC-007).

export type GlobalRole = "owner" | "admin" | "member" | "external";
export type DivisionRole = "head" | "staff";

export interface Membership {
  divisionId: string;
  role: DivisionRole;
}

export interface Actor {
  id: string;
  role: GlobalRole;
  memberships: ReadonlyArray<Membership>;
}

export type Capability =
  // org & events
  | "org.manage" // users, divisions, settings
  | "org.viewAllDivisions" // full cross-division detail
  | "org.viewCrossDivisionSummary" // Head-level summary of other divisions
  | "event.view" // browse events & open a workspace (any internal user)
  | "event.create"
  | "event.edit"
  | "event.archive"
  | "event.updatePhase" // advance the lifecycle phase
  | "event.manageDivisions" // which divisions participate in an event
  | "event.manageWorkflow" // add/rename/delete/reorder an event's phases
  | "dashboard.view"
  | "audit.view"
  // tasks
  | "task.viewDivision" // all tasks of a division (ctx.divisionId)
  | "task.create" // in a division (ctx.divisionId)
  | "task.edit" // in a division (ctx.divisionId)
  | "task.assign" // within a division (ctx.divisionId)
  | "task.updateAssigned" // status/comment/upload on an assigned task (ctx.isAssigned)
  | "handoff.request" // from own division (ctx.divisionId = source)
  | "handoff.decide" // accept/decline into a division (ctx.divisionId = target)
  // external collaboration
  | "form.submit" // structured forms — external only
  | "external.invite" // into a division (ctx.divisionId)
  | "submission.review" // review queue of a division (ctx.divisionId)
  // finance
  | "expense.create" // in a division (ctx.divisionId)
  | "expense.markPaid" // committed → paid (finance operation)
  | "budget.view" // a division's budget (ctx.divisionId)
  | "budget.manage" // create/edit budget lines (finance operation)
  // approvals
  | "approve.tier1" // division-level (ctx.divisionId)
  | "approve.final" // high-value / contracts / artist offers
  // documents (EPIC-008 T-082)
  | "document.view" // a division's document library (ctx.divisionId)
  | "document.manage" // upload into a division (ctx.divisionId)
  // run of show (EPIC-008 T-083)
  | "runofshow.manage" // edit the show-day rundown (Production/Ops)
  // ticket sales (EPIC-009 T-093)
  | "tickets.record" // daily ticket sales snapshots (Ticketing division)
  // AI assistant (EPIC-014 T-140)
  | "ai.assistant" // predictive chat over org data (leadership only)
  // standalone workspace pages (EPIC-016 T-160)
  | "page.use" // reach the Pages module at all — per-page access is
  // row-level and decided by src/lib/pages/access.ts, not by this capability
  // Backstage Play (EPIC-024 T-240)
  | "play.view"; // enter the 3D office — what it SHOWS is still decided per
// task / event / division by the existing rules; this only opens the door

export interface PermissionContext {
  /** division the action targets (source division for handoffs) */
  divisionId?: string;
  /** actor is assignee/watcher of the target task */
  isAssigned?: boolean;
  /** actor is the staff member explicitly assigned to review a submission */
  isAssignedReviewer?: boolean;
}

export class PermissionError extends Error {
  constructor(capability: Capability) {
    super(`Not allowed: ${capability}`);
    this.name = "PermissionError";
  }
}

const FINANCE_DIVISION_ID = "finance";
const RUN_OF_SHOW_DIVISIONS = ["production", "operations-logistics"];

function membershipIn(
  actor: Actor,
  divisionId: string | undefined,
): Membership | undefined {
  if (!divisionId) return undefined;
  return actor.memberships.find((m) => m.divisionId === divisionId);
}

function isHeadOf(actor: Actor, divisionId: string | undefined): boolean {
  return membershipIn(actor, divisionId)?.role === "head";
}

function isFinanceMember(actor: Actor): boolean {
  return actor.memberships.some((m) => m.divisionId === FINANCE_DIVISION_ID);
}

export function can(
  actor: Actor,
  capability: Capability,
  ctx: PermissionContext = {},
): boolean {
  const { role } = actor;
  const isOwnerOrAdmin = role === "owner" || role === "admin";

  // External guests: a hard, short whitelist. Everything else is denied.
  if (role === "external") {
    switch (capability) {
      case "task.updateAssigned":
        return ctx.isAssigned === true;
      case "form.submit":
        return true;
      default:
        return false;
    }
  }

  switch (capability) {
    // ---- org & events -------------------------------------------------
    case "org.manage":
    case "event.archive":
    case "event.updatePhase":
    case "event.manageDivisions":
    case "event.manageWorkflow":
    case "audit.view":
    case "org.viewAllDivisions":
      return isOwnerOrAdmin;

    case "event.create":
    case "event.edit":
      // Owner 2026-08-12: a division HEAD may open a new event, not only
      // owner/admin — a "member" global role with a head membership is how
      // this org models its leads. Editing joined it (Owner 2026-08-13);
      // archiving and phase control stay above. For edit, the service also
      // requires the head to actually SEE the event — the capability alone
      // is not a skeleton key over invisible events.
      return (
        isOwnerOrAdmin || actor.memberships.some((m) => m.role === "head")
      );

    case "event.view":
      // every internal user navigates events; externals see only their
      // invite-scoped surface (EPIC-007), never the events index
      return true;

    case "dashboard.view":
      // Owner's cockpit; Admin gets read-only access (PLAN §4)
      return isOwnerOrAdmin;

    case "org.viewCrossDivisionSummary":
      return (
        isOwnerOrAdmin ||
        actor.memberships.some((m) => m.role === "head")
      );

    // ---- tasks --------------------------------------------------------
    case "task.viewDivision":
    case "task.create":
    case "task.edit":
    case "task.assign":
      return isOwnerOrAdmin || membershipIn(actor, ctx.divisionId) !== undefined;

    case "task.updateAssigned":
      return isOwnerOrAdmin || ctx.isAssigned === true;

    case "handoff.request":
      return isOwnerOrAdmin || membershipIn(actor, ctx.divisionId) !== undefined;

    case "handoff.decide":
      // the receiving Division Head accepts work into their board
      return isOwnerOrAdmin || isHeadOf(actor, ctx.divisionId);

    // ---- external collaboration --------------------------------------
    case "form.submit":
      return false; // internal users never submit external forms

    case "external.invite":
      return isOwnerOrAdmin || isHeadOf(actor, ctx.divisionId);

    case "submission.review":
      return (
        isOwnerOrAdmin ||
        isHeadOf(actor, ctx.divisionId) ||
        (membershipIn(actor, ctx.divisionId) !== undefined &&
          ctx.isAssignedReviewer === true)
      );

    // ---- finance ------------------------------------------------------
    case "expense.create":
      // staff requests still need Head approval downstream (EPIC-004/005)
      return isOwnerOrAdmin || membershipIn(actor, ctx.divisionId) !== undefined;

    case "budget.view":
      if (isOwnerOrAdmin || isFinanceMember(actor)) return true;
      // a Head sees only their own division's budget
      return isHeadOf(actor, ctx.divisionId);

    case "budget.manage":
    case "expense.markPaid":
      // structuring budgets and recording payments is a Finance operation
      return isOwnerOrAdmin || isFinanceMember(actor);

    // ---- approvals ----------------------------------------------------
    case "approve.tier1":
      // Admin is deliberately excluded (PLAN §4)
      return role === "owner" || isHeadOf(actor, ctx.divisionId);

    case "approve.final":
      return role === "owner";

    case "tickets.record":
      // Ticketing & Sales enters the dailies (PLAN §6.11); owner/admin too
      return (
        isOwnerOrAdmin ||
        actor.memberships.some((m) => m.divisionId === "ticketing-sales")
      );

    case "ai.assistant":
      // leadership tool (Owner request 2026-08-07): owner, admin, and any
      // division HEAD. The context the AI sees is separately re-scoped per
      // actor by src/lib/ai — this gate only opens the door.
      return (
        isOwnerOrAdmin || actor.memberships.some((m) => m.role === "head")
      );

    case "page.use":
      // any internal user may keep workspace pages; who can see a GIVEN page
      // is row-level and decided by src/lib/pages/access.ts (private by
      // default, shared explicitly). Externals never reach the module.
      return actor.role !== "external";

    case "play.view":
      // any internal user may walk the office (EPIC-024). The snapshot it is
      // built from is assembled through listActiveEvents / listEventTasks
      // and friends, so nothing becomes visible here that the app hides.
      return actor.role !== "external";

    // ---- documents ------------------------------------------------------
    case "document.view":
      return (
        isOwnerOrAdmin ||
        can(actor, "org.viewAllDivisions") ||
        membershipIn(actor, ctx.divisionId) !== undefined
      );

    case "document.manage":
      return isOwnerOrAdmin || membershipIn(actor, ctx.divisionId) !== undefined;

    case "runofshow.manage":
      // PLAN §6.6: the rundown is owned by Production/Ops; every other
      // internal division reads it (via event.view)
      return (
        isOwnerOrAdmin ||
        actor.memberships.some((m) =>
          RUN_OF_SHOW_DIVISIONS.includes(m.divisionId),
        )
      );

    default: {
      // exhaustiveness guard — a new Capability must be handled explicitly
      const _never: never = capability;
      return _never;
    }
  }
}

export function assertCan(
  actor: Actor,
  capability: Capability,
  ctx: PermissionContext = {},
): void {
  if (!can(actor, capability, ctx)) throw new PermissionError(capability);
}

// ---- approvals engine (EPIC-004) -----------------------------------------
// Semantic approver keys → who may decide. Centralized HERE so the approvals
// service never hand-rolls role checks. Admin never approves (PLAN §4);
// the Owner can decide any step.

export type ApprovalStepRole =
  | "division_head"
  | "finance"
  | "owner"
  | "legal"
  | "sponsorship_head"
  | "marketing_head"
  | "talent_head";

const STEP_DIVISION: Partial<Record<ApprovalStepRole, string>> = {
  finance: "finance",
  legal: "legal-licensing",
  sponsorship_head: "sponsorship-partnership",
  marketing_head: "marketing-communications",
  talent_head: "talent-booking",
};

export function canDecideApprovalStep(
  actor: Actor,
  stepRole: ApprovalStepRole,
  originDivisionId: string,
): boolean {
  if (actor.role === "external") return false;
  if (actor.role === "owner") return true;
  if (actor.role === "admin") return false; // deliberately powerless here

  if (stepRole === "owner") return false;
  if (stepRole === "division_head") return isHeadOf(actor, originDivisionId);
  const divisionId = STEP_DIVISION[stepRole];
  return divisionId !== undefined && isHeadOf(actor, divisionId);
}
