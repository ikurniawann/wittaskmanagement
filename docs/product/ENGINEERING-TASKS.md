# RVC Backstage — Engineering Task Breakdown

> Companion to `PRD.md` + `USER-STORIES.md`. Decomposes the epics in `docs/epics/`
> into engineering tasks. Sits 4th in the source-of-truth order: it records *intent*
> (what should be built), while `docs/epics/` records the *live state* and wins on conflict.
>
> Columns: **ID** `T-XXX` (stable, never renumber; numbered in blocks of 10 per epic) ·
> **Type** `FE` / `BE` / `FS` (full-stack) / `Infra` · **Cx** `S` ≤1d · `M` 2–4d · `L` ≥1w ·
> **Depends** · **Exit** (observable proof) · **Stories** (`US-XXX`).

---

## EPIC-000 — Bootstrap & Foundation (Phase 0)

| ID | Task | Type | Cx | Depends | Exit | Stories |
| --- | --- | --- | --- | --- | --- | --- |
| T-001 | Scaffold Next.js (App Router, TS) + Tailwind + shadcn/ui; repo layout `src/{app,lib,db,components}`; lint/typecheck/test scripts | Infra | M | — | `pnpm build` + `pnpm lint` green from clean clone | — |
| T-002 | Docker Compose: app + Postgres + nginx; `.env.example`; `/api/health` endpoint; volumes + healthchecks | Infra | M | T-001 | `scripts/deploy-dev.sh` brings stack up; health URL returns 200 | — |
| T-003 | Drizzle ORM + migration pipeline + seed script skeleton; validated env loader (boot fails fast on missing vars) | BE | M | T-002 | `drizzle-kit` migration applies to local PG; boot fails with clear error when env var missing | — |
| T-004 | RVC monochrome theme foundation: design tokens (dark default + light), typography scale, ↗ motif components, app shell layout | FE | M | T-001 | Shell renders both themes; tokens documented; no hardcoded colors outside tokens | — |
| T-005 | CI pipeline (lint + typecheck + build + test) on PR + `develop` | Infra | S | T-001 | CI red on an intentionally broken PR; green on clean | — |
| T-006 | Wire gate scripts to real project commands; countdown-timer shared component | FS | S | T-004 | `scripts/{qa,test,security-check}.sh` run real checks and pass | — |

**Exit:** clean clone → install → build → compose up → healthy, with CI and gates green. Ties to `docs/epics/EPIC-000-bootstrap.md`.

---

## EPIC-001 — Auth, Org & Permissions (Phase 1)

| ID | Task | Type | Cx | Depends | Exit | Stories |
| --- | --- | --- | --- | --- | --- | --- |
| T-010 | Schema: `profiles`, `divisions`, `division_members` (user+division+role); migration + seed of 11 divisions | BE | S | T-003 | Migration applies; seed idempotent | US-AUTH-2 |
| T-011 | Auth.js v5 credentials sign-in for staff; session strategy; login page in RVC theme | FS | M | T-010 | Seeded users of all 5 roles can sign in/out; wrong password rejected | US-AUTH-1 |
| T-012 | Central permission module `src/lib/permissions`: role×division×event capability checks per PLAN §4 matrix; unit tests per matrix row | BE | L | T-010 | Matrix test suite passes incl. negative cases (cross-division read denied) | US-AUTH-3 |
| T-013 | Admin UI: users, divisions, memberships, role assignment | FS | M | T-011, T-012 | Admin creates user + assigns Head; Staff cannot open `/admin` | US-AUTH-2 |
| T-014 | `activity_log` table + write helper; log auth + permission + admin mutations | BE | S | T-010 | Every admin mutation produces a log row (who/what/when) | US-AUTH-4 |
| T-015 | Demo seed: users per role across 3 divisions + fixture event data for dev | BE | S | T-013 | `pnpm seed` produces a workable demo org | — |

**Exit:** all five roles sign in; the permission matrix is enforced by `src/lib/permissions` with tests; admin manages the org; sensitive actions audited.

