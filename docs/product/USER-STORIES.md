# RVC Backstage — User Stories

> Companion to `PRD.md`. Stories use `As a {role}, I want {capability}, so that {outcome}`.
> Roles: **Owner** (CEO, final approver) · **Admin** · **Head** (Division Head) · **Staff** · **External** (vendor / artist mgmt / venue / sponsor rep / freelance crew).
> Each story carries an ID (`US-{DOMAIN}-{n}`), priority (P0–P2), and owning epic.
> All domains are currently **planned** (greenfield).

---

## 1. Auth, Org & Permissions — EPIC-001

| ID | Story | Priority | Epic |
| --- | --- | --- | --- |
| US-AUTH-1 | As a Staff member, I want to sign in with email+password, so that I can access my division's workspace. | P0 | EPIC-001 |
| US-AUTH-2 | As an Admin, I want to manage users, divisions, and role assignments, so that the org structure in the tool mirrors reality. | P0 | EPIC-001 |
| US-AUTH-3 | As an Owner, I want every capability enforced by role+division+event scope in one central module, so that no screen can leak data the role shouldn't see. | P0 | EPIC-001 |
| US-AUTH-4 | As an Admin, I want every permission change and sensitive action recorded, so that we can audit who did what, when. | P1 | EPIC-001 |

**Acceptance:** Sign-in works for seeded users of all five roles; the 11 divisions exist with Head/Staff membership; every service-layer query passes through `src/lib/permissions` (verified by tests that assert Staff cannot read another division's tasks and non-finance Heads cannot read other divisions' budget lines); permission changes appear in the activity log.

---

## 2. Events Workspace — EPIC-002

| ID | Story | Priority | Epic |
| --- | --- | --- | --- |
| US-EVT-1 | As an Admin, I want to create an event with name, artists, venue, show date, capacity, and poster, so that each concert has one shared workspace. | P0 | EPIC-002 |
| US-EVT-2 | As a Staff member, I want the event workspace to show a countdown to show day and the current lifecycle phase, so that urgency is always visible. | P0 | EPIC-002 |
| US-EVT-3 | As an Owner, I want each event's health (On track / At risk / Critical) computed automatically, so that I see trouble without asking. | P1 | EPIC-002 |
| US-EVT-4 | As a Head, I want a portfolio view of active events, so that I can jump between concerts my division serves. | P1 | EPIC-002 |

**Acceptance:** An event moves through Planning → Pre-production → Promotion → Show week → Show day → Settlement; countdown and phase render in the workspace header; health status derives from the deterministic rule in PRD Appendix B and updates on task/budget change; archived events disappear from default views but stay queryable.

---

## 3. Tasks Core & Collaboration — EPIC-003

| ID | Story | Priority | Epic |
| --- | --- | --- | --- |
| US-TASK-1 | As a Staff member, I want My Tasks (today / this week / overdue) as my landing page, so that I always know what to do next. | P0 | EPIC-003 |
| US-TASK-2 | As a Head, I want a kanban board per division per event (Backlog → To do → In progress → In review → Blocked → Done), so that division workload is visible at a glance. | P0 | EPIC-003 |
| US-TASK-3 | As a Staff member, I want tasks with assignees, watchers, priority, dates, checklist, labels, and attachments, so that a task carries everything needed to execute it. | P0 | EPIC-003 |
| US-TASK-4 | As a Staff member, I want to comment with @mentions, so that discussion lives on the task instead of in chat. | P0 | EPIC-003 |
| US-TASK-5 | As a Head, I want to request a handoff to another division, and as the receiving Head accept it into my board as a linked dependency, so that cross-division requests never get lost. | P0 | EPIC-003 |
| US-TASK-6 | As a Staff member, I want in-app notifications (assigned, mentioned, due soon, unblocked, handoff), so that I react without polling boards. | P0 | EPIC-003 |
| US-TASK-7 | As a Staff member, I want dependencies (blocked by / blocks) and recurring tasks, so that sequenced and repeating work models reality. | P1 | EPIC-003 |

