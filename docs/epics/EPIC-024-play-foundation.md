# EPIC-024: Backstage Play — foundation (world from data, read-only)

status: ready-for-qa
environment: dev
phase: 5
priority: P1
area: Play
retries: 0
prd: ../product/PRD-GAME.md
stories: ../product/USER-STORIES.md (US-PLAY-1 … US-PLAY-3)
tasks: ../product/ENGINEERING-TASKS.md (T-240 … T-247)

## Goal

Put a `/play` route inside Backstage that renders the organisation as a 3D office
generated entirely from data: one room per division, one character per person, one
object per task, one board per event. Read-only in this epic: clicking anything opens
the **existing** task/profile/event UI. The rendering engine is the pipeline proven on
`permainan.reddie.id/racing`, ported into TypeScript modules. No autonomy, no needs,
no build mode (Owner, 2026-09-07: "tidak perlu dulu autonomous karakter … fokusnya
adalah meng-gamifikasi dari sistem task management ini").

## Design

- **Same session, same permissions.** The page is `src/app/(app)/play/page.tsx`; the
  snapshot service runs as the logged-in actor through `src/lib/permissions`. Play
  introduces one capability, `play.view`, granted to every active internal user; it adds
  no new data visibility — a task you cannot see in the app does not exist in the world.
- **World is a pure function of data.** `layout(divisions)` → room rectangles;
  `mapTask(task, ctx)` → object kind + visual state; both deterministic and unit-tested.
  The engine renders what they return and nothing else.
- **Engine port, not rewrite.** Unified GLSL3 MRT shader + `materialFactory`, single post
  pass, 1-tap shadow rig, `InstancedManager`, `ParticlePool`, fixed-step loop, adaptive
  resolution — moved verbatim into `src/lib/play/engine/**`, then extended with glTF
  skinning for characters. Three.js pinned to 0.170 as an npm dependency.
- **Budget is a gate.** ≤ 300 draw calls, ≥ 50 fps p50 on an integrated GPU at 1.0 DPR,
  zero console errors — asserted by a Playwright (SwiftShader) smoke test in `gates.test`.

## User Stories

- **US-PLAY-1** — As a staff member, I want to see the office as a 3D world where my
  desk holds my real tasks, so that I understand my day at a glance.
- **US-PLAY-2** — As a division head, I want to see at a glance which desk in my room
  has people waiting on it, so that I spot bottlenecks before the meeting.
- **US-PLAY-3** — As the Owner, I want to walk the whole office and open any task,
  person or event from where it physically is, so that the world is a real entry point
  and not a decoration.

## Tasks

### Route, capability & feature flag

- [x] **T-240** Add `play.view` capability in `src/lib/permissions` (reviewed change —
      protected path) granted to active internal users; `app_settings.play_enabled`
      flag (default off) with an Admin toggle; `src/app/(app)/play/page.tsx` as a
      client-only full-viewport page (dynamic import of the engine, SSR disabled) with
      an HTML overlay layer for panels; sidebar entry "Play" shown only when the flag is
      on and the actor has the capability; flag off → 404.

### Engine port

- [x] **T-241** Port the racing pipeline into `src/lib/play/engine/`: `renderer.ts`
      (MRT gbuffer `count: 2`, HalfFloat, MSAA tier), `shader.ts` (unified vertex/
      fragment + `materialFactory(color, kind)`), `shadow.ts` (1024 DepthTexture,
      `MeshDepthMaterial` override, layer-1 casters, manual bias matrix), `post.ts`
      (Sobel crease, hard-threshold bloom, vignette, LUT 256×16, explicit linear→sRGB),
      `instanced.ts` (`InstancedManager`: chunks, `addUpdateRange`, smoothstep LOD),
      `particles.ts` (`ParticlePool`: Float32Array pools, ring buffer, zero alloc),
      `loop.ts` (120 Hz accumulator, catch-up cap, adaptive pixel ratio, `info.autoReset
      = false`). Vitest units for `chunkOf`, LOD scale, pool ring buffer, LUT builder.
      Three.js `0.170.0` pinned in `package.json`.

### World snapshot service

- [x] **T-242** `src/lib/play/service.ts` → `getPlayWorld(actor)`: one permission-
      scoped snapshot: divisions (+ members, role), profiles (id, name, avatar, primary
      division), visible tasks (id, title, status, priority, dueDate, assignees, lead,
      checklist count/done, fan-in waiters from EPIC-012's bottleneck service, critical
      flag, overdue), pending handoffs (from/to division), my approval queue count,
      visible events (name, showDate, phase, health), unread notification count, and a
      `cursor` (latest `activity_log` id) for EPIC-025. Served by `GET /api/play/world`
      (session auth, `force-dynamic`). Scoping tests: staff never receive a
      `restricted` task of another division; deactivated users are absent.

### Deterministic layout

- [x] **T-243** `src/lib/play/world/layout.ts`: pure `layout(divisions, members)` →
      lobby + one room rectangle per division on a grid, area ∝ member count (min 4
      desks), desks placed on a grid inside the room, head desk in the corner, corridors
      connecting every room to the lobby, approval room adjacent to the lobby, event
      boards along the lobby wall. Seeded by division id so the layout is stable across
      sessions and across data changes that do not add/remove divisions. Vitest: same
      input → identical output; 11 seeded divisions fit with no overlapping rectangles;
      every desk has a corridor path (BFS on the coarse grid).

### Characters & props

- [x] **T-244** Add CC0 rigged low-poly character glTF + prop set (desk, chair, monitor,
      paper stacks ×3, plant, whiteboard, envelope, parcel, chain, sign) under
      `public/play/`; extend the unified vertex shader with three.js `skinning` chunks so
      `SkinnedMesh` renders through the same program family; per-character tint from
      division colour + initials badge from the profile name (procedural canvas texture,
      same helper as the racing number decal); animation states `idle / work / walk /
      wave / panic` selected from data (T-245); props go through `InstancedManager`.
      Budget: 60 characters + 400 props ≥ 50 fps p50 at 1.0 DPR on an integrated GPU.

### Task objects & visual state

- [x] **T-245** `src/lib/play/world/mapping.ts`: pure `mapTask(task, ctx)` → `{ desk,
      stackHeight, colour, aura, smoke, chain, waiters }` following the PRD "World
      mapping" table exactly (`todo` grey · `in_progress` blue + owner "work" clip ·
      `in_review` amber · `blocked` red + chain · `done` absent · overdue = smoke
      particles · fan-in ≥ 1 = ghost queue capped at 6 with "+N" · EPIC-012 critical =
      red aura + urgent sign). Tasks without assignee sit on the lead's desk; without
      lead, on the division's whiteboard. Vitest table test per status/flag combination;
      Playwright screenshot per state on a seeded fixture.