---

## EPIC-002 — Events Workspace (Phase 1)

| ID | Task | Type | Cx | Depends | Exit | Stories |
| --- | --- | --- | --- | --- | --- | --- |
| T-020 | Schema: `events`, `event_divisions`; lifecycle phase enum; migration | BE | S | T-010 | Migration applies; phases constrained to PLAN §6.1 order | US-EVT-1 |
| T-021 | Events CRUD + archive (Owner/Admin only) + poster upload to `/uploads` (auth-gated) | FS | M | T-020, T-012 | Admin creates event w/ poster; Staff create attempt denied; archive hides from defaults | US-EVT-1 |
| T-022 | Event workspace shell: header with countdown to show day + phase indicator + poster | FE | M | T-021, T-006 | Countdown ticks live; phase advances via workspace control (Owner/Admin) | US-EVT-2 |
| T-023 | Health status compute (rule per PRD App. B): on-change hooks + node-cron recompute | BE | M | T-021 | Unit tests cover all three states; status updates when a task goes overdue | US-EVT-3 |
| T-024 | Events portfolio page: gallery grid of active events (poster, countdown, phase, health) | FE | S | T-022 | Portfolio renders per design language; links into workspaces | US-EVT-4 |

**Exit:** an event lives its full lifecycle in a themed workspace with live countdown and auto health status.

---

## EPIC-003 — Tasks Core & Collaboration (Phase 1)

| ID | Task | Type | Cx | Depends | Exit | Stories |
| --- | --- | --- | --- | --- | --- | --- |
| T-030 | Schema: `tasks`, `task_assignees`, `task_watchers`, `task_dependencies`, `task_checklist_items`, `labels`; migrations | BE | M | T-020 | Migrations apply; FKs + status enum per PLAN §6.3 | US-TASK-3 |
| T-031 | Task service + CRUD UI: status flow, priority, dates, checklist, labels — all through permission module | FS | L | T-030, T-012 | Staff manages own-division tasks; cross-division mutation denied (test) | US-TASK-3 |
| T-032 | List view with saved filters + kanban per division per event (drag-drop status) | FE | L | T-031 | Drag updates status + persists; filters saved per user | US-TASK-2 |
| T-033 | My Tasks landing (today / this week / overdue buckets); default post-login route for Staff | FE | M | T-031 | Buckets match seeded due dates exactly | US-TASK-1 |
| T-034 | Comments with @mention (typeahead scoped to visible users) + attachments on tasks | FS | M | T-031 | Mention notifies mentioned user; attachment download auth-gated | US-TASK-4 |
| T-035 | Dependencies (blocked by / blocks) + recurring task generation (cron) | BE | M | T-031 | Blocked task shows blocker; completing blocker fires "unblocked"; recurrence spawns next instance | US-TASK-7 |
| T-036 | Cross-division handoff: request → receiving Head accept/decline → linked task + dependency | FS | M | T-031, T-035 | Handoff flow per worked example in `ACCEPTANCE-CRITERIA.md`; External denied | US-TASK-5 |
| T-037 | In-app notifications: `notifications` table + SSE stream + bell UI; triggers per PLAN §6.10 (in-app column) | FS | M | T-031 | Notification arrives < 5s without reload for assign/mention/due/unblocked/handoff | US-TASK-6 |

**Exit:** MVP complete — a division runs its event work end-to-end (My Tasks → kanban → comments → handoffs → notifications) fully permission-scoped.

---

## EPIC-004 — Approvals Engine (Phase 2)

| ID | Task | Type | Cx | Depends | Exit | Stories |
| --- | --- | --- | --- | --- | --- | --- |
| T-040 | Schema: `approvals`, `approval_steps`; org settings for chain config + thresholds + currency | BE | M | T-012 | Chain resolution unit-tested against PRD App. B defaults | US-APPR-3 |
| T-041 | Approval service: create typed request, advance steps, approve/reject/request-changes with comment, full history | BE | M | T-040 | State machine tests: no skipping steps; terminal states immutable | US-APPR-1, US-APPR-2 |
| T-042 | Approval UI: request submission, approver queue (`/approvals`), request status/history view | FE | M | T-041 | Approver decides from queue; requester sees position + history | US-APPR-2, US-APPR-4 |
| T-043 | Notification triggers: approval requested → approver; decided → requester (in-app; email lands in T-062) | BE | S | T-041, T-037 | Both triggers fire with deep links | US-APPR-1 |

