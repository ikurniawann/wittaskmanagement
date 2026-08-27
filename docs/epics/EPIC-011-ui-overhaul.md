# EPIC-011: Plane-like UI/UX Overhaul

status: on-progress
environment: dev
phase: 1
priority: P0
area: UI/UX
retries: 0
prd: ../product/PRD.md
stories: ../product/USER-STORIES.md
tasks: ../product/ENGINEERING-TASKS.md (T-110 … T-114)

## Goal

Owner feedback (2026-08-06): the MVP UI feels stiff ("kaku"). Rework the experience to
feel like Plane.so / Jira — sidebar navigation, denser and friendlier surfaces,
functional status/priority colors, and task details opening in a **dialog/drawer**
instead of a page navigation. Keep the RVC monochrome chrome; color becomes functional
(status, priority), not decorative.

## Tasks

### Sidebar app shell

- [x] **T-110** Replace the top-bar shell with a Plane-style collapsible left sidebar: logo, primary nav (My Tasks / Events / Dashboard / Admin), active-events quick list, user block (avatar, name, sign out) + bell + theme toggle. Slim content top bar.

### Task peek dialog

- [x] **T-111** Intercepting route (`@modal` slot + `(...)tasks/[id]`) so clicking a task anywhere opens a right-side drawer over the current view; URL still `/tasks/[id]` (shareable, refresh → full page). Shared detail panel between drawer and full page.

### Functional color system

- [x] **T-112** Status + priority color tokens (both themes) and shared `StatusDot` / `PriorityIcon` components; monochrome chrome unchanged.

### Board & list polish

- [x] **T-113** Plane-style kanban cards (priority icon, due chip, avatar stack), colored column headers with counts; list + My Tasks rows with dots/icons/avatars and hover states.

### Consistency pass

- [ ] **T-114** (feedback batch 1 landed: humanized activity feed, dark-grey dashboard cards) Events gallery + workspace + forms aligned to the new density/tone; dark/light verified.

## Acceptance Criteria

- Clicking a task from board/list/My Tasks opens a drawer without losing the underlying view; browser back closes it; direct URL loads the full page.
- Sidebar navigation works on desktop and collapses on mobile.
- Status/priority are color-coded consistently across board, list, My Tasks, and the peek.
- All existing permission gates and actions keep working (no service-layer changes).

## Automation Log

- **Design refresh — the token layer** (2026-08-12). The Owner said the app
  read as monotonous and stiff *after* the earlier overhaul. That is the
  useful signal: the previous pass worked inside the design rules, so it
  could add clarity but not character. The rules themselves were the cause.
  - **Every neutral was `chroma 0`** — not "greyish" but literally
    colourless, which is why every surface read as a default rather than a
    choice. Background, card, muted, accent and border now carry 0.003–0.007
    chroma at hue 75. Below conscious notice, above feeling. Verified in the
    compiled stylesheet: `--background: #fffdfb`, `--card: #f8f6f3`.
  - **One typeface did body and headings**, so nothing on a page had a voice.
    Bricolage Grotesque now serves h1–h3 only — editorial rather than
    corporate, which suits a concert promoter — while Geist keeps body text,
    where it is the better reader. Applied from one base rule, so no
    component needed a class.
  - **`--radius` 0.375 → 0.625rem.** Tight corners plus hairline borders plus
    flat fills is the exact recipe for "stiff"; the comment in the file even
    said "architectural, not bubbly". Still architectural, no longer sharp.
  - A 6px/180ms entrance on the content well, keyed on the route so it
    replays on client-side navigation — `<main>` survives a transition, so
    without the key it would only ever run on a full page load. Removed
    entirely under `prefers-reduced-motion`, not merely shortened.
  - **Not done, deliberately:** no accent colour. The Owner chose the
    reversible token-level pass first, and the app's own rule — "colour comes
    from event posters, never from the UI chrome" — deserves a separate
    decision rather than being quietly broken here.
  - Gates: lint ✅ typecheck ✅ 374 tests ✅ build ✅ security ✅.


