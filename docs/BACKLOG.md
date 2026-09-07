# RVC Backstage — Roadmap & Backlog

> A prioritized **seed list** of work, grouped by phase/epic. Sits last in the
> source-of-truth order: the backlog is *seeds only*. An item is "real" once it becomes
> an epic/task — at which point `docs/epics/` is canonical and **the epic wins** on any conflict.
>
> Machine-readable mirror: [`backlog.json`](backlog.json). Status of in-flight
> work is canonical in [`epics/README.md`](epics/README.md), not here.

**Priority:** **P0** = MVP-blocking · **P1** = core product · **P2** = follow-on / integration.
**MVP** = completion of **EPIC-000 → EPIC-003** (Phase 0 + Phase 1).

---

## Phase 0 · Bootstrap & Foundation _(EPIC-000)_

- [ ] **P0** (Infra) Next.js + Tailwind + shadcn/ui scaffold, repo layout, lint/test scripts
- [ ] **P0** (Infra) Docker Compose (app + Postgres + nginx), `.env.example`, health endpoint
- [ ] **P0** (Backend) Drizzle ORM + migrations + validated env loader
- [ ] **P0** (Frontend) RVC monochrome theme tokens (dark default), app shell, countdown component
- [ ] **P1** (Infra) CI on PR + develop; gates wired to real commands

## Phase 1 · Auth, Org & Permissions _(EPIC-001)_

- [ ] **P0** (Backend) Org schema (profiles, divisions, membership) + 11-division seed
- [ ] **P0** (Full-stack) Auth.js credentials sign-in + login page
- [ ] **P0** (Backend) Central permission module with full matrix test suite
- [ ] **P0** (Full-stack) Admin UI for users/divisions/roles
- [ ] **P1** (Backend) Activity log foundation

## Phase 1 · Events Workspace _(EPIC-002)_

- [ ] **P0** (Full-stack) Events CRUD + lifecycle phases + poster upload
- [ ] **P0** (Frontend) Workspace shell with countdown + phase indicator
- [ ] **P1** (Backend) Auto health status (On track / At risk / Critical)
- [ ] **P1** (Frontend) Portfolio gallery of active events

## Phase 1 · Tasks Core & Collaboration _(EPIC-003)_

- [ ] **P0** (Full-stack) Task schema + CRUD, statuses, priorities, checklist, labels
- [ ] **P0** (Frontend) Kanban per division per event + list with saved filters
- [ ] **P0** (Frontend) My Tasks landing (today / week / overdue)
- [ ] **P0** (Full-stack) Comments with @mentions + attachments
- [ ] **P0** (Full-stack) Cross-division handoff request/accept
- [ ] **P0** (Full-stack) In-app notifications over SSE
- [ ] **P1** (Backend) Dependencies + recurring tasks

## Phase 2 · Approvals Engine _(EPIC-004)_

- [ ] **P0** (Backend) Approval schema + configurable chains/thresholds
- [ ] **P0** (Full-stack) Request flow + approver queue + history
- [ ] **P1** (Backend) Approval notification triggers

## Phase 2 · Budgets & Expenses _(EPIC-005)_

- [ ] **P0** (Full-stack) Budgets → division lines; visibility rules
- [ ] **P0** (Full-stack) Expense requests wired to approval chains; committed vs actual
- [ ] **P1** (Frontend) Budget rollup views (event / division / portfolio)

## Phase 2 · Executive Dashboard & Activity Log _(EPIC-006)_

- [ ] **P0** (Frontend) Portfolio cards + inline approvals queue (Owner landing)
- [ ] **P0** (Backend) Email notifications (SMTP) per notification matrix
- [ ] **P1** (Backend) WhatsApp notification adapter (Owner decision 2026-08-06)
- [ ] **P1** (Frontend) Milestones/blockers/overdue widgets + activity feed
- [ ] **P1** (Frontend) Audit log UI

## Phase 3 · External Guest Portal _(EPIC-007)_

- [ ] **P0** (Full-stack) Magic-link invites scoped event+division+assignment; expiry + revocation
- [ ] **P0** (Full-stack) Guest portal (assigned tasks, comments, uploads)
- [ ] **P0** (Full-stack) Structured forms (quotation / rider / manifest / crew list)
- [ ] **P0** (Full-stack) Review queue (accept / request changes)
- [ ] **P1** (Backend) Guest hardening: rate limits, fuzz tests, full audit

## Phase 3 · Planning Views, Documents & Run of Show _(EPIC-008)_

- [ ] **P1** (Frontend) Gantt timeline with critical path
- [ ] **P1** (Frontend) Calendar view
- [ ] **P1** (Full-stack) Per-event document library with division access
- [ ] **P1** (Full-stack) Run of show editor + print/export

## Phase 3 · Playbooks & Ticket Snapshots _(EPIC-009)_

- [ ] **P1** (Full-stack) Event template editor + "International Concert" playbook
- [ ] **P1** (Backend) Generate event tasks from template (show-day offsets)
- [ ] **P1** (Full-stack) Daily ticket sales snapshots + dashboard chart

## Phase 4 · Reports, Search & Polish _(EPIC-010)_

- [ ] **P2** (Backend) Daily + weekly executive digests
- [ ] **P2** (Full-stack) Event settlement report + export
- [ ] **P2** (Full-stack) Global search (⌘K), permission-scoped
- [ ] **P2** (Frontend) Mobile/PWA polish

## Phase 5 · Backstage Play — gamified 3D office _(EPIC-024 → EPIC-026, PRD-GAME.md)_

- [ ] **P1** (Full-stack) `/play` route + `play.view` capability + feature flag (T-240)
- [ ] **P1** (Frontend) Engine port from the racing prototype into `src/lib/play/engine` (T-241)
- [ ] **P1** (Backend) Permission-scoped world snapshot with cursor (T-242)
- [ ] **P1** (Frontend) Deterministic office layout + characters/props + task visual mapping (T-243 … T-245)
- [ ] **P1** (Frontend) Camera, picking, click-through to existing modals; perf smoke gate (T-246, T-247)
- [ ] **P1** (Full-stack) Activity SSE stream + diff animations; quick actions via existing services (T-250, T-251)
- [ ] **P1** (Full-stack) Handoff couriers, approval room, event boards, "my day" focus (T-252 … T-254)
- [ ] **P1** (Frontend) Touch tier, reduced motion, no-WebGL fallback (T-255, T-256)
- [ ] **P1** (Backend) `play_*` schema + recomputable XP rules engine + anti-gaming guards (T-260, T-261, T-266)
- [ ] **P1** (Full-stack) Daily quests, levels/badges/cosmetics, team pulse + opt-in leaderboard, Owner controls (T-262 … T-265)

---

### Promotion flow

```
backlog seed (here / backlog.json)
   → promoted to an epic task  (docs/epics/EPIC-XXX-*.md, a ### task group)
   → epic + epics/README.md status become canonical
```

If this file and an epic disagree, **trust the epic**. Keep this list lean: prune
seeds once they are delivered or abandoned.