**Exit:** any request type flows its configured chain with retained history; approvers work from one queue.

---

## EPIC-005 — Budgets & Expenses (Phase 2)

| ID | Task | Type | Cx | Depends | Exit | Stories |
| --- | --- | --- | --- | --- | --- | --- |
| T-050 | Schema: `budgets`, `budget_lines`, `expense_requests`; migrations | BE | S | T-020 | Migrations apply; amounts stored as integer minor units | US-BUD-1 |
| T-051 | Budget setup UI per event → division lines; visibility rules via permission module | FS | M | T-050, T-012 | Head sees only own division's lines (test); Finance/Owner see all | US-BUD-1, US-BUD-4 |
| T-052 | Expense request flow wired into approvals engine; approved → committed; paid → actual | FS | M | T-051, T-041 | Threshold routes to correct chain; totals move available→committed→actual correctly | US-BUD-2 |
| T-053 | Budget views: per event, per division, portfolio rollup (committed vs actual vs budget) | FE | M | T-052 | Rollups reconcile with line data in tests | US-BUD-3 |

**Exit:** spend is structured, approved, and visible — no expense outside a chain.

---

## EPIC-006 — Executive Dashboard & Activity Log (Phase 2)

| ID | Task | Type | Cx | Depends | Exit | Stories |
| --- | --- | --- | --- | --- | --- | --- |
| T-060 | Executive dashboard: portfolio cards (countdown, phase, health, burn %) + pending approvals inline approve/reject | FE | L | T-024, T-042, T-053 | Owner lands here; inline decision uses the same approval service (no parallel path) | US-EXEC-1, US-EXEC-2 |
| T-061 | Dashboard widgets: milestones next 14d, cross-division blockers, overdue hotspots, activity feed | FE | M | T-060 | Each widget links to source records; counts match queries | US-EXEC-4 |
| T-062 | Email notifications via SMTP for PLAN §6.10 email column; per-user preferences for opt-ins | BE | M | T-037, T-043 | Emails send for each trigger in dev (mailpit/console transport); opt-out honored | US-EXEC-3 |
| T-063 | Audit log UI (`/admin/audit`): filter by actor, entity, event, date | FE | S | T-014 | Filters work; Staff denied access | US-EXEC-5 |
| T-064 | WhatsApp notification channel (Owner decision 2026-08-06): provider adapter (Business Cloud API or gateway) behind the same notification service; mirror high-value triggers (assigned, approval requested/decided, due/overdue, external submission) with per-user opt-in; credentials via env | BE | M | T-062 | Trigger fires a WhatsApp message in dev (provider sandbox/mock); opt-out honored; no credentials in repo | US-EXEC-3 |

**Exit:** the Owner runs the portfolio from one screen; email + WhatsApp keep everyone current; every action is traceable.

---

## EPIC-007 — External Guest Portal (Phase 3)

| ID | Task | Type | Cx | Depends | Exit | Stories |
| --- | --- | --- | --- | --- | --- | --- |
| T-070 | Schema: `external_invites`, `form_templates`, `form_submissions`; migrations | BE | S | T-030 | Migrations apply; invite carries event+division+assignment scope + expiry | US-EXT-1 |
| T-071 | Magic-link auth (Auth.js email provider) for guests; invite issue/revoke UI for Heads; expiry job (default 7d post-settlement) | FS | M | T-070, T-011 | Link signs guest in; revoked/expired link dead immediately | US-EXT-1, US-EXT-2, US-EXT-5 |
| T-072 | Guest portal: assigned tasks only — status update, comment, upload | FS | M | T-071, T-031 | Scoping tests: guest never sees budgets/other vendors/internal tasks | US-EXT-3 |
| T-073 | Structured form renderer + submission (quotation, technical rider, logistics manifest, crew list) | FS | L | T-071 | All four form types submit with validation; drafts persist | US-EXT-3 |
| T-074 | Review queue per division: accept / request changes + reviewer notifications | FS | M | T-073, T-037 | Decision round-trips to guest; nothing auto-accepted | US-EXT-4 |
| T-075 | Guest hardening pass: rate limits on magic links, audit of all guest actions, permission fuzz tests | BE | M | T-072, T-074 | Security gate + fuzz tests green; guest actions all in audit log | US-EXT-5 |