- 2026-08-07 **T-114 batch: persistent event context + phase data integrity
  + dependency badge coverage** (Owner follow-up after spotting a workflow
  phase question on `/events/[id]/list`).
  - **Persistent event context bar.** New `events/[id]/layout.tsx` +
    client `EventContextBar` render name + current phase + health + a
    day-count ("Nd to show" / "Show day" / "Nd since show") in a sticky bar
    on every event sub-page (Board, List, Calendar, Budget, Handoffs,
    Guests, Documents, Pages, Run of show, Tickets, Gantt) — replacing 11
    duplicated "← {event.name}" breadcrumbs. Hidden on the event ROOT page
    (`/events/[id]`) since that page already has its own full hero
    (poster, live countdown, phase stepper); the bar checks `usePathname()`
    for an exact match. `pages/[pageId]` keeps its own "← pages" crumb
    underneath (two-level breadcrumb, not redundant).
  - **Root cause fixed: workflow phase `sort_order` collisions.** Found
    while answering the Owner's question — event "Midnight Frequency" had
    two phases ("Plan" and the seeded "Planning") both at `sort_order 0`.
    Cause: the seeder's bulk phase insert used `onConflictDoNothing` keyed
    on `(event_id, name)`, so a manually-added phase with a *different*
    name at the same slot never conflicted and both rows kept sort_order 0.
    Fixed at three levels: (1) migration `0023_phase-sort-order-integrity.sql`
    — dedupes any existing collision (preferring the event's current phase,
    then a canonical `DEFAULT_PHASES` name, then lowest id as a last
    resort), renumbers every event's phases contiguously 0..n-1, then adds
    a **unique index** `(event_id, sort_order)` so the class of bug is
    structurally impossible from here on; (2) `movePhase` rewritten to a
    transaction routed through a negative scratch sort_order — the old
    direct two-step swap would now fail outright against the new unique
    index (Postgres checks non-deferred unique indexes per-statement, not
    at commit); (3) `deletePhase` now renumbers the remainder contiguously
    in the same transaction, closing gaps immediately instead of letting
    sort_order drift; (4) `seed.ts` now skips an event entirely if it
    already has ANY phases, instead of trusting per-name conflict
    resolution. Verified E2E: 4 repeated up/down moves stay contiguous, a
    fresh `addPhase` lands collision-free, `deletePhase` closes the gap,
    and a raw duplicate insert is rejected by the new index — 5/5 PASS.
  - **Dependency badge coverage extended.** The ⧗/N↩ badge (EPIC-012)
    previously only appeared on the Board and List kanban/list cards.
    Added to My Tasks' Assigned/Created/Watched tabs and the Dashboard's
    Milestones list — everywhere a task title is listed for someone to
    scan now shows whether it's waiting on something or is itself a
    bottleneck others are waiting on.
  - Gates green (179 tests, clean build); deployed DEV; live-verified the
    context bar on `/list` (shows current phase + day count, hidden on
    root), all my-tasks tabs 200, and a service-level E2E confirming badge
    data resolves correctly on the new surfaces.

- 2026-08-07 **T-114 batch: design-overhaul leveling pass** (spreading
  packages A-D to every remaining surface, per Owner review after the
  first overhaul commit).
  - **Native `<select>` fully eliminated** (Owner's standing no-basic-
  controls directive) — replaced the last 6 offenders: task edit recurrence
  + label-color picker (`Segmented`, now supports `onValueChange` for
  controlled callers), new-approval-form type/division/event, budget
  AddLine/NewExpense division+line, handoff request from/to division (new
  shared `ChipPicker`), and the admin audit log filters (new
  `AuditFilterBar` client component: Segmented for entity type, chip rows
  for actor/event, still a plain GET form).
  - **Toast coverage widened**: new `useActionToast` hook (fires on a
  `useActionState` pending→settled transition; accepts a plain string or a
  `RefObject<string>` for click-dependent messages) wired into comment
  post, approval decide (both the dashboard inline and the detail page,
  message depends on which button fired), budget line/expense forms,
  handoff request. Task-drawer status buttons extracted into a client
  `StatusButtons` component so status changes toast consistently with the
  kanban card's existing "Moved to…" toast.
  - **Bugfix while wiring StatusButtons**: pulling `TaskStatus`/
  `STATUS_LABELS`/`TASK_STATUS_ORDER` from `lib/tasks/service.ts` into a
  client component pulled the whole `db`/`postgres` module into the browser
  bundle (build failure). Extracted the pure constants into a new
  `lib/tasks/status.ts` with no DB import; `service.ts` now imports +
  re-exports from it. Any future client component needing task-status
  constants should import from `status.ts` directly, never `service.ts`.
  - **Skeleton loading** added for board / list / timeline / approvals.
  - **Subtitles** added to Calendar and Admin headers.
  - **EmptyState** applied to the documents library.
  - Gates green (179 tests, clean build); deployed DEV; spot-checked audit
  filters, budget forms, handoffs form, documents empty state, and a task
  drawer's status row all live (200, correct markup).

