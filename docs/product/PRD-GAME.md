# Backstage Play — a living office on top of RVC Backstage

> **Status:** DRAFT — requirements only. Implementation decomposition lives in
> `docs/epics/EPIC-024…026` + `docs/product/ENGINEERING-TASKS.md` (T-240 … T-266).
> **Version:** 0.1 · **Author:** Owner + Claude Code · **Date:** 2026-09-07
> **Parent PRD:** [`PRD.md`](PRD.md) — this document adds one product surface; every
> domain rule in the parent PRD (permissions, scoping, approvals, bottlenecks) still wins.

---

## Problem

Backstage already holds the truth about the organisation's work — tasks, owners,
dependencies, handoffs, approvals, countdowns — but it presents that truth as boards
and lists. Boards are read deliberately; nobody opens one "to see how the office is
doing". The Owner's ask (2026-09-07):

> "saya ingin membuat game tapi backoffice dan actionnya berdasarkan system yang saya
> punya … gameplaynya seperti The Sims … user itu punya karakter dan lingkungannya
> disesuaikan dengan maps … tidak perlu dulu autonomous karakter … fokusnya adalah
> meng-gamifikasi dari sistem task management ini."

Two things are missing today:

1. **An ambient view.** Who is overloaded, which desk everyone is waiting on, which
   handoff is stuck between two divisions — all of it exists as data but has no
   at-a-glance, spatial representation.
2. **A reason to come back daily.** Staff open My Tasks when assigned something. There
   is no positive loop that rewards the behaviours the organisation actually wants:
   finishing on time, unblocking others, deciding approvals quickly.

The cost of leaving this unsolved: bottlenecks are only discovered in meetings, and
the tool is experienced as an obligation rather than a place.

## Evidence

- The backoffice is complete: `tasks`, `divisions`, `profiles`, `handoffs`, `approvals`,
  `activity_log`, fan-in bottleneck scoring (EPIC-012), SSE notifications (T-037), and an
  Agent API (EPIC-023) prove every domain action is already exposed as a service with
  permission checks in `src/lib/permissions`.
- A rendering pipeline of the required class already exists and is proven in production
  at `permainan.reddie.id/racing`: Three.js 0.170, single unified GLSL3 MRT shader,
  one-pass post-processing, 1-tap shadow map, chunked instancing with LOD, zero-alloc
  particles, 120 Hz fixed loop, adaptive resolution. Measured ~110 draw calls for a scene
  of ~1 500 objects.
- **Gap:** no data yet on how many staff would open a 3D view daily, and no measured
  GPU baseline for office laptops — `Assumption — needs validation` (Open Questions).

## Users

- **Primary — Division Staff**: own a character at a desk; see their own tasks as
  physical objects; act on them (status, comment, checklist) without leaving the world.
- **Primary — Division Head**: sees their room at a glance — who is overloaded, which
  desk has a queue of waiters; decides handoffs and tier-1 approvals in-world.
- **Primary — Owner / CEO**: walks the whole office; the bottleneck panel becomes
  visible queues; approvals become envelopes in the approval room; event boards show
  countdowns and health.
- **Secondary — Admin**: enables the feature, tunes gamification rules, resets seasons.
- **Not for**: external guests (magic-link users) — Play is internal only in v1.

## Hypothesis

We believe **a data-driven 3D office in which each staff member has a character, each
task is a physical object at its owner's desk, and every action goes through the
existing permission-checked services** will **turn Backstage into a place people open
daily and make bottlenecks visible before meetings** for **all internal staff**.

We'll know we're right when **≥ 50 % of active staff open `/play` at least 3 days a
week after one month**, and **the Owner's bottleneck panel is opened less because the
queues are noticed in-world first**.

## Success Metrics

| Metric | Target | How measured |
| --- | --- | --- |
| Weekly active Play users / weekly active Backstage users | ≥ 50 % after 30 days | `activity_log` (`play.session` entries) |
| Actions taken from inside Play (status, comment, decide) | ≥ 20 % of all such actions | `activity_log` metadata `source: play` |
| Median time from bottleneck becoming critical → first human action | −30 % vs. baseline | EPIC-012 timestamps |
| Frame rate on an integrated-GPU laptop at 1.0 DPR, 60 characters | ≥ 50 fps p50 | Play stats overlay + Playwright smoke |
| Draw calls per frame (full office) | ≤ 300 | `renderer.info` in smoke test |