**Exit:** externals work inside the system, strictly scoped, reviewed, expirable, and audited.

---

## EPIC-008 — Planning Views, Documents & Run of Show (Phase 3)

| ID | Task | Type | Cx | Depends | Exit | Stories |
| --- | --- | --- | --- | --- | --- | --- |
| T-080 | Timeline (Gantt) per event: bars from task dates, dependency arrows, critical path to show day | FE | L | T-035 | Timeline reflects live task edits; critical path highlighted | US-PLAN-1 |
| T-081 | Calendar view: deadlines, milestones, show dates — per event and global | FE | M | T-031 | Calendar aggregates correctly; entries deep-link | US-PLAN-2 |
| T-082 | Document library per event (`documents` schema): upload, categorize (contract/permit/rider/stage plot), division-level access | FS | M | T-021, T-012 | Access respects division scope (test); files auth-gated | US-PLAN-3 |
| T-083 | Run of show: `run_of_show_items` schema + minute-by-minute editor (Production/Ops write, all read) + print/export view | FS | M | T-021 | Rundown edits restricted by division; print stylesheet clean | US-PLAN-4 |

**Exit:** planning and show-day operations run from the system, not spreadsheets.

---

## EPIC-009 — Playbooks & Ticket Snapshots (Phase 3)

| ID | Task | Type | Cx | Depends | Exit | Stories |
| --- | --- | --- | --- | --- | --- | --- |
| T-090 | Schema `event_templates` + template editor (per-division checklist items with show-day offsets) | FS | M | T-030 | Template CRUD works; items carry division + offset | US-TMPL-1 |
| T-091 | Author the default "International Concert" playbook content (all 11 divisions, lead times from PLAN §3 responsibilities) | — | M | T-090 | Playbook reviewed by a human; seeds cleanly | US-TMPL-1 |
| T-092 | Create-event-from-template: generate tasks with due dates offset from show day | BE | M | T-090, T-031 | Generated tasks land in right divisions with computed dates; template edits don't mutate past events | US-TMPL-2 |
| T-093 | Ticket sales snapshots: `ticket_sales_snapshots` schema + daily manual entry UI + executive dashboard chart | FS | M | T-060 | Ticketing staff enters dailies; Owner sees the curve | US-TMPL-3 |

**Exit:** a new concert bootstraps itself from the playbook; sales visibility without an API.

---

## EPIC-010 — Reports, Search & Polish (Phase 4)

| ID | Task | Type | Cx | Depends | Exit | Stories |
| --- | --- | --- | --- | --- | --- | --- |
| T-100 | Daily digest (opt-in, internal) + weekly executive digest (Owner) via cron + SMTP | BE | M | T-062 | Digests send on schedule with correct per-user content | US-POL-1 |
| T-101 | Event settlement report: budget vs actual, approval history, outstanding items; export (print/PDF) | FS | M | T-053 | Report totals reconcile with EPIC-005 data; exports clean | US-POL-2 |
| T-102 | Global search (⌘K) across tasks/events/files/people, permission-scoped | FS | L | T-031, T-082 | Search never returns records the user can't open (test) | US-POL-3 |
| T-103 | Mobile/PWA polish: manifest, responsive audit of core flows, offline-tolerant shell | FE | M | T-033 | Core flows pass mobile viewport checks; installable PWA | US-POL-4 |