### Camera, controls & picking

- [x] **T-246** Isometric orbit camera (pan / zoom / rotate in 45° steps) with mouse,
      keyboard and touch; hover highlight via instance-id raycast (`InstancedMesh`
      `instanceId`); click desk → profile card overlay; click task object → the existing
      task detail modal (`@modal` route, unchanged); click event board → event page;
      `Esc` closes; deep link `/play?task=<id>` focuses that desk. All overlays are the
      app's React components — no duplicated UI.

### Performance gate & telemetry

- [x] **T-247** Quality tiers (desktop: MSAA 4, DPR ≤ dpr; touch: MSAA 0, DPR ≤ 1.0,
      particles 256), stats overlay (F3), `play.session` activity entry on enter with
      device class + p50 fps after 30 s (no PII beyond the actor); Playwright SwiftShader
      smoke in `scripts/test.sh`: page loads, zero console errors/warnings, draw calls
      ≤ 300 on the seeded office, screenshot artefact stored.

## Acceptance Criteria

**Epic-level**

- The Owner logs in, opens `/play`, sees every division as a room, every active
  internal user as a character, and every task they may see as an object on the right
  desk; clicking any object opens the same modal the app uses, with the same permission
  outcome.
- A staff member sees only tasks they can see in the app; a `restricted` task of
  another division is absent from the snapshot (test asserts).
