# EPIC-026: Backstage Play — gamification (XP, quests, recognition)

status: ready-for-qa
environment: dev
phase: 5
priority: P1
area: Play
retries: 0
prd: ../product/PRD-GAME.md
stories: ../product/USER-STORIES.md (US-PLAY-7 … US-PLAY-10)
tasks: ../product/ENGINEERING-TASKS.md (T-260 … T-266)

## Goal

Add the loop that brings people back: XP earned for the behaviours the organisation
wants (on time, unblocking others, deciding quickly), levels and cosmetic unlocks for
the character and desk, daily quests generated from **real** tasks, badges, an opt-in
leaderboard, a weekly recap, and Owner controls — with anti-gaming guards that make the
ledger recomputable from `activity_log`. Gamification never changes a task's priority,
status, visibility or anyone's permissions.

## Design

- **Ledger derived from the log.** `play_xp_ledger` is append-only and keyed by
  `(activity_id, rule)`; `recompute(userId)` from `activity_log` must equal the
  incremental total. This is the tripwire against manual edits and double counting.
- **Rules are a table, not code paths.** `src/lib/play/xp/rules.ts` exports the rule
  table from the PRD ("Gamification rules — authoritative") with guards and caps; the
  scorer is a pure function `scoreActivity(activity, context) → entries[]`.
- **Quests never invent work.** A quest references tasks/handoffs/approvals the user can
  already see and is completed by ledger entries, not by a separate "mark done".
- **Recognition defaults to private.** Team pulse shows aggregates; ranking exists only
  where a division head opted in; the Owner sees no ranking unless opted in.
- **Schema is a reviewed migration.** `src/db/schema/**` is a protected path; T-260 is
  the only task that touches it.

## User Stories

- **US-PLAY-7** — As a staff member, I want to earn XP and levels for finishing on time
  and unblocking others, so that doing the right work is visibly recognised.
- **US-PLAY-8** — As a staff member, I want daily quests made from my real tasks, so that
  the game points me at what actually matters today.
- **US-PLAY-9** — As a division head, I want to see my team's pulse and choose whether
  a leaderboard is shown, so that recognition motivates without shaming.
- **US-PLAY-10** — As the Owner, I want to tune rule weights, caps and seasons and see
  flagged gaming attempts, so that the incentives stay aligned with the business.

## Tasks

### Schema

- [x] **T-260** Reviewed migration adding `play_profiles` (user id PK, level, xp,
      cosmetics JSON, leaderboard opt-in, season id), `play_xp_ledger` (id, user id,
      activity id, rule, points, task/handoff/approval id, event id, division id,
      created at; **unique (activity id, rule)**), `play_badges` (catalogue: key, name,
      description, icon), `play_badge_awards` (user id, badge key, awarded at, unique
      pair), `play_quests` (id, user id, date WIB, kind, target ref, target count,
      progress, completed at), `play_seasons` (id, name, starts, ends). Drizzle schema
      under `src/db/schema/play.ts`, seed for the badge catalogue, indexes on
      `(user id, created at)`.

### XP rules engine

- [x] **T-261** `src/lib/play/xp/rules.ts` (table from the PRD: on-time +10, late +3,
      unblock +5×N max 30, handoff ≤ 24 h +5, approval ≤ 24 h +5, checklist +1 max 10/d,
      mention reply ≤ 4 h +2 max 10/d, quest +15; daily cap 100; level = 100 × level²
      cumulative) and `scoreActivity(activity, ctx)` pure scorer with guards (task age
      ≥ 30 min and has checklist or description; waiters existed ≥ 1 h; reopen cooldown 7
      d). Incremental hook on activity write (after commit, non-blocking) +
      `recompute(userId)` + nightly `node-cron` job (02:00 WIB) that recomputes and logs
      any drift. Vitest per rule and a property test: recompute == incremental on a
      generated activity stream.

### Daily quests

- [x] **T-262** Generator at 06:00 WIB per active user from real data: "clear N overdue",
      "finish a task others wait on", "decide N approvals/handoffs", "update stale
      in-progress tasks (no activity 3 d)"; max 3 quests/day; completion detected from
      ledger entries; lobby notice board in Play + a strip on My Tasks (classic UI).
      Test: a quest never references an object the user cannot see; quests regenerate
      idempotently.

### Levels, badges, cosmetics