**Exit:** the system closes events cleanly, finds anything fast, and works from a phone backstage.

---

## EPIC-012 — Dependency Bottlenecks & External Waits (Phase 4)

| ID | Task | Type | Cx | Depends | Exit | Stories |
| --- | --- | --- | --- | --- | --- | --- |
| T-120 | Schema `task_external_dependencies` + service: cross-event deps, full cycle detection, `removeDependency`, external check-off, unblock incl. external | BE | L | T-035, T-037 | Cross-division/event dep round-trips; no cycle of any length; unblock waits for external check-off | US-DEP-1, US-DEP-4 |
| T-121 | Bottleneck scoring (waiter fan-in, critical = ≥3 or overdue+≥1) + priority auto-bump with stored revert & manual-override guard | BE | M | T-120 | Scoring matrix unit-tested; bump + revert logged as `system` activity; manual change wins | US-DEP-3 |
| T-122 | Task drawer: "Blocked by" (internal + external, styled check-off) and "Blocking" sections, remove-edge, cross-event EventChip | FE | M | T-120 | Both directions visible/editable in drawer per no-basic-controls rule | US-DEP-1, US-DEP-2, US-DEP-4 |
| T-123 | Card badges (Waiting on N / N waiting-red), dashboard **Bottlenecks** ranked panel, blocker-team notification, cross-event list under Gantt | FS | M | T-121 | Owner sees ranked red list; blocking team notified once per new dependent | US-DEP-2, US-DEP-3 |
| T-124 | Tests: permission matrix, scoring/auto-bump units, cycle test, role-scoped E2E incl. bump-revert in activity log | — | M | T-121, T-122, T-123 | All gates green; E2E proves the full flow | all |

**Exit:** the team can point at the bottleneck; the Owner sees it ranked and red before the meeting does.

---

## EPIC-013 — Event Pages (Phase 4)

| ID | Task | Type | Cx | Depends | Exit | Stories |
| --- | --- | --- | --- | --- | --- | --- |
| T-130 | Event pages mini-wiki: `event_pages` schema (Tiptap JSON), list + editor routes, sidebar entry, image upload | FS | M | T-022 | Internal users create/edit pages; author/admin delete; autosave works; content stored as JSON | — |

**Exit:** every event carries editable pages for briefs and notes.

---

## EPIC-014 — AI Assistant (Phase 4)

| ID | Task | Type | Cx | Depends | Exit | Stories |
| --- | --- | --- | --- | --- | --- | --- |
| T-140 | AI assistant: `ai.assistant` capability, permission-scoped context gatherer, streaming OpenAI chat route, /assistant chat UI + sidebar entry | FS | L | T-012, T-120 | Leadership-only chat predicts event outcomes with grounded reasons; staff denied; key env-only | — |
| T-141 | Saved conversations: per-user groups + Ungrouped fallback, history panel, exchange persistence with X-Conversation-Id resume | FS | M | T-140 | Chats survive reload; cross-user access denied; group delete keeps chats | — |

**Exit:** leadership asks "will this event run smoothly?" and gets a grounded verdict with reasons and actions.

---

## EPIC-024 — Backstage Play: foundation (Phase 5)

> PRD: `PRD-GAME.md`. Engine ported from the racing prototype (`permainan.reddie.id/racing`). Read-only world; every click opens existing UI.