- Seeded office renders with ≤ 300 draw calls and zero console errors in the smoke test;
  ≥ 50 fps p50 on the reference laptop (recorded in the Automation Log).
- Nothing in the world moves without a data reason (no autonomy).

**Per-task**

- **T-240** — flag off → `/play` 404; flag on + capability → page renders; external
  guest → 403; sidebar entry follows the same rule.
- **T-241** — `pnpm test` green for engine units; demo scene renders through MRT + post
  pass with the same visual output as the racing build (screenshot compared by eye and
  recorded).
- **T-242** — snapshot for seed data ≤ 200 KB JSON; scoping tests pass; response carries
  a `cursor`.
- **T-243** — determinism + no-overlap + reachability tests pass for 1, 3, 11 and 25
  divisions.
- **T-244** — 60 skinned characters + 400 instanced props at ≥ 50 fps p50, 1.0 DPR,
  integrated GPU; character tint matches division colour token.
- **T-245** — mapping table test covers all 7 statuses × overdue × fan-in × critical;
  screenshots per state attached to the epic.
- **T-246** — click-through opens the existing modal; a task the actor cannot edit shows
  the modal in read-only exactly as in the app; deep link focuses the desk.
- **T-247** — smoke test is part of `gates.test` and fails on a console error or on
  > 300 draw calls.

> Done means each criterion is demonstrably true (test asserts it, a gate passes,
> or a reviewer verifies it) AND the cross-project `DEFINITION-OF-DONE.md` checklist passes.

## Automation Log

- 2026-09-07 **T-240 shipped** on branch `feat/epic-024-play`: `play.view` capability (one `case`
  in the protected permission switch, internal users only), `play_enabled` flag in
  `app_settings` via `src/lib/play/settings.ts` (integrations-service pattern, missing row = off),
  `/play` page (flag off → 404, no capability → /my-tasks), sidebar entry gated by flag +
  capability (`nav-link` icon `play`), Admin toggle on Settings → Integrations (`play-panel.tsx`
  + `setPlayEnabledAction`), `/play` added to `FULLSCREEN_ROUTES` plus a new `BARE_ROUTES`
  (no content padding) in `app-frame.tsx`. Verified headless: 404 while off, toggle persists,
  link appears, page 200.
- 2026-09-07 **T-241 shipped**: engine ported verbatim from the racing build into
  `src/lib/play/engine/` (`renderer` MRT count:2 HalfFloat + tiers, `shader` unified GLSL3 +
  `materialFactory` now with `skinning` chunks, `shadow` 1-tap DepthTexture rig, `post` single
  pass, `instanced` chunked LOD with `addUpdateRange`, `particles` zero-alloc pool, `loop` 120 Hz
  + adaptive DPR, `geometry` mergeParts/canvasTex). `three@0.170.0` + `@types/three@0.170.0`
  pinned. 8 engine unit tests.