> Targets are directional — `TBD — needs validation via Owner` after the first month.

## Scope

**In scope (v1 = EPIC-024 → EPIC-026)**

- A `/play` route inside Backstage (same session, same permission module, no CORS).
- World generated from data: divisions → rooms, profiles → characters, tasks → objects,
  events → lobby boards. No hand-built maps.
- Characters are **data-driven, not autonomous**: idle / working / walking / waving /
  panicking states are chosen from the real task state. No needs, no free will.
- Live updates: the world animates changes made anywhere in Backstage within 5 s.
- In-world actions that already exist as services: task status, comment, checklist,
  claim, handoff decision, approval decision.
- Gamification layer: XP ledger derived from `activity_log`, levels, daily quests
  generated from real work, badges, cosmetic unlocks, opt-in leaderboard, Owner controls.

**Out of scope (v1)**

- Autonomous characters, needs systems (hunger, energy), free-roaming AI.
- Build mode, furniture placement, custom maps.
- Multiplayer presence over WebSocket (positions of other viewers). Others' characters
  move from **data**, not from where their user is looking.
- Any action that does not already exist as a permission-checked service.
- External guests, public sharing, mobile app store builds.
- Real money, prizes, or HR consequences tied to XP.

## Gameplay loop (what a session looks like)

1. **Enter** — camera lands on your own desk. Your task objects are there: a paper stack
   per open task, coloured by status, smoking if overdue, glowing if it blocks others.
2. **Read the room** — glance around: a queue of ghost figures at a desk means people are
   waiting on that task (fan-in ≥ 1); a red aura means EPIC-012 marked it critical.
   Couriers walking between rooms are pending handoffs. Envelopes in the approval room
   are decisions waiting.
3. **Act** — click an object → the existing task detail opens (same modal as the app);
   quick actions live on a small in-world panel. The change animates immediately.
4. **Progress** — the lobby notice board shows today's quests, generated from your real
   tasks. Completing them earns XP; levels unlock cosmetics for your character and desk.
5. **Leave** — nothing in Play needs upkeep. Closing the tab costs nothing.

## World mapping (data → world) — authoritative

| Backstage data | World representation | Visual state rules |
| --- | --- | --- |
| `divisions` | One room per division, sized by member count, arranged around a central lobby by a deterministic layout seeded by division id | Room sign = division name; room tint = division colour |
| `profiles` (active, internal) | One character per person at a desk in their primary division's room | Division-role `head` gets the corner desk; deactivated users are absent |
| `tasks` (visible per permission) | Paper stack on the assignee's desk (lead's desk if no assignee); one stack per task, height by checklist size | `todo` grey · `in_progress` blue, character "working" · `in_review` amber · `blocked` red with chain prop · `done` fades out · overdue emits smoke |
| EPIC-012 fan-in (`≥1` waiters) | Ghost figures queueing at the blocker's desk, one per waiter (capped at 6, "+N" label) | Critical (per EPIC-012 threshold) = red aura + urgent sign; auto-bump is **shown**, never re-decided in Play |
| `handoffs.status = pending` | Courier walking from `fromDivision` to `toDivision` carrying a parcel | Accepted → parcel placed on new task; declined → courier returns |
| `approvals` (my queue) | Envelopes on the approval-room table; one per pending step | Amount tier = envelope size; decided → envelope stamped and archived |
| `events` (visible) | Board in the lobby per event: countdown, phase, health | Show week/show day = board flashes; `health` colour follows EPIC-002 |
| Notifications (SSE) | Speech bubble over the relevant character for 6 s | Unread count mirrors the bell exactly |
| `activity_log` deltas | Animation triggers (walk, stamp, shrink, courier) | Applied as a diff — never a full reload |

Characters never move for reasons that are not in the data. A character walks only
when its data changed (new task, handoff, approval).

## Gamification rules — authoritative

Design principle: **reward behaviours the organisation wants, never volume or speed
alone, and never punish in public.**

