# RVC Backstage — Epics

> **Canonical status registry.** This file + each `EPIC-XXX-*.md` frontmatter are
> the *live state of work* — first in the source-of-truth order (see
> `rules/docs-source-of-truth.md`). When the backlog, PRD, or tasks disagree with
> an epic, **the epic wins**. Templates live at `~/.agentic-workflows/templates/docs/epics/`.
>
> Seeds: [`../backlog.json`](../backlog.json) · [`../BACKLOG.md`](../BACKLOG.md).

## Registry

| Epic | Phase | Focus | Priority | Status |
| --- | --- | --- | --- | --- |
| [EPIC-000](EPIC-000-bootstrap.md) | Phase 0 | Bootstrap & Foundation (scaffold, DB, theme, CI, gates) | P0 | ready-for-qa |
| [EPIC-001](EPIC-001-auth-org-permissions.md) | Phase 1 | Auth, Org & Permissions | P0 | ready-for-qa |
| [EPIC-002](EPIC-002-events-workspace.md) | Phase 1 | Events Workspace | P0 | ready-for-qa |
| [EPIC-003](EPIC-003-tasks-collaboration.md) | Phase 1 | Tasks Core & Collaboration | P0 | ready-for-qa |
| [EPIC-004](EPIC-004-approvals-engine.md) | Phase 2 | Approvals Engine | P1 | ready-for-qa |
| [EPIC-005](EPIC-005-budgets-expenses.md) | Phase 2 | Budgets & Expenses | P1 | ready-for-qa |
| [EPIC-006](EPIC-006-executive-dashboard.md) | Phase 2 | Executive Dashboard & Activity Log | P1 | ready-for-qa |
| [EPIC-007](EPIC-007-external-guest-portal.md) | Phase 3 | External Guest Portal & Forms | P1 | ready-for-qa |
| [EPIC-008](EPIC-008-planning-views-run-of-show.md) | Phase 3 | Planning Views, Documents & Run of Show | P1 | ready-for-qa |
| [EPIC-009](EPIC-009-playbooks-ticket-snapshots.md) | Phase 3 | Playbooks & Ticket Snapshots | P1 | ready-for-qa |
| [EPIC-010](EPIC-010-reports-search-polish.md) | Phase 4 | Reports, Search & Polish | P2 | ready-for-qa |
| [EPIC-011](EPIC-011-ui-overhaul.md) | Phase 1 | Plane-like UI/UX Overhaul (Owner feedback) | P0 | on-progress |
| [EPIC-012](EPIC-012-dependency-bottlenecks.md) | Phase 4 | Dependency Bottlenecks & External Waits | P1 | ready-for-qa |
| [EPIC-013](EPIC-013-event-pages.md) | Phase 4 | Event Pages (Mini-Wiki) | P2 | ready-for-qa |
| [EPIC-014](EPIC-014-ai-assistant.md) | Phase 4 | AI Assistant (Predictive Chat) | P1 | ready-for-qa |
| [EPIC-015](EPIC-015-whatsapp-gateway.md) | Phase 4 | WhatsApp Gateway (Baileys) | P1 | ready-for-qa |
| [EPIC-016](EPIC-016-assistant-upgrade.md) | Phase 4 | Assistant upgrade — Pages, attachments, vision, save-to-page | P1 | ready-for-qa |
| [EPIC-017](EPIC-017-dataroom-core.md) | Phase 4 | Dataroom core — per-event files, quota, sealed folders, access log | P1 | ready-for-qa |
| [EPIC-018](EPIC-018-dataroom-share-links.md) | Phase 4 | Dataroom share links for people outside the system | P1 | ready-for-qa |
| [EPIC-019](EPIC-019-dataroom-watermark.md) | Phase 4 | Per-recipient watermarking (PDF + images) | P2 | ready-for-qa |
| [EPIC-021](EPIC-021-event-visibility.md) | Phase 4 | Event visibility follows involvement | P0 | ready-for-qa |
| [EPIC-022](EPIC-022-ticketing-channels.md) | Phase 4 | Ticketing channels — Tessera + Megatix | P1 | ready-for-qa |
| [EPIC-023](EPIC-023-agent-api.md) | Phase 4 | Agent API — external agents over WhatsApp | P1 | ready-for-qa |
| [EPIC-024](EPIC-024-play-foundation.md) | Phase 5 | Backstage Play — foundation (3D office generated from data, read-only) | P1 | ready-for-qa |
| [EPIC-025](EPIC-025-play-live-actions.md) | Phase 5 | Backstage Play — live world & in-world actions | P1 | ready-for-qa |
| [EPIC-026](EPIC-026-play-gamification.md) | Phase 5 | Backstage Play — gamification (XP, quests, recognition) | P1 | backlog |

**Definition of MVP:** completion of **EPIC-000 → EPIC-003** (Phase 0 + Phase 1 — a division can run its event work end-to-end).

**Phase gates:** work Phase N epics to `done`/`ready-for-qa` before promoting Phase N+1 epics
out of `backlog` (exceptions need a note in the epic's Automation Log). Within Phase 1 the
order is 001 → 002 → 003 (hard dependency chain through the permission module).

## Status Lifecycle

Every epic's `status:` moves through a fixed lifecycle:

```
backlog → on-progress → coding → review → testing → deploying-dev → ready-for-qa → done
                                                                   ↘ blocked (on failure)
```

| Status | Meaning |
| --- | --- |
| `backlog` | Not started; **ignored by automation**. |
| `on-progress` | Picked up by the loop; ready to be processed. |
| `coding` | Currently implementing a task. |
| `review` | Currently in code/QA review. |
| `testing` | Running the test/quality gate. |
| `deploying-dev` | Deploying to the DEV environment (never production). |
| `ready-for-qa` | All tasks passed gates — **human QA required** before done. |
| `blocked` | Failed after max `retries` — **human action required**. |
| `done` | Completed; **ignored by automation**. |

Only epics in `on-progress` (or a mid-flight phase) are picked up by the loop.
`backlog`, `done`, and `blocked` are skipped.

`environment` advances separately: `dev → staging → prod`. Automation operates on
`dev` only; `staging`/`prod` are human-triggered.

## Conventions

- **One epic = one feature/milestone.** Break it into `### task group` blocks
  (each PR-sized) inside the epic file.
- **Task IDs** come from `../product/ENGINEERING-TASKS.md` (blocks of 10 per epic;
  stable, never renumbered).
- **Automation Log is the durability anchor.** Every epic carries an
  `## Automation Log`; the self-learning loop's distilled decisions are copied
  there (memory is a cache, the log is version-controlled).
- **Add a new epic** by copying [`EPIC-template.md`](EPIC-template.md), then add a
  row to the registry above.