**Acceptance:** A task's full lifecycle works end-to-end scoped by division+event; My Tasks shows exactly the signed-in user's assignments bucketed by due date; a handoff accepted by the receiving Head appears on their board linked as a dependency on the origin task; notifications arrive over SSE in under ~5s without page reload; all mutations respect the central permission module.

---

## 4. Approvals Engine — EPIC-004

| ID | Story | Priority | Epic |
| --- | --- | --- | --- |
| US-APPR-1 | As a Staff member, I want to submit a request (expense, offer, contract, content) into a typed approval chain, so that sign-off is structured, not ad-hoc. | P0 | EPIC-004 |
| US-APPR-2 | As an approver, I want to approve / reject / request changes with a comment, so that decisions carry context. | P0 | EPIC-004 |
| US-APPR-3 | As an Owner, I want chains and thresholds configurable per type (per PRD Appendix B defaults), so that policy changes don't need code changes. | P1 | EPIC-004 |
| US-APPR-4 | As a requester, I want to see where my request sits in the chain and its full history, so that I never chase status by chat. | P1 | EPIC-004 |

**Acceptance:** Chain resolution matches PRD Appendix B for every type; a request advances only when the current step decides; reject/request-changes returns it to the requester with the comment; the full step history is retained and visible; approvers are notified on request, requesters on decision.

---

## 5. Budgets & Expenses — EPIC-005

| ID | Story | Priority | Epic |
| --- | --- | --- | --- |
| US-BUD-1 | As a Finance member, I want a budget per event broken into division budget lines, so that spend has a structure to land in. | P0 | EPIC-005 |
| US-BUD-2 | As a Staff member, I want to file an expense request (amount, vendor, justification, quote attachment) that flows into the approval engine, so that spending is controlled. | P0 | EPIC-005 |
| US-BUD-3 | As an Owner, I want committed vs actual vs budget per event and portfolio-wide, so that burn is visible before it's a problem. | P0 | EPIC-005 |
| US-BUD-4 | As a Head, I want to see only my division's budget lines, so that financial visibility follows the permission model. | P0 | EPIC-005 |

**Acceptance:** An approved expense moves budget from available → committed → actual; totals reconcile at line, division, event, and portfolio levels; visibility follows PRD Appendix B (Owner/Admin/Finance all; Head own division only; Staff and External none); every financial mutation is in the activity log.

---

## 6. Executive Dashboard & Activity Log — EPIC-006

| ID | Story | Priority | Epic |
| --- | --- | --- | --- |
| US-EXEC-1 | As an Owner, I want portfolio cards (countdown, phase, health, budget burn %) for every active event, so that one screen answers "how are we doing". | P0 | EPIC-006 |
| US-EXEC-2 | As an Owner, I want my pending approvals inline with one-click approve/reject + comment, so that I unblock the org fast. | P0 | EPIC-006 |
| US-EXEC-3 | As a user, I want email **and WhatsApp** notifications for the matrix in PLAN §6.10 (Owner decision 2026-08-06), so that I hear about assignments and decisions even when signed out. | P0 | EPIC-006 |
| US-EXEC-4 | As an Owner, I want upcoming milestones (14 days), cross-division blockers, and a recent-activity feed, so that risk surfaces before show week. | P1 | EPIC-006 |
| US-EXEC-5 | As an Admin, I want a filterable audit log UI, so that any action can be traced. | P1 | EPIC-006 |

**Acceptance:** The dashboard is the Owner's default landing; every widget links to its source records; inline approval actions are the same service calls as EPIC-004 (no parallel path); emails send via SMTP for each matrix trigger with per-user opt-outs where marked opt-in; the audit UI filters by actor, entity, event, and date.

---

## 7. External Guest Portal — EPIC-007

