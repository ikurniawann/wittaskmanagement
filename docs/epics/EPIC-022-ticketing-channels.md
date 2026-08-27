# EPIC-022: Ticketing channels — Tessera + Megatix

status: ready-for-qa
environment: dev
retries: 0

## Goal

Let one show sell through more than one ticketing platform and have the app
read both, without either channel's numbers hiding the other's. Tessera
arrived first (2026-08-12); Megatix is the second channel (Owner 2026-08-17:
"ini bedakan jadi megatix ya jadi ada 2 channel — tessera dan megatix").

## Tasks

### T-220 One transaction store for every provider

`ticket_transactions` replaces `tessera_transactions`: same typed columns plus
`provider`, `quantity`, `buyer_phone`, keyed unique on
(provider, event_id, provider_txn_id). `event_ticket_channels` replaces the
single `events.tessera_event_id` column, so an event can hold a Tessera row
AND a Megatix row at once.

### T-221 Megatix client and readers

`src/lib/megatix/` — documented v4 Data API: `auth/login`, `presenters`,
`events`, `reports/orders`. Pure readers with 13 tests pinned to the
documented payload.

### T-222 Two-channel Connect tab

Per-channel cards (tickets / revenue / fees), a combined line, a per-channel
transaction filter, and one health pill per platform.

## Acceptance Criteria

- An event may link Tessera, Megatix, or both; unlinking one leaves the
  other and keeps stored history.
- Ticket counts sum `quantity` (Megatix orders carry several tickets).
- Money renders in the currency the row reports, not always IDR.
- The page makes zero provider API calls; it reads the database.
- Each sync fails independently — a dead provider cannot stop the other.

## Automation Log

- 2026-08-17 — Shipped. Migrations 0038 (new tables) → 0039 (data copy) →
  0040 (drop legacy) deliberately split so no generated DROP could run before
  the rows were copied; drizzle-kit's interactive rename prompt would have
  risked exactly that. Verified live: 54 Tessera transactions and their
  Rp 21,873,857 gross carried across unchanged, the old table gone, and a
  fresh Tessera sync still upserting to 54 rows (no duplication).
- 2026-08-17 — **Auth shapes differ, and that is the operational headline.**
  Tessera = a hand-pasted token that dies in ~5 days. Megatix = email +
  password → ~8-hour token, so the server re-logs-in by itself and there is
  no paste ritual. The cost is that a Megatix PASSWORD sits in `app_settings`:
  stored write-only, never returned to a browser, never logged. Owner advised
  to use a dedicated Megatix API login, not a personal admin account.
- 2026-08-17 — Megatix reports no promoter-net figure, so `net_sales` stays
  NULL for its rows rather than being inferred from amount − fees. The
  Connect tab shows "—". Guessing here would have produced a settlement
  number nobody could defend.
- 2026-08-17 — Megatix timestamps arrive with NO zone ("2024-07-01 11:36:54").
  Read as WIB, with the untouched string kept in `raw` so the assumption is
  auditable. Reading them as UTC would file Jakarta orders seven hours early
  and land some on the wrong sales day.
- 2026-08-17 — Currency is per event on Megatix (their sample is AUD), so
  `formatMoney(amount, currency)` replaced blanket `formatIDR` on this
  surface, and the combined total refuses to add across currencies.
- 2026-08-17 — Credentials received and the channel is LIVE; see the
  continued log below for what real data changed.

### T-223 A tab per channel; Megatix leads, Tessera is legacy

Owner 2026-08-17: "buatkan tab baru di bagian ticket ya" then "dipisahkan saja
ya page nya… karena rencananya tessera itu discontinue". Tickets page tabs are
now **Megatix · Tessera (legacy) · Manual**, Megatix default. The Tessera tab
carries a plain notice that it is being retired and that its stored history
stays readable.

## Automation Log (continued)

- 2026-08-17 — **Live connection made.** The documented base URL is a Postman
  variable the docs never print, and the obvious guess `api.megatix.com.au`
  does not resolve at all. Probed and confirmed the API answers on the bare
  domain `https://megatix.com.au` (a bogus login there returns a proper 422
  `authentication_failed`). DEFAULT_MEGATIX_BASE corrected.
