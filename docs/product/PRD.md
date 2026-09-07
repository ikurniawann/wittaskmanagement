# RVC Backstage — Task management for an international-scale concert promoter

> **Status:** DRAFT — requirements only. Implementation decomposition lives in `docs/epics/` + `docs/product/ENGINEERING-TASKS.md`.
> **Version:** 0.1 · **Author:** ilham@wit.id · **Synthesized from:** `docs/PLAN.en.md` / `docs/PLAN.id.md` (2026-08)

---

## Problem

Raw Vision Collective (RVC) runs international-scale concerts with 11 divisions (Talent, Production, Ops, Security, Hospitality, Marketing, Ticketing, Sponsorship, Finance, Legal, HR) plus external vendors, artist management, venues, and sponsors. Today, work coordination lives in WhatsApp threads and spreadsheets: cross-division requests get lost, external submissions (quotes, riders, manifests) arrive by email with no review trail, and the Owner has no single view of portfolio health, budget burn, or the approvals waiting on them.

The cost of leaving this unsolved: missed permit lead times, double-booked crews, untracked spending against event budgets, and show-week firefighting that depends on individual memory instead of a system.

## Evidence

- The organizational structure, division responsibilities, and approval chains are documented first-hand in `docs/PLAN.en.md` §3–§6.
- The RVC public site (rawvision.demo-wit.id) defines a strong design language the tool must match for internal adoption.
- **Gap:** exact approval thresholds, notification channel needs, and ticketing-API availability — `Assumption — needs validation via Owner interview` (PRD Open Questions).

## Users

- **Primary — Division Staff**: execute tasks for their division across events. Triggered by assignments, due dates, and handoffs. Must understand "My Tasks → do → done" in under 5 minutes.
- **Primary — Division Head**: plans their division's work per event, assigns, approves tier-1 expenses, invites external collaborators, reviews submissions.
- **Primary — Owner / CEO**: final approvals (high-value expenses, contracts, artist offers), executive dashboard, full visibility.
- **Secondary — Admin**: user/division/settings management, event creation, audit access.
- **Tertiary — External collaborators** (vendors, artist management, venue, sponsor reps, freelance crew): scoped guest access — assigned tasks + structured forms only, per event.
- **Not for**: ticket buyers / the public — this is an internal ops tool; no public surface beyond magic-link guest access.

## Hypothesis

We believe a **division-scoped, event-centric task workspace with first-class cross-division handoffs, an approval engine, and a scoped guest portal** will **replace WhatsApp/spreadsheet coordination with auditable, owned work** for **RVC's divisions and their external collaborators**.

We'll know we're right when **staff adopt My Tasks as their daily landing page**, and **every expense over threshold flows through the in-app approval chain** within one event cycle.

## Success Metrics

| Metric | Target | How measured |
| --- | --- | --- |
| Staff onboarding time to first completed task | < 5 minutes | Onboarding observation / activity log |
| Cross-division requests tracked in-system (vs chat) | > 90% | Handoff count vs reported out-of-band requests |
| Expenses above threshold going through approval engine | 100% | Finance reconciliation vs `approvals` records |
| External submissions with review decision inside the system | 100% | Review-queue audit |

> Targets are `TBD — needs validation via Owner`. Listed as directional, not committed.

## Scope

**MVP (target)** — Phase 1: auth + org structure + central permission module, events workspace with RVC monochrome theme and countdown, tasks (list + kanban + My Tasks), comments/@mentions, attachments, cross-division handoffs, in-app (SSE) notifications. This is **EPIC-000 → EPIC-003**.

**Post-MVP (planned)**:

- **EPIC-004 — Approvals Engine**: configurable multi-step chains (expense tiers, artist offers, contracts, sponsorship, public content).
- **EPIC-005 — Budgets & Expenses**: event budgets → division lines → expense requests; committed vs actual.
- **EPIC-006 — Executive Dashboard & Activity Log**: portfolio cards, inline approvals queue, email notifications, audit UI.
- **EPIC-007 — External Guest Portal**: magic-link invites, structured forms (quotation / rider / manifest / crew list), review queue.
- **EPIC-008 — Planning Views, Documents & Run of Show**: Gantt timeline, calendar, per-event document library, minute-by-minute run of show.
- **EPIC-009 — Event Playbooks & Ticket Snapshots**: "International Concert" template generation, daily ticket sales snapshots.
- **EPIC-010 — Reports, Search & Polish**: digests, settlement report, global search, PWA polish.
- **EPIC-024 → EPIC-026 — Backstage Play** (Phase 5, 2026-09-07): a gamified 3D office generated from the same data and services — see [`PRD-GAME.md`](PRD-GAME.md).

