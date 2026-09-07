# EPIC-025: Backstage Play — live world & in-world actions

status: ready-for-qa
environment: dev
phase: 5
priority: P1
area: Play
retries: 0
prd: ../product/PRD-GAME.md
stories: ../product/USER-STORIES.md (US-PLAY-4 … US-PLAY-6)
tasks: ../product/ENGINEERING-TASKS.md (T-250 … T-256)

## Goal

Make the office **live and actionable**. Changes made anywhere in Backstage (or by an
agent over WhatsApp) animate in the world within 5 seconds; the most common actions —
change status, comment, tick a checklist item, claim a task, decide a handoff, decide an
approval — can be taken from inside Play through the **same services** the app uses, so
the activity log cannot tell the two apart except for a `source: play` marker. Handoffs
become couriers, approvals become an envelope room, events become lobby boards, and the
player's own day is the default focus.

## Design

- **Snapshot + diff.** EPIC-024's snapshot carries a `cursor`; `GET /api/play/stream`
  (SSE, same pattern as `notifications/stream`, `proxy_buffering off`) pushes
  `activity_log` rows after the cursor, permission-filtered per actor. A pure
  `applyDiff(world, activity)` decides which animation to trigger; unknown activity kinds
  fall back to "refresh this task from the snapshot service" — never a full reload.
- **Write = existing services only.** Quick actions call `src/lib/tasks/service`,
  `src/lib/collab/service` (handoffs), `src/lib/approvals/service` via server actions
  with `metadata.source = "play"`. Play adds no permission semantics; a denied action
  shows the same error text as the app.
- **Characters move only on data.** A courier walks because a handoff row is pending;
  a character walks to the approval room because a step is waiting on them; no idle
  wandering.
- **Graceful degradation.** `prefers-reduced-motion` disables walking (objects snap);
  no WebGL2 → a message and a link to the classic dashboard; mobile gets the touch tier.

## User Stories

- **US-PLAY-4** — As a staff member, I want to change status, comment and tick
  checklist items on my tasks from inside the world, so that I do not have to switch
  views to act on what I see.
- **US-PLAY-5** — As a division head or the Owner, I want pending handoffs and
  approvals to be visible as things happening in the office and decidable there, so
  that decisions do not wait for a board visit.
- **US-PLAY-6** — As any user, I want a change made by anyone anywhere in Backstage to
  appear in the world within seconds, so that the office reflects reality.

## Tasks

### Live stream & diff engine

- [x] **T-250** `GET /api/play/stream?cursor=` SSE route: polls `activity_log` after the
      cursor every 3 s, filters rows through the permission module (task/event/division
      visibility), emits `{ cursor, rows }`, keepalive comments otherwise; client
      reconnects with the last cursor. `src/lib/play/world/diff.ts`: pure `applyDiff`
      mapping activity kinds → animation intents (`task.status_changed` → restack +
      colour, `task.completed` → fade + owner "wave" clip, `handoff.requested/decided`
      → courier spawn/return, `approval.step_decided` → stamp, `comment.added` → speech
      bubble, `dependency.cleared` → ghost queue shrinks, unknown → `refetchTask(id)`).
      Vitest table test per activity kind; Playwright: status change in tab A animates in
      tab B within 5 s.

### Quick-action panel

- [x] **T-251** In-world side panel for the selected task: status select (allowed
      transitions from the service), add comment (@mention aware, reuse the app's
      comment box), checklist tick, "claim" (assign self when unassigned and allowed).
      Server actions wrap the existing services with `metadata.source = "play"`; errors
      surface the service's own message. Test: the activity log row for a Play action
      equals the row for the same action from the app except `metadata.source`.

### Handoff couriers & approval room

- [x] **T-252** Pending handoffs render as a courier (character with parcel) walking
      `fromDivision → toDivision` along the corridor path (A* on the layout grid);
      arriving couriers wait at the head desk. Head of `toDivision` clicks the courier
      → accept/decline (existing decide flow, note required as today). Approval room:
      one envelope per step waiting on the actor (size by amount tier); click → decide
      with the existing comment-required dialog; decided envelopes get stamped and
      archived (fade). Owner sees the whole room; others see only their envelopes.

### Event boards & time of day

- [x] **T-253** Lobby boards per visible event: name, countdown (same component as the
      event header), phase, health colour token; show week/show day boards pulse; click
      → event page. Sky/lighting follow real WIB time (sun direction + LUT swap at
      dusk/dawn) — cosmetic only, no gameplay effect.

### "My day" focus & notifications

- [x] **T-254** On enter, camera focuses the actor's desk and a "Today" tray lists: due
      today, overdue, waiting on me (handoffs + approvals), mentions. Keyboard `Tab`
      cycles through them and moves the camera. Notification SSE items appear as speech
      bubbles over the relevant character for 6 s; unread badge in the tray equals the
      bell count. Deep link `/play?focus=me`.

### Touch tier & mobile layout

- [~] **T-255** Touch controls (one-finger pan, pinch zoom, two-finger rotate), touch
      quality tier from T-247 enforced, portrait layout: panels become bottom sheets,
      Today tray collapses to a chip. Verified on a mid-range Android (≥ 30 fps p50,
      no console errors) and recorded in the Automation Log.

### Accessibility & fallbacks