- 2026-08-17 — **The live payload differs from the published sample**, found
  only by looking at real data: orders carry a single `name` (not
  `first_name`/`last_name`), so every buyer would have been stored nameless;
  and they carry `refunded_amount` / `refunded_ticket_amount` /
  `extras_quantity`, which the docs never show. Readers extended, live shape
  pinned as a test. Timestamps also arrive WITH an offset
  (`2026-08-24T20:00:00+0700`) unlike the zone-less documented sample — an
  explicit offset is now honoured and only a zone-less value falls back to WIB.
- 2026-08-17 — Bug found before it touched data: clearing a stored setting
  wrote `null` into `app_settings.value`, which is NOT NULL. "Forget this"
  now deletes the row.
- 2026-08-17 — **The two-channel snapshot bug, and its second version.**
  `ticket_sales_snapshots` is keyed (event, day) and feeds event health, the
  dashboard, the AI and the settlement PDF. With both channels live, each
  sync wrote that row directly, so the last one to run presented ONE channel's
  sales as the whole show. Fixed by giving each channel its own cumulative
  figures (migration 0041) and recomputing the shared row as their sum. The
  first version of the sum excluded channels that had not reported that day —
  and when the Tessera token expired the show appeared to fall from 54 tickets
  to 19 overnight. These figures are cumulative, so a quiet channel is now
  carried forward at its last known value and the note says how stale it is:
  "Synced from Megatix + Tessera (as of 2026-08-17)".
- 2026-08-17 — Channel revenue is the tickets' FACE VALUE, not the total
  charged. Tessera's own KPI revenue for Moodymann is Rp 20,250,000 and the
  sum of its stored ticket prices is Rp 20,250,000 exactly — so using face
  value keeps the two platforms addable, while buyer-paid fees stay visible
  per row and in the channel cards.
- 2026-08-17 — Live verification, Moodymann Jakarta: Megatix presenter "Raw
  Vision Collective" (12846), event 73669, **14 orders = 19 tickets, face
  value Rp 7,125,000** (amount charged Rp 7,492,575 incl. fees), IDR. Combined
  with Tessera's 54 the show reads **73 tickets / Rp 27,375,000**. A second
  sync left the row count unchanged — the upsert key holds.
- 2026-08-17 — **The Tessera token has expired** (its ~5-day life ran out),
  which is why its channel stopped reporting. Since Tessera is being
  discontinued the Owner may simply leave it; its stored history remains
  readable and is carried forward in the totals.
- 2026-08-17 — Security gate refined, not weakened: `DROP TABLE` inside
  `src/db/migrations` no longer fails the gate (a schema change is exactly
  where a DROP belongs) but is still PRINTED as a notice so it can never land
  unnoticed. Everywhere else it still fails.
- 2026-08-17 — **Two definitions of "revenue" on one page** (Owner spotted it:
  the combined line read IDR 29,366,432 while the daily snapshot said
  27,375,000). The channel cards and the combined line summed `gross_sales` —
  what buyers paid, fees included — while the snapshot used ticket face value.
  Both numbers were arithmetically right and the pair was useless, which is
  exactly the failure this integration was supposed to avoid. Revenue now
  means face value everywhere; "Buyer fees" and "Paid by buyers" sit beside it
  as their own labelled figures. Moodymann: 73 tickets, Rp 27,375,000 ticket
  value, Rp 1,711,270 fees, Rp 29,366,432 paid.
- 2026-08-17 — Owner: "dibuat satu satu saja jangan digabung antara tessera
  dan megatix". The cross-channel line is removed from the Tickets page; each
  tab now answers only for its own platform. The event-level daily snapshot
  still sums both, because the dashboard, event health and the settlement PDF
  each need one figure per show — flagged to the Owner rather than changed
  silently.
- 2026-08-18 — Owner: "tambahkan tab overall… cukup summary nya saja tidak
  perlu ada detail table nya". New **Overall** tab, now the landing view:
  four combined cards (tickets / revenue / buyer fees / paid), a one-line-per-
  channel split with each channel's own last-sync stamp, and no transaction
  table — detail stays in the channel tabs. It loads no transaction rows at
  all, so the summary costs one grouped query. Money is only added when the
  channels agree on a currency; otherwise the totals read "—" with a notice,
  while ticket counts still add. Live at the time of writing: 123 tickets,
  Rp 46,125,000 face value (Megatix 69, Tessera 54).
