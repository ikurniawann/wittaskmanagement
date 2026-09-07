# EPIC-026: Backstage Play — gamification (XP, quests, recognition)

status: backlog
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

- [ ] **T-260** Reviewed migration adding `play_profiles` (user id PK, level, xp,
      cosmetics JSON, leaderboard opt-in, season id), `play_xp_ledger` (id, user id,
      activity id, rule, points, task/handoff/approval id, event id, division id,
      created at; **unique (activity id, rule)**), `play_badges` (catalogue: key, name,
      description, icon), `play_badge_awards` (user id, badge key, awarded at, unique
      pair), `play_quests` (id, user id, date WIB, kind, target ref, target count,
      progress, completed at), `play_seasons` (id, name, starts, ends). Drizzle schema
      under `src/db/schema/play.ts`, seed for the badge catalogue, indexes on
      `(user id, created at)`.

### XP rules engine

- [ ] **T-261** `src/lib/play/xp/rules.ts` (table from the PRD: on-time +10, late +3,
      unblock +5×N max 30, handoff ≤ 24 h +5, approval ≤ 24 h +5, checklist +1 max 10/d,
      mention reply ≤ 4 h +2 max 10/d, quest +15; daily cap 100; level = 100 × level²
      cumulative) and `scoreActivity(activity, ctx)` pure scorer with guards (task age
      ≥ 30 min and has checklist or description; waiters existed ≥ 1 h; reopen cooldown 7
      d). Incremental hook on activity write (after commit, non-blocking) +
      `recompute(userId)` + nightly `node-cron` job (02:00 WIB) that recomputes and logs
      any drift. Vitest per rule and a property test: recompute == incremental on a
      generated activity stream.

### Daily quests

- [ ] **T-262** Generator at 06:00 WIB per active user from real data: "clear N overdue",
      "finish a task others wait on", "decide N approvals/handoffs", "update stale
      in-progress tasks (no activity 3 d)"; max 3 quests/day; completion detected from
      ledger entries; lobby notice board in Play + a strip on My Tasks (classic UI).
      Test: a quest never references an object the user cannot see; quests regenerate
      idempotently.

### Levels, badges, cosmetics

- [ ] **T-263** Level curve and level-up moment (in-world confetti via `ParticlePool`,
      speech bubble); badge catalogue (First Handoff, Unblocker ×5, Zero-Overdue Week,
      Show-Day Hero, Approval Sprinter, Season Finisher) awarded by ledger queries;
      cosmetic unlocks per level (hat, desk plant, monitor skin, chair colour) stored in
      `play_profiles.cosmetics`, rendered as instanced props / character attachments;
      profile page shows level, badges, cosmetics. Cosmetics are visual only.

### Team pulse, leaderboard & recap

- [ ] **T-264** Division "team pulse" panel (aggregate XP this week, on-time rate, open
      waiters, streak of zero-overdue days) visible to members and heads; leaderboard
      component shown only when the division's head opted in (`play_profiles`/division
      setting); weekly recap (Monday 08:00 WIB) via existing notifications + optional
      WhatsApp (EPIC-015 gateway, user opt-in) summarising XP, badges, quests done.
      Test: leaderboard hidden by default; recap respects opt-ins.

### Owner controls

- [ ] **T-265** Admin → Play settings: enable/disable Play (from T-240), rule weights and
      caps (validated with zod, stored in `app_settings`), leaderboard policy
      (off / head opt-in / on), season start/reset (archives ledger totals into the season,
      keeps badges), and a "flagged activity" report (T-266). Changes apply without
      deploy; every change logged in `activity_log` as `play.settings_changed`.

### Anti-gaming guards

- [ ] **T-266** Guards as tested rules: reopen→close within 7 d scores 0; task created
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

- 2026-09-07 Epic created. Decisions recorded in `PRD-GAME.md`: no real money/prizes/HR
  consequences; leaderboard off by default; ledger derived from `activity_log` so the
  score can always be recomputed.

## Dependencies

- EPIC-024, EPIC-025 (actions must exist before they can be scored in-world).
  EPIC-012 (fan-in for the unblock rule), EPIC-004 (approval steps), EPIC-015 (optional
  WhatsApp recap), EPIC-006 activity log.