| ID | Task | Type | Cx | Depends | Exit | Stories |
| --- | --- | --- | --- | --- | --- | --- |
| T-240 | `play.view` capability (reviewed, protected path) + `play_enabled` flag + `/play` client-only page + sidebar entry | FS | S | T-012 | Flag off → 404; flag on + capability → renders; guest → 403 | US-PLAY-1 |
| T-241 | Engine port to `src/lib/play/engine/**` (MRT renderer, unified shader + materialFactory, 1-tap shadow, post pass, InstancedManager, ParticlePool, fixed loop + adaptive DPR); three@0.170 pinned; unit tests for pure parts | FE | L | T-240 | Demo scene renders through MRT + post; `pnpm test` green | US-PLAY-1 |
| T-242 | `getPlayWorld(actor)` permission-scoped snapshot + `GET /api/play/world` with `cursor` | BE | M | T-012, T-120 | Seed snapshot ≤ 200 KB; restricted tasks of other divisions absent (test) | US-PLAY-1, US-PLAY-3 |
| T-243 | Deterministic `layout(divisions, members)` → rooms/desks/corridors/lobby/approval room, seeded by division id | FE | M | — | Same input → same output; no overlaps; every desk reachable (tests) | US-PLAY-1 |
| T-244 | CC0 rigged character + prop glTF set; skinning chunks in unified shader; division tint + initials badge; 5 clips; props instanced | FE | L | T-241 | 60 characters + 400 props ≥ 50 fps p50 @1.0 DPR integrated GPU | US-PLAY-1 |
| T-245 | `mapTask(task, ctx)` visual-state mapping per PRD table (status colour, smoke, chain, ghost queue, critical aura) | FE | M | T-242, T-244 | Table test over 7 statuses × overdue × fan-in × critical; screenshots per state | US-PLAY-2 |
| T-246 | Isometric camera (mouse/keyboard/touch), instance-id picking, click → existing task modal / profile card / event page; deep link `?task=` | FE | M | T-245 | Click-through opens existing modal with identical permission outcome | US-PLAY-3 |
| T-247 | Quality tiers, F3 stats, `play.session` telemetry, Playwright SwiftShader smoke in `gates.test` (0 console errors, ≤ 300 draw calls) | Infra | S | T-246 | Smoke test fails on console error or > 300 draw calls | US-PLAY-1 |

**Exit:** the Owner walks the office and opens any visible task from its desk; a staff member sees exactly what the app lets them see.

---

## EPIC-025 — Backstage Play: live world & actions (Phase 5)

| ID | Task | Type | Cx | Depends | Exit | Stories |
| --- | --- | --- | --- | --- | --- | --- |
| T-250 | `GET /api/play/stream?cursor=` SSE of permission-filtered `activity_log` rows + pure `applyDiff` (activity kind → animation intent; unknown → refetch one task) | FS | M | T-242, T-037 | Change in tab A animates in tab B ≤ 5 s; diff table test per activity kind | US-PLAY-6 |
| T-251 | Quick-action panel: status, comment, checklist, claim via existing services with `metadata.source = "play"` | FS | M | T-246, T-031 | Activity row identical to app's except `source`; denied → same message | US-PLAY-4 |
| T-252 | Handoff couriers (A* along corridors) + approval room envelopes; decide via existing dialogs | FS | L | T-250, T-036, T-041 | Path never crosses walls; only actor's envelopes visible; decisions appear in app log | US-PLAY-5 |
| T-253 | Event lobby boards (countdown, phase, health) + WIB time-of-day lighting | FE | S | T-242 | Countdown equals event header to the second; visibility per EPIC-021 | US-PLAY-6 |
| T-254 | "My day" focus: camera to own desk, Today tray, `Tab` cycling, notification speech bubbles, `?focus=me` | FE | M | T-250 | Tray counts equal My Tasks and bell | US-PLAY-4 |
| T-255 | Touch controls + touch quality tier + portrait bottom-sheet layout | FE | M | T-247 | Mid-range Android ≥ 30 fps p50, 0 console errors (recorded) | US-PLAY-4 |
| T-256 | Reduced-motion mode, keyboard navigation, no-WebGL/context-lost fallback to `/dashboard`, canvas a11y label | FE | S | T-246 | Playwright WebGL-disabled test shows fallback; keyboard walkthrough verified | US-PLAY-6 |

**Exit:** a decision or status change made anywhere appears in the office within 5 s and can be acted on there with identical audit trail.

---

## EPIC-026 — Backstage Play: gamification (Phase 5)