| ID | Story | Priority | Epic |
| --- | --- | --- | --- |
| US-EXT-1 | As a Head, I want to invite an external collaborator by email scoped to one event + my division + explicit assignments, so that outsiders work inside the system safely. | P0 | EPIC-007 |
| US-EXT-2 | As an External collaborator, I want magic-link sign-in with no password, so that participating is frictionless. | P0 | EPIC-007 |
| US-EXT-3 | As an External collaborator, I want to update status, comment, upload deliverables, and fill structured forms (quotation / technical rider / logistics manifest / crew list), so that my input lands where the team works. | P0 | EPIC-007 |
| US-EXT-4 | As a Head, I want every external submission in a review queue (accept / request changes), so that nothing external enters unreviewed. | P0 | EPIC-007 |
| US-EXT-5 | As an Admin, I want invites to expire (default 7 days post-settlement) and be revocable anytime, with all guest actions audited, so that access never outlives its purpose. | P0 | EPIC-007 |

**Acceptance:** A guest sees only their assigned tasks/forms in their one event+division — never budgets, other vendors, or internal tasks (asserted by scoping tests); submissions land in the owning division's review queue and notify reviewers; expiry and revocation cut access immediately; every guest action is in the audit log.

---

## 8. Planning Views, Documents & Run of Show — EPIC-008

| ID | Story | Priority | Epic |
| --- | --- | --- | --- |
| US-PLAN-1 | As a Head, I want a per-event Gantt timeline with dependencies, so that the critical path to show day is visible. | P1 | EPIC-008 |
| US-PLAN-2 | As a Staff member, I want a calendar of deadlines, milestones, and show dates, so that time-based planning has one view. | P1 | EPIC-008 |
| US-PLAN-3 | As a Head, I want a per-event document library (contracts, permits, riders, stage plots) with division-level access, so that show-critical documents aren't in inboxes. | P1 | EPIC-008 |
| US-PLAN-4 | As a Production/Ops member, I want a minute-by-minute run of show readable by all divisions and printable, so that show day runs off one rundown. | P1 | EPIC-008 |

**Acceptance:** Timeline reflects task dates+dependencies live; calendar aggregates per event and across events; document access respects division scoping; run of show is editable by Production/Ops, read-only for others, and exports print-cleanly.

---

## 9. Playbooks & Ticket Snapshots — EPIC-009

| ID | Story | Priority | Epic |
| --- | --- | --- | --- |
| US-TMPL-1 | As an Admin, I want an editable "International Concert" template of per-division checklists with lead times, so that a new event starts with proven structure. | P1 | EPIC-009 |
| US-TMPL-2 | As an Admin, I want creating an event from a template to generate its tasks automatically (dates offset from show day), so that setup takes minutes, not days. | P1 | EPIC-009 |
| US-TMPL-3 | As a Ticketing member, I want daily manual ticket-sales snapshots per event, so that the Owner's dashboard shows sales without an API. | P1 | EPIC-009 |

**Acceptance:** Template-generated tasks land in the right divisions with due dates computed from show-day offsets; edits to templates don't mutate past events; snapshots chart on the executive dashboard.

---

## 10. Reports, Search & Polish — EPIC-010

| ID | Story | Priority | Epic |
| --- | --- | --- | --- |
| US-POL-1 | As an internal user, I want an opt-in daily digest and the Owner a weekly executive digest, so that email summarizes without spamming. | P2 | EPIC-010 |
| US-POL-2 | As a Finance member, I want an event settlement report (budget vs actual, approvals, outstanding items) exportable, so that closing an event is a document, not a scramble. | P2 | EPIC-010 |
| US-POL-3 | As any user, I want global search (⌘K) across tasks, events, files, and people scoped by my permissions, so that anything is two keystrokes away. | P2 | EPIC-010 |
| US-POL-4 | As a Staff member, I want the app usable on my phone during show week (PWA polish), so that backstage work doesn't need a laptop. | P2 | EPIC-010 |

**Acceptance:** Digests respect opt-ins and send on schedule; settlement report totals reconcile with EPIC-005 data; search never returns records the user couldn't open; core flows pass a mobile viewport check.

