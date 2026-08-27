# EPIC-023: Agent API — external agents over WhatsApp

status: ready-for-qa
environment: dev
retries: 0

## Goal

Let an external agent (OpenClaw / Hermes / any framework) read, write and
update rvc.reddie.id on behalf of people chatting with it on WhatsApp —
WITHOUT an all-access token. Owner asked for a god token (2026-08-18); the
shipped design replaces it with two credentials per request, because WhatsApp
is a hostile input channel: one injected message in a group must never be able
to read a sealed dataroom folder through the agent.

## Design

- `Authorization: Bearer rvca_…` — proves WHICH AGENT calls. Stored as a
  SHA-256 hash only (`agent_api_keys`, migration 0042); plaintext shown once.
- `X-On-Behalf-Of: <nomor WA>` — names WHICH HUMAN it speaks for. Normalised
  via the existing `normalizeMsisdn` and matched against `profiles.phone`;
  the request then runs as that user through `src/lib/permissions`. A key
  alone can read nothing. Externals and deactivated users are refused.
- Per-key rate limit 120/min (in-memory, single-container honest).
- Admin → "Agent API keys": create (token displayed once), list with tail +
  last-used stamp, revoke.

## Endpoints (v1)

| Method | Path | Does |
|---|---|---|
| GET | /api/agent/me | identity + role + memberships |
| GET | /api/agent/events | visible events |
| GET | /api/agent/events/:id | header, crew, divisions, latest ticket figures |
| GET | /api/agent/tasks?eventId= / ?mine=1 | scoped task lists |
| POST | /api/agent/tasks | create (marks description "via agent …") |
| GET/PATCH | /api/agent/tasks/:id | detail / status·priority·title·dueDate |
| POST | /api/agent/tasks/:id/comments | comment, suffixed "via <key>" |

## Automation Log

- 2026-08-18 — Shipped and verified end-to-end over live HTTP: no token → 401;
  token without identity → 401 with instruction; unknown phone → 403; owner
  phone → me/events/event-detail read OK, task created + status/priority
  patched + comment posted, ticket summary served (124 tickets across both
  channels with the staleness note). Probe task deleted, probe key revoked.
- 2026-08-18 — Every mutation is attributable twice: the activity log carries
  the acting USER (not the key), and created tasks/comments carry a plain
  "via <key>" suffix so a relayed action never masquerades as a hand-typed one.
- Next (when the Owner builds the agent): point OpenClaw/Hermes tools at
  these endpoints; the agent's WA layer must pass each sender's number in
  X-On-Behalf-Of. Group chat = identity of the SENDER, never the group.
- 2026-08-21 — **Dataroom endpoints added** (Owner: "update, add, delete dan
  melakukan semua akses di dataroom melalui agent hermes"). Eight routes under
  /api/agent/dataroom/**, all thin wrappers over src/lib/dataroom/service.ts,
  so sealed/division visibility, nesting rules, quota and the access log apply
  unchanged. Upload mirrors the app's raw-PUT streaming contract (quota is
  checked while streaming, never after buffering); download streams bytes and
  is logged by openForDownload in the same step that resolves it; DELETE on a
  file is ALWAYS soft (trash) — an injected "delete everything" must leave a
  road back — and a non-empty folder refuses deletion. Verified end-to-end on
  a ZZ probe event (created → upload → list → download bytes → rename → move
  → non-empty delete refused → trash → folder delete), probe event, bytes and
  key all removed after.
- 2026-08-21 — **Full-sidebar coverage** (Owner: "semua menu dan module …
  buatkan endpoint nya"). 19 new routes: timeline, approvals (queue/detail/
  decide/create — comment REQUIRED on decisions taken from chat), standalone
  pages + event pages (markdown in, converted via markdownToDoc so pages open
  cleanly in the editor), dashboard (one call), calendar (WIB range),
  search, budget + expenses (expense POST opens the approval chain exactly
  like the form), guests (magic link returned, never auto-sent), handoffs
  (request + decide), run of show (CRUD), tickets (per-channel figures +
  manual snapshot), admin users/divisions/branding (org.manage asserted;
  user rows mapped explicitly so the password hash can never ship). All 16
  GET surfaces probed live → 200; write paths verified for run-of-show and
  pages; probe artifacts removed and the probe key revoked.
- 2026-08-21 — Kintsugi Intelligence deliberately has NO endpoint: Hermes is
  itself an LLM, and proxying question→Kintsugi→answer pays two models for
  one answer over the same context these endpoints already expose. Recorded
  as a decision, not an omission; if ever needed it is a separate refactor
  (extract the SSE pipeline from the chat route).