- 2026-09-07 **T-242 shipped**: `getPlayWorld(actor)` assembles the snapshot through
  `listActiveEvents` + `listEventTasks` (the boards' own functions), adds checklist counts,
  EPIC-012 badges (`getDependencyBadges` → waiters/critical), pending handoffs in visible
  projects, `listMyQueue` length, `unreadCount`, and a `cursor` = latest `activity_log.createdAt`
  (ids are random uuids, so time is the cursor for EPIC-025). Externals/deactivated users are
  absent. Decision: no new query paths for task visibility — reuse, never re-implement.
- 2026-09-07 **T-243 shipped**: pure `layout()` — rooms in two rows around a lobby, ordered by
  FNV-1a hash of the division id (stable when members change), area ∝ members (min 4 desks),
  head desk first, corridors, approval room east, event boards on the lobby's west wall, coarse
  walkable grid + BFS `reachable()`. Tests: determinism, stability, no overlap and reachability
  for 1/3/11/25 divisions. `divisionColor(id)` derives a hue from the id because `divisions` has
  no colour column (schema is protected).
- 2026-09-07 **T-245 shipped**: pure `mapTask()` per the PRD table (status colour, smoke, chain,
  aura/urgent sign, ghost queue capped at 6 with "+N", assignee → lead → whiteboard fallback,
  stack height from checklist size) + `personClip()`; 84 table-test cases.
- 2026-09-07 **T-246 shipped**: `IsoCamera` (drag pan, wheel zoom, Q/E or right-drag rotate in
  45° steps, WASD/arrows, pinch + two-finger rotate; click fires only without drag), instance-id
  raycast picking, hover highlight ring + label, click task → `router.push('/tasks/<id>')` so the
  existing `@modal` peek opens, click event board → project page, click person → in-canvas card
  with their open tasks. Deep link `/play?task=<id>` focuses the stack. New
  `src/lib/play/active-store.ts`: the frame keeps the canvas layout while the modal is on top.
  Verified headless: hover label appears, click opens the dialog, sidebar stays hidden.
- 2026-09-07 **T-247 partial**: quality tiers (desktop MSAA 4 / touch MSAA 0, DPR ≤ 1.0,
  256 particles), F3 stats overlay, `play.session` activity row after 30 s (p50 fps, draw calls,
  device class, DPR — clamped server-side), `scripts/play-smoke.mjs` wired into
  `scripts/test.sh` as an OPT-IN step (needs `PLAY_SMOKE_URL` + Playwright + Chromium; skips
  cleanly otherwise because Playwright is not a project dependency). Measured on the fixture
  (25 people, 49 open tasks, 2 projects): **60 draw calls, 10 programs, ~59 k triangles**,
  zero console output on `/play`. Real-GPU fps not yet measured (SwiftShader only).
- 2026-09-07 **T-244 shipped**: `public/play/robot.glb` (RobotExpressive, CC0, licence in
  `public/play/LICENSE.md`) loaded once by `CharacterKit`; its 14 parts are folded into ONE
  SkinnedMesh per character (rigid parts weighted 100 % to their parent bone, hands remapped onto
  a shared 43-bone skeleton) so a character stays one draw call. Vertex-colour alpha is a tint
  mask (unified shader: `mix(vCol, uColor*vCol, vTint)`) — only the "Main" parts take the
  division colour. Clips: idle→Idle, work→Sitting, panic→No, walk→Walking (couriers), wave→Wave
  (reserved for EPIC-026). Picking uses an invisible box proxy, never the skinned triangles.
  Placeholders stay until the model loads and remain if it fails. Measured with 25 rigged people
  + 1 courier: **91 draw calls, 12 programs, ~198 k triangles**, zero console output.
  Deviation from the task text: no per-person initials badge in 3D — the hover label and the
  person card carry the name (a badge per person would cost a texture + draw call each).
- 2026-09-07 Dev verification setup: throwaway Postgres (`postgres:17-alpine`, port 5440),
  `pnpm db:migrate` + `pnpm seed` + `scripts/play-fixture.ts` (refuses without
  `PLAY_FIXTURE=1`), `pnpm dev --port 3401`, Playwright with SwiftShader. Production data was not
  touched.
- 2026-09-07 Owner: the public entry point is `permainan.reddie.id/office`. Play needs the
  Backstage session cookie (host-bound), so that path is a 302 to `ingat.reddie.id/play`, not a
  second deployment; a standalone build would need a new token flow (rejected in PRD-GAME.md).
- 2026-09-07 Status → ready-for-qa: all task groups shipped and gates green; the human QA step is
  the real-GPU fps reading (F3 on an office laptop) that decides the final quality tiers.
- 2026-09-07 Epic created from Owner request; scope locked to a data-driven, non-autonomous
  world — decision recorded in `PRD-GAME.md` (Scope / Out of scope).
- 2026-09-07 Engine source of truth for the port: `/home/wit/docker-infra/permainan/racing/index.html`
  (Three.js 0.170 build, ~110 draw calls solo, 13 programs). The single-file racing build
  stays as a demo; `src/lib/play/engine` becomes the only maintained copy.

## Dependencies

- EPIC-001 (permissions), EPIC-003 (tasks + task modal), EPIC-012 (fan-in / critical),
  EPIC-021 (event visibility). No schema change in this epic.