**Out of scope (v1)**

- **Ticketing platform API integration** — Owner confirmed manual daily snapshots suffice for MVP (2026-08-06).
- **Telegram notifications** — out; **WhatsApp is IN scope** (Owner decision 2026-08-06, T-064 in EPIC-006).
- **Multi-brand / multi-organization support** — single org (RVC) for v1; schema must not preclude it later (Owner decision 2026-08-06).
- **Native mobile apps** — responsive web + PWA polish instead.

## Delivery Milestones

| # | Milestone (Epic) | Outcome | Status | Plan |
| --- | --- | --- | --- | --- |
| 0 | EPIC-000 Bootstrap & Foundation | Repo, app scaffold, DB, theme tokens, CI, gates green | on-progress | `docs/epics/EPIC-000-bootstrap.md` |
| 1 | EPIC-001 Auth, Org & Permissions | Staff login, 11 divisions, 5 roles enforced centrally | backlog | `docs/epics/EPIC-001-auth-org-permissions.md` |
| 2 | EPIC-002 Events Workspace | Event CRUD, lifecycle, countdown, health status | backlog | `docs/epics/EPIC-002-events-workspace.md` |
| 3 | EPIC-003 Tasks Core & Collaboration | Tasks, kanban, My Tasks, comments, handoffs, SSE notifications | backlog | `docs/epics/EPIC-003-tasks-collaboration.md` |
| 4 | EPIC-004 Approvals Engine | Configurable multi-step approval chains | backlog | `docs/epics/EPIC-004-approvals-engine.md` |
| 5 | EPIC-005 Budgets & Expenses | Budget lines, expense requests, committed vs actual | backlog | `docs/epics/EPIC-005-budgets-expenses.md` |
| 6 | EPIC-006 Executive Dashboard & Activity Log | Owner cockpit, email notifications, audit UI | backlog | `docs/epics/EPIC-006-executive-dashboard.md` |
| 7 | EPIC-007 External Guest Portal | Magic-link guests, structured forms, review queue | backlog | `docs/epics/EPIC-007-external-guest-portal.md` |
| 8 | EPIC-008 Planning Views, Docs & Run of Show | Gantt, calendar, document library, run of show | backlog | `docs/epics/EPIC-008-planning-views-run-of-show.md` |
| 9 | EPIC-009 Playbooks & Ticket Snapshots | Template-generated checklists, sales snapshots | backlog | `docs/epics/EPIC-009-playbooks-ticket-snapshots.md` |
| 10 | EPIC-010 Reports, Search & Polish | Digests, settlement report, global search, PWA | backlog | `docs/epics/EPIC-010-reports-search-polish.md` |

## Open Questions

Answered by the Owner on **2026-08-06**:

- [x] **Currency** — **IDR is the default.** Threshold *numbers* still use the proposed defaults (A = Rp 10.000.000, B = Rp 100.000.000) until the Owner supplies final figures — they are org-settings values, changeable without code.
- [x] **Notification channels** — **email + WhatsApp.** WhatsApp is now in scope as a first-class channel (added as T-064 in EPIC-006); Telegram stays out.
- [x] **Ticketing** — **manual daily snapshots are sufficient for MVP.** No platform API integration in v1 (EPIC-009 stays manual-entry).
- [x] **Multi-brand** — **single org (RVC) for now, but multi-brand must remain possible.** Schema decisions must not preclude adding an `organizations` scope later: no global uniques that would collide across brands beyond user email, org-wide config lives in `app_settings` (per-org table split is a clean migration), and the permission module keeps org resolution in one place.

Remaining open: final approval threshold figures (Owner) and the WhatsApp provider choice (Business Cloud API vs gateway) — both config-level, neither blocks a build.