- 2026-08-07 **T-114 batch (Owner): design overhaul — packages A–D + sentence
  case, all four approved via AskUserQuestion.**
  - A Hierarchy/depth: elevation tokens `--shadow-elev(-hover)` both themes +
    `.elev` / `.elev-hover` utilities (lift on hover = clickability
    affordance); dark bg 0.125 / card 0.19 for more separation; primary action
    per page now SOLID (Advance phase, New task, New page), secondary outline,
    destructive ghost.
  - Typography: uppercase removed from page h1s, section h2s, task titles
    (sweep of 4 class patterns across ~40 files); kept for micro-labels,
    breadcrumb links, table headers, logo, and event NAMES (poster identity).
  - B Feedback: sonner Toaster mounted in root layout (theme-aware, elev
    shadow); toasts on kanban status move, preferences save, playbook apply;
    skeleton `loading.tsx` for dashboard / my-tasks / event workspace.
  - C Guidance: one-line subtitles under Dashboard/Events/Approvals/Timeline
    h1s; `EmptyState` component (icon + invitation + CTA) applied to events
    index + timeline; dashboard section headers got icons.
  - D Functional color: HealthBadge now tinted fills (green/amber/red);
    `UserAvatar` deterministic per-person tint (hash → 8-color palette via
    color-mix, both themes).
  - Gates green (179 tests); deployed DEV; 7 main pages 200 with elev +
    colored badges + subtitles verified in payload.

- 2026-08-07 **T-114 batch (Owner): task Lead/PIC.** `tasks.lead_id` (migration
  0022) — one accountable person per task, shown ABOVE Assignees in the drawer
  (crown chip + single-select popover `lead-picker.tsx`; replace/clear;
  optimistic). Create-task dialog gains a "Lead / PIC" single-select chip row
  (`LeadSelect`, resets per division). `setTaskLead` gated `task.assign`;
  new lead notified ("You are now the lead (PIC)"); set/clear logged. E2E:
  create-with-lead + notify + cross-division denial + replace + clear all
  PASS; gates green; deployed DEV; drawer live shows Lead / PIC section.

- 2026-08-07 **T-114 batch (Owner): "Your work" My Tasks profile** (Plane
  reference screenshot). `/my-tasks` rebuilt: tabs Summary / Assigned /
  Created / Watched / Activity (?tab=). Summary = overview cards (created /
  assigned / watched counts), 7-status Workload cards, open-task bars by
  priority + state (token colors), personal Recent activity (humanized via
  `lib/activity-labels`, relative timestamps). Right profile panel: avatar,
  email, role, joined date, WIB clock, My divisions (membership + role),
  "Working on" events with open-task counts. Assigned tab keeps the original
  T-033 due-buckets. Data in `src/lib/tasks/my-work.ts` — strictly me-scoped
  queries; clock reads live in lib (render purity rule). Sign-out moved into
  the profile card. Gates green; deployed DEV; all five tabs live 200.

- 2026-08-07 **T-114 batch (Owner): event workspace navigation.** Sidebar event
  entries now expand (chevron; auto-open inside the event) into Board / List /
  Calendar / Handoffs / Budget / Guests / Documents / Run of show / Tickets —
  same component serves desktop + mobile nav. Gantt merged under Calendar as a
  "Schedule" page pair with a Calendar⇄Gantt view toggle (`schedule-view-toggle`);
  sidebar highlights Calendar for both routes. Event detail page: plain tab
  links removed, replaced by a Task summary (shared progress rule from
  `lib/tasks/progress`, status mix, overdue count, per-division bars linking to
  filtered boards; computed in `lib/events/task-summary` — clock reads banned in
  render by react-hooks purity). Manage controls (Workflow/Divisions/PDF/
  Playbook) unchanged. Gates green; deployed DEV; verified live.


- 2026-08-06 **T-110..T-113 done** — sidebar shell (desktop fixed + mobile sheet, events quick list with health dots, user block), task peek drawer via Next intercepting route (`@modal` slot + `(...)tasks/[id]`; back closes, refresh → full page, shared `TaskDetailPanel`), functional color tokens + `task-meta.tsx` atoms (StatusDot/Chip, PriorityIcon Jira-style chevrons, AvatarStack), kanban/List/My-Tasks re-skinned. `/` now redirects to my-tasks. Gotcha: react-hooks v7 `purity` rule bans `Date.now()` in render — capture via `useState(() => Date.now())`. Deployed to DEV; all pages 200. **T-114 open**: Owner reviews the new look (esp. dark/light + events pages density) and reports what still feels stiff.
- 2026-08-06 Epic created from Owner UX feedback — supersedes the top-bar shell from T-004.

## Dependencies

- EPIC-003 (the surfaces being reworked).
- 2026-08-18 — Mobile navigation sheet could not be scrolled (Owner: "navbar
  menu tidak bisa di scroll (freeze)"). The sheet panel is a fixed-height flex
  column (`h-full`), and its content list owned no scroll area: a flex child
  will not shrink below its content without `min-h-0`, so the overflow spilled
  outside the panel while the page behind stayed scroll-locked — which reads
  as a frozen menu. The list is now `min-h-0 flex-1 overflow-y-auto
  overscroll-contain`, the header `shrink-0`, and the bottom padding respects
  `env(safe-area-inset-bottom)`. Fixed in `mobile-nav.tsx`, NOT in the
  protected `components/ui/sheet.tsx`; the task-peek sheet was already correct
  because it sets `overflow-y-auto` on the panel itself.