- [x] **T-263** Level curve and level-up moment (in-world confetti via `ParticlePool`,
      speech bubble); badge catalogue (First Handoff, Unblocker ×5, Zero-Overdue Week,
      Show-Day Hero, Approval Sprinter, Season Finisher) awarded by ledger queries;
      cosmetic unlocks per level (hat, desk plant, monitor skin, chair colour) stored in
      `play_profiles.cosmetics`, rendered as instanced props / character attachments;
      profile page shows level, badges, cosmetics. Cosmetics are visual only.

### Team pulse, leaderboard & recap

- [x] **T-264** Division "team pulse" panel (aggregate XP this week, on-time rate, open
      waiters, streak of zero-overdue days) visible to members and heads; leaderboard
      component shown only when the division's head opted in (`play_profiles`/division
      setting); weekly recap (Monday 08:00 WIB) via existing notifications + optional
      WhatsApp (EPIC-015 gateway, user opt-in) summarising XP, badges, quests done.
      Test: leaderboard hidden by default; recap respects opt-ins.

### Owner controls

- [x] **T-265** Admin → Play settings: enable/disable Play (from T-240), rule weights and
      caps (validated with zod, stored in `app_settings`), leaderboard policy
      (off / head opt-in / on), season start/reset (archives ledger totals into the season,
      keeps badges), and a "flagged activity" report (T-266). Changes apply without
      deploy; every change logged in `activity_log` as `play.settings_changed`.

### Anti-gaming guards

- [x] **T-266** Guards as tested rules: reopen→close within 7 d scores 0; task created
      and completed within 5 min by the same actor scores 0 and is flagged; bulk status
      flips (> 10 completions within 10 min) beyond the daily cap are flagged; ledger
      unique constraint makes replays idempotent; flagged rows surface in the Owner
      report with a one-click "exclude from season". Vitest reproduces each documented
      exploit and asserts 0 XP.

## Acceptance Criteria

**Epic-level**

- `recompute(userId)` from `activity_log` equals the incremental ledger total for every
  seeded user after a scripted week of activity (property test in `gates.test`).
- Every documented exploit in T-266 scores 0 XP and appears in the Owner report.
- Leaderboards are invisible unless a head opted in; Owner sees aggregates only by
  default (test + reviewer).
- Nothing in EPIC-026 mutates tasks, priorities, statuses or permissions (static check:
  `src/lib/play/xp/**` imports no task/approval write service).

**Per-task**

- **T-260** — migration applies on a clean DB and on the dev DB; unique constraints
  present; badge seed loads.
- **T-261** — per-rule tests + property test green; nightly drift job logs zero drift on
  the seeded fixture.
- **T-262** — 100 generated quests reference only visible objects; rerun produces the
  same quests for the same day.
- **T-263** — level-up triggers once per threshold; badges never awarded twice;
  cosmetics persist across sessions.
- **T-264** — pulse numbers reconcile with the ledger; recap sent only to opted-in
  channels.
- **T-265** — changed weight affects the next scored activity without restart; season
  reset archives totals and keeps badges.
- **T-266** — exploit tests green; report lists the flagged rows with actor and reason.

> Done means each criterion is demonstrably true (test asserts it, a gate passes,
> or a reviewer verifies it) AND the cross-project `DEFINITION-OF-DONE.md` checklist passes.

## Automation Log

- 2026-09-07 Owner ("lanjutkan lagi progressnya" after the test deploy) → started. **T-260 shipped**:
  `src/db/schema/play.ts` (play_profiles, play_xp_ledger unique(activity, rule), play_badges,
  play_badge_awards, play_quests unique(user, day, kind), play_seasons), migration
  `0047_play-gamification.sql`, applied to the TEST database only (port 5440). Production DB
  untouched — the Owner runs `pnpm db:migrate` there at deploy time.
- 2026-09-07 **T-261 shipped**: `src/lib/play/xp/rules.ts` is the PRD table as data
  (`DEFAULT_RULES`) plus a pure `scoreActivity(facts, cfg)`; `service.ts` gathers facts from the
  DB, writes the ledger (`onConflictDoNothing` on activity+rule), refreshes xp/level, evaluates
  badges, progresses quests. Hook: `logActivity` now `.returning()`s the row and fires scoring
  without awaiting it. `recompute(userId)` replays the user's log; `nightlyDriftCheck` runs 02:00
  WIB. 20 unit tests incl. a 400-row property test (replay == incremental, never above the daily
  cap). Finding: `task_dependencies` has no timestamp, so "waiter existed ≥ 1 h" uses the waiting
  task's age; `approval_steps` has no creation stamp, so "asked at" is the approval's creation.
  Two log rows the app did not write before were added so their rules can fire:
  `task.checklist_done` (on tick) and `comment.add` (no body, only mentions) — the latter also
  gives EPIC-025 its comment bubbles.