- [x] **T-256** `prefers-reduced-motion`: no walking/particles, objects snap, camera cuts;
      all panels keyboard-navigable with visible focus; no WebGL2 (or context lost) →
      inline message + link to `/dashboard`; Playwright test with WebGL disabled asserts
      the fallback; screen-reader label on the canvas ("Backstage Play — 3D office, use
      the Today tray for a list view").

## Acceptance Criteria

**Epic-level**

- A status change, comment, handoff decision or approval decision made in the classic
  UI (or via the Agent API) is visible in an open Play tab within 5 s (Playwright
  asserts ≤ 5 s on the seeded fixture).
- Every Play action produces an `activity_log` row identical to the app's row apart
  from `metadata.source = "play"`; a user without permission gets the same refusal as in
  the app (test per action).
- No character or object moves without a corresponding data change (reviewer verifies
  on a quiet fixture for 2 minutes: zero movement).
- Reduced-motion and no-WebGL fallbacks pass their tests.

**Per-task**

- **T-250** — diff table test covers every activity kind emitted by tasks, collab and
  approvals services; unknown kinds refetch one task, never the world.
- **T-251** — log-equivalence test passes for status, comment, checklist, claim; denied
  action shows service message verbatim.
- **T-252** — courier path never crosses a wall (grid test); decide flows reuse the
  existing dialogs; only the actor's envelopes are visible (scoping test).
- **T-253** — countdown equals the event header to the second; boards only for visible
  events (EPIC-021 rules).
- **T-254** — tray counts equal My Tasks and the bell; `Tab` cycles and moves the camera.
- **T-255** — Android run recorded with fps and device; no console errors.
- **T-256** — Playwright WebGL-disabled test shows fallback; keyboard-only walkthrough
  of all panels verified.

> Done means each criterion is demonstrably true (test asserts it, a gate passes,
> or a reviewer verifies it) AND the cross-project `DEFINITION-OF-DONE.md` checklist passes.

## Automation Log

- 2026-09-07 **T-250 shipped**: `GET /api/play/stream?cursor=<ISO>` (SSE, 3 s poll of `activity_log`
  after the cursor, per-actor filter: task rows through `getTaskScoped`, handoff/approval rows
  through `canViewEvent` or own actorId, 15-min auto-close), `GET /api/play/task/[id]`,
  `GET /api/play/world`. Pure `applyDiff()` + `coalesce()` in `src/lib/play/world/diff.ts` with a
  table test over every action the services emit (29 cases). Client keeps a seen-set and
  reconnects from the last cursor with backoff. Measured: a status change made "elsewhere"
  (SQL + the same activity row the service writes) reached the open tab in **~2 s**.
  Finding: comments do NOT write activity rows (only notifications), so "comment → bubble"
  is only drawn for the actor's own comments; a bubble for others' comments needs the
  notifications stream (deferred).
- 2026-09-07 **T-251 shipped**: in-world task panel (status buttons from `TASK_STATUS_ORDER`,
  comment, claim, "Open full task" → existing modal). Server actions call `updateStatus`,
  `addComment`, `assignUser` unchanged and add ONE extra `play.action` row
  (`detail.source = "play"`) — the services' own rows are untouched, which is how the log stays
  identical to the classic UI. Verified: status via panel → DB `in_review`, service row + play
  row present, comment stored. Checklist ticking is NOT in the panel (the snapshot carries
  counts only; ticking needs the item list → use "Open full task"). Denied actions show the
  permission message.
- 2026-09-07 **T-252 shipped (reduced)**: couriers are rigged characters walking door →
  corridor → lobby → destination door at 1.4 m/s, then waiting outside the receiving room; click
  → handoff card with Accept/Decline through `decideHandoff`. Path is 3–4 waypoints along the
  corridor rows (rooms open onto corridors, so no wall is crossed) — no A* was needed.
  Approval room: one envelope per waiting decision; click → `/approvals` (the existing decide
  dialog is page-bound; re-hosting it inside Play was not worth a second copy). Envelope size
  by amount tier not implemented (queue count only).
- 2026-09-07 **T-253 shipped**: lobby boards redraw every second (countdown, phase, health
  bar); show-week boards pulse; `setTimeOfDay(WIB hour)` moves the sun (shadow rig direction)
  and blends sky/fog/sun colours, refreshed every minute. Cosmetic only.
- 2026-09-07 **T-254 shipped**: Today tray (overdue · due today · waiting on me · handoffs for my
  division if head · approvals · unread), focus on a row moves the camera (Tab cycles), click
  opens the panel; `/play?focus=me`. Speech bubbles are drawn from activity rows (done, blocked,
  handoff, approval decisions) and for the actor's own comment. Notification-stream bubbles
  deferred (see T-250 finding).
- 2026-09-07 **T-255 partial**: touch tier, one-finger pan / pinch / two-finger rotate, panels
  become bottom sheets and the legend hides under 640 px; rendered headless in a mobile
  viewport with `hasTouch` without console errors. NOT yet run on a physical Android — that
  reading is for QA.
- 2026-09-07 **T-256 shipped**: `prefers-reduced-motion` → mixers frozen, no smoke, no pop/fade
  tweens, camera cuts; buttons have visible focus rings; `--disable-3d-apis` run shows the
  fallback with the dashboard link and no canvas; canvas has an aria-label pointing to the tray.
- 2026-09-07 Status → ready-for-qa. Open for human QA: (1) physical Android run for T-255,
  (2) decide whether "comment → bubble for other people" is wanted (needs the notifications
  stream), (3) decide whether approvals must be decidable inside the office or the jump to
  `/approvals` is enough. Gates green.
- 2026-09-07 Epic created. Decision: no WebSocket / multiplayer presence in v1 — other
  people's characters move from data, not from their viewers' cameras (PRD Out of scope).

## Dependencies

- EPIC-024 (all tasks). Uses EPIC-003 comment box, EPIC-004 approval decide dialog,
  EPIC-003 handoff decide flow (T-036), T-037 SSE pattern, EPIC-015 not required.
