# EPIC-027: Backstage Play — polish (smoothness, Reddie character, furnished lobby)

status: ready-for-qa
environment: dev
phase: 5
priority: P1
area: Play
retries: 0
prd: ../product/PRD-GAME.md
stories: ../product/USER-STORIES.md (US-PLAY-1, US-PLAY-4, US-PLAY-11)
tasks: ../product/ENGINEERING-TASKS.md (T-270 … T-272)

## Goal

First-week feedback from the Owner after Play went live on ingat.reddie.id (2026-09-07):
the office should **run smoother**, the characters should **look like the Reddie robot**
(the reddie.id mascot: red round helmet, dark visor, white eyes, red body with dark joints),
and the **lobby and corridors should not be empty** — a coffee spot, lounge, printer corner,
plants and the like. None of this changes what Play *means*: every object is still generated
from data, nothing moves unless data changed, and nothing here touches permissions or XP.

## Tasks

| ID | Task | Exit |
| --- | --- | --- |
| T-270 | Smoothness: GPU-class quality tiers (integrated vs discrete), adaptive resolution with hysteresis + ceiling memory, frame-rate-independent camera easing, staggered board redraws, Auto / Performance / Quality switch in the Play toolbar (persisted per browser) | No periodic resolution "breathing"; the switch changes MSAA/DPR live; pure parts unit-tested |
| T-271 | Reddie character: procedural rigged robot in the shape of the reddie.id mascot (one SkinnedMesh, same unified shader), five clips authored in code (idle, work/sitting, walk, wave, panic), division colour on shoulders/chest emblem, cosmetics still attach | Looks like the mascot; one draw call per character; sits at the desk correctly; `robot.glb` no longer shipped |
| T-273 | Cinematic camera: establishing shot + fly-in on load, eased crane flights for every programmatic focus, guided tour (lobby → each division → approvals → my desk) with letterbox bars and data captions, any input or Esc interrupts | Flights land exactly; tour visits every room; reduced motion = cuts; pure parts tested |
| T-274 | Atmosphere in the post pass: depth of field around the camera target (rises during flights), film grain, edge chromatic aberration, vignette that breathes with the flight; all off on the Performance tier and under reduced motion | 0 console errors; ≤ 1 extra fullscreen pass (none — same pass) |
| T-272 | Furnished lobby & corridors: pure `furnish(layout)` places a lounge island (sofas, coffee table, rug, lamp), a coffee bar (counter, machine, stools, mugs), water cooler, printer corner, bookshelf, bins, plants — deterministic, never on a courier lane; couriers cross the lobby along door lanes instead of diagonals | Every desk/door still reachable on the walkable grid with furniture blocked; no placement overlaps a lane; ≤ 20 extra draw calls |

## Acceptance Criteria

- The Play toolbar offers Auto / Performance / Quality; the choice survives reload.
- Characters are the Reddie robot; each division is still recognisable by colour.
- Lobby and corridors contain furniture; couriers never walk through it.
- Tests green, typecheck clean, 0 console errors on `/play` (SwiftShader smoke).

## Automation Log