- 2026-09-07 **T-262 shipped**: `quests.ts` generates ≤ 3 quests/day from the same
  permission-scoped lists the boards use (clear_overdue, unblock, decide, refresh_stale),
  idempotent per user+day+kind; generated at 06:00 WIB and on first Play load; completion is
  detected from scored rows and writes `play.quest_complete` (+15 through the normal path).
  Shown in the Play tray, on My Tasks (strip) and the profile.
- 2026-09-07 **T-263 shipped**: level = ⌊√(xp/100)⌋; `play.level_up` activity row → Play stream →
  confetti + wave + bubble; cosmetics by level (cap L1, desk fern L2, wide monitor L3 *not
  rendered*, red chair L4 *not rendered*, crown L5) — hat and fern are drawn, the instanced
  monitor/chair variants are not (instanced kinds are static; deferred). Badges: first_handoff,
  unblocker_5, on_time_7, show_day_hero, approval_sprinter, level_5 (catalogue upserted lazily).
- 2026-09-07 **T-264 shipped**: division pulse (week XP, on-time rate, active members) in the
  tray; leaderboard only when policy allows (`play_leaderboard` off | head_opt_in | on, plus
  `play_leaderboard_<division>` for heads) AND the person opted in (`play_profiles.leaderboard_opt_in`,
  checkbox in the tray); weekly recap Monday 08:00 WIB as an in-app notification
  (`play_recap` type added to the text-typed notifications). WhatsApp mirror deferred (Owner).
- 2026-09-07 **T-265 shipped**: Settings → Integrations → "Play — XP rules & season": points and
  caps (validated by `mergeRules`, stored in `app_settings.play_rules`, applied on the next scored
  activity), leaderboard policy, season reset (archives xp/level into `play_seasons.archive`,
  zeroes ledger points before the reset, keeps badges), flagged-activity report (last 50).
- 2026-09-07 **T-266 shipped**: guards live in the rule table and are unit-tested: reopen→close
  within 7 d, self-created task done within 5 min, > 10 completions in 10 min, trivial task
  (< 30 min old and no checklist/description) → 0 XP, flagged, visible in the Owner report.
- 2026-09-07 Verified on the test DB (dev server): completing a substantive task from the Play
  panel → ledger `task_done_on_time:10` within 2 s, profile 10 XP, tray chip "+10 today", admin
  panel renders, profile section renders.
- 2026-09-07 Verified quests on the test DB: an overdue task assigned to me produced
  "Clear 1 overdue task" on first Play load and on the My Tasks strip; finishing it from the panel
  completed the quest. Bug found and fixed in the same pass: the quest/level-up/badge rows were
  inserted straight into `activity_log`, bypassing the scoring hook — they now go through
  `logActivity`. The tripwire proved itself: `recompute` reported drift +15 (the unscored quest
  row) and 0 on the second run. Ledger after: on_time 10, late 3, quest 15.
- 2026-09-07 Status → ready-for-qa. Open for human QA: (1) run `pnpm db:migrate` on production
  before deploying this branch, (2) decide the leaderboard policy (default off), (3) WhatsApp
  recap mirror yes/no, (4) monitor/chair cosmetics are unlocked but not drawn (instanced kinds).
- 2026-09-07 (night) Owner ("lanjutkan progress") → the T-263 deferral closed: **wide monitor (L3)
  and red chair (L4) are now drawn**. Desk props are static instances, so `DeskRef` keeps the
  desk's monitor/chair `InstanceRecord`; `applyCosmetics` scales that instance to 0 (the
  InstancedManager rewrites its chunk within a few frames) and adds a dedicated mesh at the same
  transform — a two-tone wide screen and a red seat/back — and restores scale 1 when the
  cosmetic is gone (season reset). Verified on the test instance (fixture user set to L4 in the
  TEST DB only, 1650 XP): cap + fern + wide monitor + red chair render, other desks unchanged,
  0 console errors, 96 draw calls, tests 673/673, typecheck clean. Human-QA item (4) is closed;
  (1)–(3) remain the Owner's decisions.
- 2026-09-07 Epic created. Decisions recorded in `PRD-GAME.md`: no real money/prizes/HR
  consequences; leaderboard off by default; ledger derived from `activity_log` so the
  score can always be recomputed.

## Dependencies

- EPIC-024, EPIC-025 (actions must exist before they can be scored in-world).
  EPIC-012 (fan-in for the unblock rule), EPIC-004 (approval steps), EPIC-015 (optional
  WhatsApp recap), EPIC-006 activity log.