| ID | Task | Type | Cx | Depends | Exit | Stories |
| --- | --- | --- | --- | --- | --- | --- |
| T-260 | Reviewed migration: `play_profiles`, `play_xp_ledger` (unique activity+rule), `play_badges`, `play_badge_awards`, `play_quests`, `play_seasons` + badge seed | BE | M | T-003 | Migration applies clean + dev; unique constraints present | US-PLAY-7 |
| T-261 | Rule table + pure `scoreActivity`, incremental hook after activity write, `recompute(userId)`, nightly drift job (02:00 WIB) | BE | L | T-260, T-120 | Per-rule tests; property test recompute == incremental; zero drift on fixture | US-PLAY-7 |
| T-262 | Daily quest generator (06:00 WIB) from real tasks/handoffs/approvals; completion from ledger; lobby notice board + My Tasks strip | FS | M | T-261 | Quests reference only visible objects; idempotent regeneration | US-PLAY-8 |
| T-263 | Level curve + level-up moment, badge awards, cosmetic unlocks rendered on character/desk, profile page section | FS | M | T-261, T-244 | Level-up once per threshold; badges never duplicated; cosmetics persist | US-PLAY-7 |
| T-264 | Team pulse panel, opt-in leaderboard, weekly recap (in-app + optional WhatsApp via EPIC-015) | FS | M | T-261 | Leaderboard hidden by default; recap respects opt-ins; numbers reconcile with ledger | US-PLAY-9 |
| T-265 | Admin → Play settings: flag, rule weights/caps (zod), leaderboard policy, season reset, flagged-activity report | FS | M | T-261, T-266 | Weight change applies without restart; season reset archives totals, keeps badges | US-PLAY-10 |
| T-266 | Anti-gaming guards as tested rules (reopen cooldown, 5-min self-tasks, bulk flips) + flag surfacing | BE | S | T-261 | Each documented exploit scores 0 XP in tests and appears in the report | US-PLAY-10 |

**Exit:** a scripted week of activity scores identically by recompute and incrementally; exploits score 0; nothing in `src/lib/play/xp/**` writes to tasks or approvals.

---

## Summary

| Epic | Tasks | FE | BE | FS | Infra | Heaviest dependency |
| --- | --- | --- | --- | --- | --- | --- |
| EPIC-000 | 6 | 1 | 1 | 1 | 3 | — |
| EPIC-001 | 6 | — | 4 | 2 | — | T-003 (Drizzle) |
| EPIC-002 | 5 | 2 | 2 | 1 | — | T-012 (permissions) |
| EPIC-003 | 8 | 3 | 2 | 3 | — | T-012, T-020 |
| EPIC-004 | 4 | 1 | 3 | — | — | T-037 (notifications) |
| EPIC-005 | 4 | 1 | 1 | 2 | — | T-041 (approvals) |
| EPIC-006 | 5 | 3 | 2 | — | — | T-042 + T-053 |
| EPIC-007 | 6 | — | 2 | 4 | — | T-011 (Auth.js) |
| EPIC-008 | 4 | 2 | — | 2 | — | T-035 (dependencies) |
| EPIC-009 | 4 | — | 1 | 3 | — | T-031 (task service) |
| EPIC-010 | 4 | 1 | 1 | 2 | — | T-062 (email) |
| EPIC-024 | 8 | 5 | 1 | 1 | 1 | T-241 (engine port), T-120 (fan-in) |
| EPIC-025 | 7 | 4 | — | 3 | — | T-250 (stream + diff) |
| EPIC-026 | 7 | — | 3 | 4 | — | T-261 (rules engine) |
| **Total** | **56** | **14** | **19** | **20** | **3** | — (Phase 0–4 as originally planned; Phase 5 adds 22) |

**Sequencing note:** T-012 (central permission module) is the single most load-bearing task — every later epic depends on it; treat it as a protected-path deliverable with the strongest test suite. T-037 (SSE notifications) is soft-required by EPIC-004/006/007 triggers; if those epics start first, triggers can write `notifications` rows without the SSE stream and light up later. T-093 (ticket snapshots) depends on the EPIC-006 dashboard shipping first, per the PLAN's phasing.