- 2026-09-07 (night) Epic created from the Owner's feedback right after the production
  go-live ("lebih smooth lagi", "robot reddie.id bentuknya", "di tengah lorong jangan
  kosongan … spot kopi dan lain-lainnya").

- 2026-09-07 (late) **T-270 shipped**: `classifyRenderer()` + `tierFor()` (integrated GPUs get
  MSAA 2 / DPR ≤ 1.25, discrete get MSAA 4 / DPR ≤ 2, touch unchanged, "performance" = no MSAA,
  512 shadow, DPR 1); `nextPixelRatio` now holds between 45–57 fps, climbs in 0.05 steps and
  remembers the ratio that last failed for 30 s (no more resolution breathing); camera easing is
  `1 − e^(−8·dt)`; event boards redraw one per slice instead of all six on the same frame;
  Auto / Performance / Quality `<select>` in the toolbar via `useSyncExternalStore` + localStorage
  `play.quality`, a change rebuilds the scene. Real-GPU fps still unmeasured here (SwiftShader only)
  — the Owner's laptop reading is the QA item.
- 2026-09-07 (late) **T-271 shipped**: `characters.ts` no longer loads a glTF. `CharacterKit.build()`
  authors the Reddie mascot in code — 13-bone rig, ~45 primitives folded into one SkinnedMesh
  (helmet, visor patch, brow ridge, eyes, smile, ears, ball joints), division colour on shoulder
  balls / chest emblem / belt via the vertex-alpha tint mask — and five clips as keyframe tracks
  (idle, work = seated with thighs forward and typing elbows, walk, wave, panic); every clip drives
  every bone so cross-fades never strand a limb. `robot.glb` + its licence note deleted (−460 KB).
  Cosmetics still attach (cap/crown at the head top, 1.72 m).
- 2026-09-07 (late) **T-272 shipped**: pure `world/furniture.ts` — `lanes()` (door columns through the
  lobby, corridor centre bands, approval band, board strip, east waiting column) and `furnish()`
  (lounge island: rug, 2 sofas, 2 armchairs, coffee table, lamp; coffee bar with machine, mugs, cake
  dome, 3 stools, bin, high table; printer + water cooler + bin; bookshelf; plants between doors and
  at corridor ends). 13 instanced kinds, +15 draw calls (96 → 111). `courierPath` now walks the
  corridor to the destination door's x and crosses the lobby on that lane — no diagonals through the
  lounge. Tests: deterministic, nothing on a lane, nothing overlapping, every door↔door and
  approval-door→desk path still reachable with furniture blocked (4 layouts).
- 2026-09-07 (late) Verified on office.reddie.id (SwiftShader): Reddie characters seated at desks,
  furnished lobby, quality switch persists and rebuilds, 0 console errors. 187 Play tests green,
  typecheck + lint clean. Status → ready-for-qa. Open for the Owner: (1) fps on a real office
  laptop with Auto vs Performance, (2) is the mascot likeness close enough, (3) prod redeploy —
  note the checkout also carries uncommitted Swagger/OpenAPI work that a `docker compose build`
  would include.

- 2026-09-07 (late) Owner: "perbaiki bayangannya, kalau susah hapus saja" → fixed, not removed
  (T-270 addendum). Cause: one 1024 px map over a fixed 190 m window (18 cm/texel) sampled with a
  single hard `step`, plus the hatch stripes on floors. Now: the ortho window follows the camera
  (0.75 × distance, 28–95 m half-width), 2048 px on discrete GPUs, the light camera snaps to whole
  texels (no edge crawl while panning), manual bilinear PCF × 2 diagonal taps in the shader (soft
  ~2-texel edge), bias 0.0012 → 0.0005, hatch 0.5/0.7/0.35 → 0.15/0.25/0.15. "Performance" now skips
  the shadow pass entirely (`uShadowStrength` 0). Tried `sampler2DShadow` hardware PCF first: three
  r170 does not apply `compareFunction` to render-target depth textures → GL "sampler type mismatch",
  reverted to the manual path. Verified on the test instance: smooth shadows at desk and lobby zoom,
  0 console warnings.

- 2026-09-07 (late) Owner pasted an "Awwwards-level" brief with GSAP ScrollTrigger / Lenis / R3F /
  Framer Motion. Decision: ScrollTrigger and Lenis are scroll-page tools and Play has no scroll; R3F
  would mean rewriting the MRT engine for no visual gain; Framer Motion adds ~100 KB for what Tailwind
  transitions already do. What *does* raise the bar was built instead:
- 2026-09-07 (late) **T-273 shipped**: `scene/cinematic.ts` (pure: `easeInOutCubic`, `craneDist`,
  `yawDelta`, `tourStops()`; 4 tests). `IsoCamera.flyTo()` = timed eased move of target + distance +
  yaw with a crane rise; pointer/wheel/key interrupt it and hand control back; `finishMove()` lands it
  when reduced motion switches on. On load: establishing shot from 120 m over the lobby, then a 2.6 s
  fly-in to my desk. Every focus (tray rows, buttons, deep links) is now a 1.2–1.5 s flight. Guided
  tour: `startTour()` walks lobby → each division (alternating angles) → approval room → my desk,
  2.4 s flights + 3 s holds; React shows 9 vh letterbox bars, a numbered caption (division name in
  its colour, people / open / blocked / overdue from the live world) with a 700 ms `cine-in`
  entrance, hides the HUD, and "Stop tour · Esc". Tray/panels use the app's `rise-in` entrance
  (tray excluded: `animation-fill-mode: both` would defeat the HUD fade).
- 2026-09-07 (late) **T-274 shipped**: post pass gains `uDof/uFocus` (8-tap disc blur weighted by
  |depth − target depth|, edge ink fades with the blur), `uGrain` (hash noise, luminance-weighted),
  `uCA` (radial R/B split at the edges); vignette 0.35 → 0.57 while flying. DOF strength eases
  0.35 → 1.0 during flights and 0.65 on tour. Performance tier and reduced motion: all off.
- 2026-09-07 (late) Verified on office.reddie.id (SwiftShader): fly-in lands on my desk, tour caption
  1/14 "Backstage · 2 events · 47 open tasks · 26 people" → 2/14 "Production · 3 people · 3 open · 1
  blocked · 1 overdue", Esc ends it and restores the HUD, 0 console errors, 100 draw calls at the desk.
  Real-GPU feel (flight smoothness at 60 fps) is the Owner's QA reading; SwiftShader runs at 2 fps.

## Dependencies

- EPIC-024 (engine, layout, characters), EPIC-025 (couriers), EPIC-026 (cosmetics on the character).