## Risks

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Permission model bugs leak cross-division/financial data | M | H | Single central authz module (protected path), scoping tests per query, security gate |
| External guest access abused or over-scoped | M | H | Magic-link expiry, event+division+assignment scoping, review queue, audit log, revocation |
| Adoption fails (staff stay on WhatsApp) | M | H | < 5-min My Tasks flow, playbook templates, handoffs replace chat requests |
| Single-server self-hosting outage during show week | L | H | Docker Compose reproducibility, documented backup/restore, health checks |
| Scope creep before MVP ships | H | M | Phase gates: EPIC-000→003 first; backlog seeds stay seeds until promoted |

---

## Appendix A — Product Surface (screens → epic ownership)

| # | Page (route) | Domain | Owning Epic | Status |
| --- | --- | --- | --- | --- |
| 1 | Login / magic-link (`/login`, `/guest`) | Auth | EPIC-001 / 007 | planned |
| 2 | Admin: users & divisions (`/admin`) | Org | EPIC-001 | planned |
| 3 | Events portfolio (`/events`) | Events | EPIC-002 | planned |
| 4 | Event workspace shell (`/events/[id]`) | Events | EPIC-002 | planned |
| 5 | My Tasks (`/my-tasks`) | Tasks | EPIC-003 | planned |
| 6 | Kanban / List (`/events/[id]/board`) | Tasks | EPIC-003 | planned |
| 7 | Task detail (drawer/modal) | Tasks | EPIC-003 | planned |
| 8 | Approvals queue (`/approvals`) | Approvals | EPIC-004 | planned |
| 9 | Budget (`/events/[id]/budget`) | Finance | EPIC-005 | planned |
| 10 | Executive dashboard (`/dashboard`) | Exec | EPIC-006 | planned |
| 11 | Activity log (`/admin/audit`) | Audit | EPIC-006 | planned |
| 12 | Guest portal (`/guest/*`) | External | EPIC-007 | planned |
| 13 | Review queue (`/events/[id]/submissions`) | External | EPIC-007 | planned |
| 14 | Timeline / Calendar (`/events/[id]/timeline`, `/calendar`) | Planning | EPIC-008 | planned |
| 15 | Documents (`/events/[id]/documents`) | Docs | EPIC-008 | planned |
| 16 | Run of show (`/events/[id]/run-of-show`) | Show ops | EPIC-008 | planned |
| 17 | Templates admin (`/admin/templates`) | Playbooks | EPIC-009 | planned |
| 18 | Ticket snapshots (`/events/[id]/ticket-sales`) | Sales | EPIC-009 | planned |
| 19 | Global search (⌘K) | Search | EPIC-010 | planned |

## Appendix B — Core Domain Rules (authoritative, deterministic)

```
Event health:
  CRITICAL if overdue_tasks > X OR blocked_tasks on critical path OR budget_actual > budget_total
  AT_RISK  if overdue_tasks > 0 OR budget_committed > 90% of budget_total
  ON_TRACK otherwise
  (X and % configurable in org settings; recomputed by cron + on task/budget change)

Approval chain resolution (defaults; thresholds configurable):
  expense <= A            → [Division Head]
  A < expense <= B        → [Division Head, Finance]
  expense > B             → [Division Head, Finance, Owner]
  artist_offer            → [Talent Head, Finance, Owner]
  contract                → [Legal, Owner]
  sponsorship_deal        → [Sponsorship Head, Legal, Owner]
  public_content          → [Marketing Head]

Visibility (enforced ONLY via src/lib/permissions):
  Staff    → own division's tasks (all events) + anything assigned/watched
  Head     → own division full + cross-division summaries
  External → assigned tasks + own forms, single event+division, nothing financial
  Finance/Owner/Admin → all financial data; Head → own division's budget lines only
```

## Appendix C — Tech Stack (locked decisions)

- **Repo:** single-app
- **Frontend/Backend:** Next.js (App Router, TypeScript) + Tailwind + shadcn/ui restyled to RVC monochrome
- **Database:** PostgreSQL (local, self-hosted) + Drizzle ORM + migrations
- **Auth:** Auth.js (NextAuth v5) — credentials for staff, magic link for external guests
- **Authorization:** central permission module in the service layer (`src/lib/permissions`) — protected path
- **Realtime:** SSE (server-sent events)
- **Files:** server disk `/uploads`, nginx-served, auth-gated
- **Email:** SMTP (company SMTP or Resend)
- **Jobs:** node-cron in-process (due reminders, digests, health recompute)
- **Infra:** Docker Compose (Next.js + Postgres + nginx) on the company server — DEV deploys only from automation