---

## 11. Dependency Bottlenecks & External Waits — EPIC-012

| ID | Story | Priority | Epic |
| --- | --- | --- | --- |
| US-DEP-1 | As a division member, I want to add a dependency on any task in any division or event, so that my wait is tracked instead of remembered. | P1 | EPIC-012 |
| US-DEP-2 | As a blocking team, we want to see and be notified that others wait on our task, so that we know we are the bottleneck. | P1 | EPIC-012 |
| US-DEP-3 | As the Owner/CEO, I want a ranked red list of critical bottlenecks (who waits on whom, across divisions/events, auto-bumped to Urgent), so that the meeting starts with the right list. | P1 | EPIC-012 |
| US-DEP-4 | As a division member, I want to record a wait on an external party (no system access) and check it off myself when delivered, so that outside blockers are visible too. | P1 | EPIC-012 |

**Acceptance:** ≥3 open waiters (or ≥1 while the blocker is overdue/blocked) turns the blocker red, bumps priority to Urgent (logged, auto-reverting unless manually overridden), and ranks it on the Owner panel; external waits gate the "Unblocked" notification until checked off by any member of the task's division.

---

## 12. Backstage Play — EPIC-024 · EPIC-025 · EPIC-026

> PRD: [`PRD-GAME.md`](PRD-GAME.md). A data-driven 3D office; characters are not autonomous.

| ID | Story | Priority | Epic |
| --- | --- | --- | --- |
| US-PLAY-1 | As a staff member, I want to see the office as a 3D world where my desk holds my real tasks, so that I understand my day at a glance. | P1 | EPIC-024 |
| US-PLAY-2 | As a division head, I want to see at a glance which desk in my room has people waiting on it, so that I spot bottlenecks before the meeting. | P1 | EPIC-024 |
| US-PLAY-3 | As the Owner, I want to walk the whole office and open any task, person or event from where it physically is, so that the world is a real entry point and not a decoration. | P1 | EPIC-024 |
| US-PLAY-4 | As a staff member, I want to change status, comment and tick checklist items on my tasks from inside the world, so that I do not have to switch views to act on what I see. | P1 | EPIC-025 |
| US-PLAY-5 | As a division head or the Owner, I want pending handoffs and approvals to be visible as things happening in the office and decidable there, so that decisions do not wait for a board visit. | P1 | EPIC-025 |
| US-PLAY-6 | As any user, I want a change made by anyone anywhere in Backstage to appear in the world within seconds, so that the office reflects reality. | P1 | EPIC-025 |
| US-PLAY-7 | As a staff member, I want to earn XP and levels for finishing on time and unblocking others, so that doing the right work is visibly recognised. | P1 | EPIC-026 |
| US-PLAY-8 | As a staff member, I want daily quests made from my real tasks, so that the game points me at what actually matters today. | P1 | EPIC-026 |
| US-PLAY-9 | As a division head, I want to see my team's pulse and choose whether a leaderboard is shown, so that recognition motivates without shaming. | P1 | EPIC-026 |
| US-PLAY-10 | As the Owner, I want to tune rule weights, caps and seasons and see flagged gaming attempts, so that the incentives stay aligned with the business. | P1 | EPIC-026 |

**Acceptance:** the world shows exactly what the permission module allows and nothing moves without a data change; every in-world action leaves the same audit row as the app (plus `source: play`); XP is recomputable from `activity_log` and documented exploits score 0.

---

## Coverage Check

Every screen in PRD Appendix A maps to a domain above: Auth/Admin → §1, Events → §2, Tasks → §3, Approvals → §4, Budget → §5, Dashboard/Audit → §6, Guest/Review → §7, Timeline/Calendar/Documents/Run-of-show → §8, Templates/Snapshots → §9, Search/Polish → §10, Backstage Play (`PRD-GAME.md`) → §12. All domains are planned; none delivered yet.