| Rule | Points | Guard |
| --- | --- | --- |
| Task done on or before due date | +10 | Only if the task existed ≥ 30 min and has ≥ 1 checklist item **or** a description |
| Task done late | +3 | Same guard |
| Task done that had N open waiters (EPIC-012) | +5 × N (max +30) | Waiters must have existed ≥ 1 h |
| Handoff accepted/declined within 24 h of request | +5 | — |
| Approval step decided within 24 h | +5 | Comment required (already enforced) |
| Checklist item completed | +1 (max +10/day) | — |
| Reply to an @mention within 4 h | +2 (max +10/day) | — |
| Daily quest completed | +15 | Quests are generated from real tasks only |
| Reopen → close again | +0 | Ledger keyed by (activity, rule, task) with 7-day cooldown |
| Task created and done within 5 min by the same person | +0 and flagged | Owner report |

- The XP ledger is **append-only and derived from `activity_log`**; a full recompute from
  the log must equal the incremental total (this is the anti-gaming tripwire).
- Daily cap: 100 XP/day/user. Levels: 100 × level² cumulative.
- Leaderboards are **off by default**; a division head may opt their division in. The
  Owner sees aggregates ("team pulse"), not a ranking, unless opted in.
- Badges are catalogue-driven (First Handoff, Unblocker, Zero-Overdue Week, Show-Day
  Hero, Approval Sprinter). Cosmetics are purely visual.
- Nothing in the gamification layer changes task priority, status, or permissions.

## Architecture

```
browser  /play (Next.js client page, same next-auth session)
   │
   ├─ engine  src/lib/play/engine/**      ← ported from permainan racing (TypeScript modules)
   │     renderer (MRT gbuffer, unified shader, materialFactory, 1-tap shadow, post pass,
   │     InstancedManager, ParticlePool, fixed-step loop, adaptive resolution, glTF+skinning)
   ├─ world   src/lib/play/world/**       ← pure: layout(divisions) · mapping(tasks) · diff(activity)
   ├─ data    /api/play/world (snapshot) · /api/play/stream (SSE deltas, notifications-stream pattern)
   └─ actions server actions calling src/lib/{tasks,collab,approvals}/service — never raw DB
                                             │
                          src/lib/permissions (unchanged, protected path)
                                             │
                                        PostgreSQL
```

- **Same app, same session.** Play is a route in this repository, not a separate site.
  Agent API keys (bound to WhatsApp numbers) are not used for Play.
- **Read = snapshot + diff.** One permission-scoped snapshot on entry; afterwards only
  `activity_log` deltas since a cursor, via SSE. No polling of full lists.
- **Write = existing services.** Every mutation from Play calls the same function the
  app UI calls, with `metadata.source = "play"` for attribution and metrics.
- **World is a pure function of data.** `layout(divisions)` and `mapTask(task)` are
  deterministic and unit-tested; the engine only renders what they return.
- **Performance budget** (per frame, full office): ≤ 300 draw calls, ≤ 15 shader
  programs, ≤ 1 shadow pass, 1 post pass, ≥ 50 fps p50 on an integrated GPU at 1.0 DPR.
  Adaptive resolution and quality tiers (desktop / touch) are mandatory, not optional.

## Tech stack (locked)

| Concern | Decision | Reason |
| --- | --- | --- |
| Rendering | Three.js **0.170** (npm, pinned), WebGL2 only | MRT `count: 2`, GLSL3, proven pipeline from the racing prototype |
| Engine code | TypeScript modules under `src/lib/play/engine` | The single-file racing layout does not scale to data sync + UI |
| Characters & props | Low-poly rigged glTF, CC0 (Kenney / Quaternius), ≤ 2 k tris per character, 5 animation clips | Procedural box models were fine for karts, not for people |
| Shading | Existing unified cel shader + `skinning` chunks; kinds `metal/rock/foliage/skin/dirt/glow` | One program family, uniform-driven |
| UI overlays | React components already in the app (task modal, comment box, approval decide) rendered over the canvas | No duplicate UI; identical permissions |
| Data transport | Server actions + SSE (existing pattern) | No WebSocket infra |
| Physics | None — grid layout + A* on a coarse grid | Nothing needs collision |
| Persistence | Drizzle tables `play_*` (EPIC-026) — reviewed migration, protected path | Ledger must be recomputable |
| Testing | Vitest for pure world/rules code; Playwright (SwiftShader) smoke for render + console errors + draw-call budget | Already proven on the racing build |

## Delivery milestones

| Epic | Delivers | Exit |
| --- | --- | --- |
| **EPIC-024 — Play foundation** | `/play` route, engine port, world snapshot, deterministic layout, characters, task objects, camera/picking to existing modals, perf smoke | Owner walks the office and opens any visible task from its desk |
| **EPIC-025 — Live world & actions** | SSE diffs → animations, quick-action panel, handoff couriers, approval room, event boards, "my day" focus, mobile tier, reduced-motion & no-WebGL fallback | A status change in another tab animates within 5 s; decisions made in-world appear in the app log identically |
| **EPIC-026 — Gamification** | `play_*` schema, XP rules engine (recomputable), daily quests from real tasks, levels/badges/cosmetics, team pulse + opt-in leaderboard, weekly recap, Owner controls, anti-gaming guards | Recompute from log equals incremental; documented exploits score 0 |

Order is strict: 024 → 025 → 026. Gamification without a live, actionable world is a
scoreboard nobody looks at.

## Open Questions

- **Q1** Which cosmetic set does the Owner want (hats/desk items only, or character
  skins)? — `Assumption: hats + desk items in v1`.
- **Q2** Leaderboard default per division: off (assumed) or on?
- **Q3** Weekly recap channel: in-app only, or also WhatsApp via EPIC-015 gateway?
  — `Assumption: in-app + WhatsApp opt-in`.
- **Q4** Do external-wait dependencies (EPIC-012) get a visual (a "waiting for permit"
  sign) in v1? — `Assumption: yes, as a sign at the desk, no character`.
- **Q5** GPU baseline of the actual office laptops — measure before EPIC-024 T-247 sets
  the quality tiers.

## Risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Novelty fades; Play becomes decoration | Metric 1 misses | Bottleneck queues and handoff couriers must be **more legible than the board**; ship EPIC-024 alone for two weeks and measure before investing in 026 |
| XP is gamed (trivial tasks, reopen loops) | Trust in the tool drops | Ledger derived from `activity_log`, guards in the rule table, recompute tripwire, Owner report |
| Public ranking demotivates | Staff resent the tool | Leaderboard off by default, aggregates only, no HR linkage (stated in scope) |
| Office laptops cannot run WebGL2 at speed | Feature unusable for some | Quality tiers, adaptive resolution, no-WebGL fallback to the classic dashboard |
| Engine port drifts from the racing prototype | Two codebases to maintain | The racing single-file stays as a demo; `src/lib/play/engine` becomes the only maintained copy |
| Schema/permission changes touch protected paths | Security regressions | Only via reviewed migration tasks; Play adds **no** new permission semantics, it reuses `task.view/edit`, `approval.decide`, `handoff.decide` |

## Appendix A — Asset list (v1)

| Asset | Source | Budget |
| --- | --- | --- |
| Character base (rigged) ×1, tinted per division, 5 clips (idle, work, walk, wave, panic) | Quaternius "Ultimate Animated Character Pack" (CC0) or Kenney | ≤ 2 000 tris, 1 texture 512² |
| Desk, chair, monitor, paper stack (3 heights), plant, whiteboard, envelope, parcel, chain, sign | Kenney "Furniture Kit" (CC0) + procedural | Instanced; ≤ 300 tris each |
| Room shells, corridors, lobby | Procedural from `layout()` | Merged geometry per room |
| Post LUT, hatch, crease | Ported from racing | — |

## Appendix B — Reused racing engine components (verbatim ports)

Unified MRT shader + `materialFactory`, single post pass (Sobel crease, bloom, vignette,
LUT, speed lines → replaced by "focus pulse"), 1-tap shadow rig, `InstancedManager`
(chunked, LOD), `ParticlePool`, fixed-step loop, adaptive resolution, stats overlay (F3).
Source: `/home/wit/docker-infra/permainan/racing/index.html` (2026-09-07 build).
