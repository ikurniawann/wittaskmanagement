# Agent API — Panduan Penggunaan

API untuk agent eksternal (OpenClaw / Hermes / n8n / skrip apa pun) agar bisa
**membaca, menulis, dan meng-update** RVC Backstage atas nama orang yang
sedang berbicara dengan agent — misalnya lewat WhatsApp.

- **Base URL**: `https://ingat.reddie.id/api/agent`
- **Referensi interaktif (Swagger UI)**: `https://ingat.reddie.id/api-docs` — login admin/owner; spesifikasi OpenAPI di `/api/openapi`
- **Format**: JSON, UTF-8. Semua respons dibungkus `{ "ok": true, "data": … }`
  atau `{ "ok": false, "error": "…" }`.
- **Shipped**: EPIC-023, 2026-08-18. Diuji end-to-end terhadap server live.

---

## 1. Konsep inti: dua kredensial per request

Tidak ada token all-access. Setiap request wajib membawa **dua** header:

| Header | Isi | Membuktikan |
|---|---|---|
| `Authorization` | `Bearer rvca_…` | **Agent mana** yang memanggil |
| `X-On-Behalf-Of` | nomor WA, mis. `081809078014` | **Manusia mana** yang diwakili |

Server mencocokkan nomor itu dengan nomor HP di profil user, lalu menjalankan
request **dengan hak akses user tersebut** melalui modul permission — sama
persis seperti user itu mengklik sendiri di aplikasi. Konsekuensinya:

- Owner mengirim perintah → agent bertindak sebagai Owner (akses penuh).
- Staf mengirim → hanya sebatas hak staf itu (divisi, task yang di-assign).
- Nomor tak terdaftar → **403**. Key tanpa nomor → **401**. Key saja tidak
  bisa membaca apa pun.
- Di **grup WA**: identitas = **nomor PENGIRIM pesan**, bukan grup. Jangan
  pernah hardcode satu nomor untuk semua anggota grup — itu membuka kembali
  celah "semua orang di grup = admin" yang desain ini tutup.

Format nomor fleksibel: `0812…`, `62812…`, `+62 812…` semuanya diterima
(dinormalisasi ke msisdn).

### Menerbitkan / mencabut key

Admin → **Agent API keys** → Create key. Token `rvca_…` **tampil sekali saja**
(yang tersimpan hanya hash SHA-256) — langsung salin ke config agent. Daftar
key menunjukkan nama, 4 karakter terakhir, dan kapan terakhir dipakai;
tombol **Revoke** mematikannya seketika.

### Batas & audit

- **Rate limit**: 120 request/menit per key → lewat itu **429**.
- **Audit**: setiap mutasi tercatat di activity log atas nama **user**-nya
  (bukan key), dan task/komentar buatan agent membawa sufiks terlihat
  `— via <nama-key>` supaya tidak menyamar sebagai ketikan tangan.
- Akun **external** dan akun nonaktif ditolak (403).

---

## 2. Endpoint

### `GET /me` — cek identitas

Panggilan pertama yang harus dilakukan agent (health-check + tahu hak akses).

```bash
curl https://ingat.reddie.id/api/agent/me \
  -H "Authorization: Bearer rvca_XXXX" \
  -H "X-On-Behalf-Of: 081809078014"
```

```json
{ "ok": true, "data": {
  "userId": "6a2a676a-…", "name": "Super Admin", "role": "owner",
  "memberships": [],
  "actingVia": { "key": "openclaw-wa", "phone": "6281809078014" }
}}
```

### `GET /events` — daftar event yang terlihat

Mengikuti aturan visibility aplikasi: admin/owner melihat semua; user lain
hanya event yang melibatkan mereka.

```json
{ "ok": true, "data": [
  { "id": "c3757e43-…", "name": "Moodymann Jakarta",
    "showDate": "2026-08-25T13:00:00.000Z", "venue": "Zoo SCBD",
    "health": "at_risk" }
]}
```

### `GET /events/{id}` — detail satu event

Header event, PIC & member, divisi aktif, dan **angka tiket terkini** (dari
snapshot harian — gabungan semua channel, dengan catatan kebasian per channel).

```json
{ "ok": true, "data": {
  "id": "…", "name": "Moodymann Jakarta", "artists": "Moodymann",
  "venue": "Zoo SCBD", "showDate": "…", "capacity": 600,
  "health": "at_risk", "phase": "Production",
  "pic": { "id": "…", "name": "Super Admin" },
  "members": [ { "id": "…", "name": "…" } ],
  "divisions": [ { "id": "finance", "name": "Finance" }, … ],
  "tickets": { "day": "2026-08-20", "sold": 124, "revenue": 46500000,
               "note": "Synced from Megatix + Tessera (as of 2026-08-17)" }
}}
```

> `tickets.revenue` = nilai tiket (face value), bukan jumlah yang dibayar
> pembeli. Satu definisi revenue di seluruh aplikasi.

### `GET /tasks?eventId={id}` · `GET /tasks?mine=1` — daftar task

- `?eventId=…` — task satu event (bisa ditambah `&status=todo` dll).
  Task yang di-restrict head tetap tersaring sesuai hak pemanggil.
- `?mine=1` — task milik si pengirim (lead / assignee), lintas event.

```json
{ "ok": true, "data": [
  { "id": "…", "title": "Booking venue", "status": "in_progress",
    "priority": "high", "dueDate": "2026-08-22T…", "divisionId": "production" }
]}
```

Status yang valid: `backlog · todo · in_progress · in_review · blocked · done
· cancelled`. Priority: `low · medium · high · urgent`.

### `POST /tasks` — buat task

```bash
curl -X POST https://ingat.reddie.id/api/agent/tasks \
  -H "Authorization: Bearer rvca_XXXX" \
  -H "X-On-Behalf-Of: 081809078014" \
  -H "Content-Type: application/json" \
  -d '{
    "eventId":   "c3757e43-…",
    "divisionId":"production",
    "title":     "Cek sound system",
    "description":"Pastikan rider Moodymann terpenuhi",
    "priority":  "high",
    "dueDate":   "2026-08-23T17:00:00+07:00"
  }'
```

Wajib: `eventId`, `divisionId`, `title`. `dueDate` menerima ISO — **selalu
sertakan offset `+07:00`** untuk jam WIB. Respons: `{ "id": "…", "title": "…" }`.
Deskripsi otomatis diberi jejak `— via <key> (wa:<nomor>)`.

### `GET /tasks/{id}` — detail task

Seluruh field task + `assigneeIds` + `isAssigned` (apakah si pengirim
termasuk pengerjanya). Task tersegel yang tak boleh dilihat → 404.

### `PATCH /tasks/{id}` — update task

Field yang bisa diubah: `status`, `priority`, `title`, `dueDate`
(`null` = hapus due date). Kirim hanya yang berubah:

```bash
curl -X PATCH https://ingat.reddie.id/api/agent/tasks/{id} \
  -H "Authorization: Bearer rvca_XXXX" \
  -H "X-On-Behalf-Of: 0812…" \
  -H "Content-Type: application/json" \
  -d '{ "status": "done" }'
```

Respons: `{ "changed": ["status"] }`. Hak edit mengikuti aturan aplikasi:
pemilik divisi/lead bisa edit penuh; assignee bisa update task-nya sendiri.

### `POST /tasks/{id}/comments` — komentar

```bash
-d '{ "body": "Sudah dikonfirmasi vendor, besok loading in." }'
```

Komentar tampil di timeline task dengan sufiks `— via <key>`. Mention `@all`
di body akan meng-mention seluruh divisi task itu (perilaku sama dengan app).

### Dataroom

Semua aturan akses dataroom (sealed / division / event / organisation, folder
tersegel, quota) berlaku penuh — endpoint ini hanya pintu lain menuju service
yang sama dengan yang dipakai aplikasi.

#### `GET /dataroom?eventId={id}` — daftar folder + file

Folder yang boleh dilihat si pengirim, masing-masing dengan file-nya,
`canUpload`, dan `canManage`. Folder sealed yang bukan haknya tidak muncul.

```json
{ "ok": true, "data": { "folders": [
  { "id": "…", "name": "Kontrak", "parentId": null, "visibility": "event",
    "canUpload": true, "canManage": true,
    "files": [ { "id": "…", "name": "kontrak-final.pdf", "version": 2,
                 "updatedAt": "…" } ] }
]}}
```

#### `POST /dataroom/folders` — buat folder

```json
{ "eventId": "…", "name": "Kontrak", "parentId": null,
  "visibility": "event", "divisionId": null }
```

`visibility`: `sealed · division · event · organisation` (default `event`;
`division` wajib menyertakan `divisionId`). Respons: `{ "id": "…" }`.

#### `PATCH /dataroom/folders/{id}` — rename / pindah

Body `{ "name": "…" }` dan/atau `{ "parentId": "…" | null }` (null = ke akar).
Aturan nesting visibility tetap ditegakkan service.

#### `DELETE /dataroom/folders/{id}` — hapus folder

**Menolak folder yang masih berisi** ("still holds N files") — mengosongkan
isinya harus keputusan yang disengaja, bukan efek samping.

#### `PUT /dataroom/files?folderId={id}&name={nama}` — upload

**Raw PUT** — bytes file sebagai body, metadata di query string (bukan
multipart, supaya quota dicek sambil streaming, bukan setelah memori penuh).
Opsional: `&replaceFileId=…` untuk menimpa sebagai versi baru, header
`X-File-Type` untuk MIME.

```bash
curl -X PUT "https://ingat.reddie.id/api/agent/dataroom/files?folderId=…&name=rider.pdf" \
  -H "Authorization: Bearer rvca_XXXX" -H "X-On-Behalf-Of: 0812…" \
  -H "X-File-Type: application/pdf" --data-binary @rider.pdf
```

Respons: `{ "fileId": "…", "versionNo": 1, "sizeBytes": 12345,
"crossedWarning": false }`. Quota penuh / disk floor → 400 dengan angka
persisnya di pesan error.

#### `GET /dataroom/files/{id}` — download

Respons = **bytes file** (bukan JSON), `Content-Disposition: attachment`.
Setiap download tercatat di access log dataroom atas nama user-nya — lewat
agent pun tidak ada baca yang tak terekam. File yang tak boleh dilihat → 404
(bukan 403; keberadaan file pun tidak dibocorkan).

#### `PATCH /dataroom/files/{id}` — rename / pindah

Body `{ "name": "…" }` dan/atau `{ "folderId": "…" }`.

#### `DELETE /dataroom/files/{id}` — hapus (ke trash)

Selalu **soft delete**: file masuk trash dan bisa dipulihkan selama retention
window. Disengaja — agent yang disuruh "hapus semua" oleh pesan injeksi harus
meninggalkan jalan pulang. Hard delete tidak tersedia lewat API ini.

---

### Modul lainnya — cakupan penuh sidebar

Setiap menu di aplikasi punya padanan endpoint. Semua mengikuti pola yang
sama (dua header, `{ok, data|error}`), jadi tabel ringkas ini cukup:

| Modul | Endpoint | Aksi |
|---|---|---|
| Timeline | `GET /timeline` (`?mentions=1`, `?limit=`) | feed + jumlah unread |
| Approvals | `GET /approvals` · `?mine=1` | antrean keputusan saya · pengajuan saya |
| | `GET /approvals/{id}` | detail + riwayat |
| | `POST /approvals/{id}` `{decision:"approved"|"rejected", comment}` | memutuskan — **comment wajib** |
| | `POST /approvals` `{type,title,divisionId,amount?,eventId?}` | mengajukan |
| Pages | `GET /pages` · `GET /pages/{id}` | daftar / isi |
| | `POST /pages` `{title, markdown?}` | buat — **markdown** dikonversi ke format editor |
| | `PATCH /pages/{id}` `{title?, markdown?}` · `DELETE` | ubah (markdown mengganti seluruh isi) / hapus |
| Event Pages (wiki) | `GET /event-pages?eventId=` + `POST` + `GET/PATCH/DELETE /event-pages/{id}` | sama seperti Pages, dalam lingkup event |
| Dashboard | `GET /dashboard` | portfolio, milestone, bottleneck, blocker, overdue — satu panggilan |
| Calendar | `GET /calendar?from=YYYY-MM-DD&to=…` | hari show + due date task (default 31 hari ke depan, tanggal WIB) |
| Search | `GET /search?q=…` | pencarian global, tetap ter-scope visibility |
| Budget | `GET /budget?eventId=` | rollup + daftar expense |
| | `POST /budget` `{eventId,divisionId,name,plannedAmount}` | baris anggaran |
| Expenses | `POST /expenses` `{eventId,divisionId,title,amount,…}` | ajukan expense — **otomatis membuka rantai approval** |
| Guests | `GET /guests?eventId=` · `POST /guests` | daftar undangan · undang external — magic link dikembalikan di respons, TIDAK dikirim otomatis |
| Handoffs | `GET /handoffs?eventId=` · `POST /handoffs` | daftar · minta serah-terima antar divisi |
| | `POST /handoffs/{id}` `{accept:true|false}` | keputusan divisi penerima |
| Run of Show | `GET /run-of-show?eventId=` · `POST` | daftar cue · tambah (`startTime "HH:MM"` WIB) |
| | `PATCH /run-of-show/{id}` · `DELETE` | ubah / hapus cue |
| Tickets | `GET /tickets?eventId=` | angka per channel (Tessera/Megatix) + kurva snapshot harian |
| | `POST /tickets` `{eventId,ticketsSold,revenue?}` | snapshot MANUAL (bukan menimpa data sync) |
| Board / List / My Tasks | *(sudah ada)* `GET/POST /tasks`, `PATCH /tasks/{id}` | |
| Admin | `GET /admin/users` · `PATCH /admin/users/{id}` `{phone, whatsappNotifications}` | daftar user (tanpa hash password) · ubah kontak |
| | `GET/POST /admin/divisions` | daftar; `{name}` buat · `{id,name}` rename · `{id,delete:true}` hapus |
| | `GET/PATCH /admin/branding` | branding organisasi |

Semua endpoint Admin menuntut hak `org.manage` pada si **pengirim** — key
agent tidak menambah hak apa pun.

> **Kintsugi Intelligence sengaja TIDAK diberi endpoint.** Hermes sendiri
> adalah LLM; menyuruh Hermes bertanya ke Kintsugi berarti membayar dua
> model untuk satu jawaban dengan konteks yang sama. Endpoint-endpoint di
> atas memberi Hermes bahan mentah yang sama dengan yang dibaca Kintsugi —
> biarkan Hermes menalar sendiri. Kalau nanti tetap dibutuhkan, itu tugas
> refactor terpisah (memisahkan pipeline SSE dari route chat).

---

---

## 3. Kode error — dan apa yang harus dilakukan agent

| HTTP | Arti | Aksi agent |
|---|---|---|
| 401 | Token hilang/salah/dicabut, **atau** header `X-On-Behalf-Of` kosong | Periksa config; jangan retry membabi-buta |
| 403 | Nomor tak terdaftar / user nonaktif / user tak berhak untuk aksi itu | Balas ke pengguna: "nomor kamu belum terdaftar di Backstage" atau "kamu tidak punya akses untuk itu" |
| 404 | Task/event tidak ada **atau tak terlihat** oleh user ini | Jangan bocorkan bahwa objeknya ada |
| 400 | Body/parameter salah — pesan errornya menyebut field mana | Perbaiki lalu ulangi |
| 429 | >120 req/menit untuk key ini | Backoff, coba lagi setelah ~1 menit |

Semua error berbentuk `{ "ok": false, "error": "kalimat yang bisa dibaca" }` —
aman untuk diteruskan ke LLM sebagai umpan balik tool.

---

## 4. Pola integrasi WhatsApp (OpenClaw / Hermes)

```
pesan WA masuk
  └─ ambil nomor PENGIRIM  (di grup: participant, bukan JID grup)
       └─ jadikan header X-On-Behalf-Of
            └─ LLM memilih tool → panggil endpoint → balas hasil ke chat
```

Definisikan endpoint sebagai **tools** dengan skema eksplisit (bukan menyuruh
LLM mengarang URL). Contoh definisi tool minimum:

```json
[
  { "name": "rvc_me",          "method": "GET",  "path": "/me" },
  { "name": "rvc_events",      "method": "GET",  "path": "/events" },
  { "name": "rvc_event",       "method": "GET",  "path": "/events/{eventId}" },
  { "name": "rvc_tasks",       "method": "GET",  "path": "/tasks?eventId={eventId}" },
  { "name": "rvc_my_tasks",    "method": "GET",  "path": "/tasks?mine=1" },
  { "name": "rvc_create_task", "method": "POST", "path": "/tasks",
    "body": ["eventId","divisionId","title","description?","priority?","dueDate?"] },
  { "name": "rvc_update_task", "method": "PATCH","path": "/tasks/{taskId}",
    "body": ["status?","priority?","title?","dueDate?"] },
  { "name": "rvc_comment",     "method": "POST", "path": "/tasks/{taskId}/comments",
    "body": ["body"] },
  { "name": "rvc_dataroom",        "method": "GET",    "path": "/dataroom?eventId={eventId}" },
  { "name": "rvc_dr_mkdir",        "method": "POST",   "path": "/dataroom/folders",
    "body": ["eventId","name","parentId?","visibility?","divisionId?"] },
  { "name": "rvc_dr_upload",       "method": "PUT",    "path": "/dataroom/files?folderId={id}&name={nama}",
    "body": "raw file bytes" },
  { "name": "rvc_dr_download",     "method": "GET",    "path": "/dataroom/files/{fileId}" },
  { "name": "rvc_dr_rename_file",  "method": "PATCH",  "path": "/dataroom/files/{fileId}",
    "body": ["name?","folderId?"] },
  { "name": "rvc_dr_trash_file",   "method": "DELETE", "path": "/dataroom/files/{fileId}" },
  { "name": "rvc_dr_edit_folder",  "method": "PATCH",  "path": "/dataroom/folders/{folderId}",
    "body": ["name?","parentId?"] },
  { "name": "rvc_dr_rm_folder",    "method": "DELETE", "path": "/dataroom/folders/{folderId}" }
]
```

Contoh handler (Node, apa pun framework WA-nya):

```js
async function callRvc(method, path, senderPhone, body) {
  const res = await fetch(`https://ingat.reddie.id/api/agent${path}`, {
    method,
    headers: {
      authorization: `Bearer ${process.env.RVC_AGENT_KEY}`,
      "x-on-behalf-of": senderPhone,           // ← per pesan, dari WA
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json(); // { ok, data | error } — teruskan ke LLM apa adanya
}
```

---

## 5. Checklist sebelum go-live

- [ ] Key diterbitkan di Admin → Agent API keys, tersimpan di config agent
      (env var, **jangan** di-commit).
- [ ] **Nomor HP setiap anggota tim terisi di profilnya** (Admin → Users) —
      nomor kosong = orang itu tak bisa memakai agent.
- [ ] Agent memakai **nomor WA khusus**, bukan nomor pribadi (gateway tidak
      resmi berisiko banned oleh Meta).
- [ ] Di grup, kode mengambil nomor **participant** pengirim — sudah diuji.
- [ ] `GET /me` dipakai sebagai smoke test saat agent boot.
- [ ] Rencana rotasi: kalau key bocor → Revoke di Admin → terbitkan baru.

## 6. Keamanan — keputusan desain yang disengaja

- **Tidak ada god token.** Pesan injeksi dari siapa pun di grup mentok di hak
  pengirimnya sendiri; dataroom sealed, task restricted, dan visibility event
  tetap berlaku penuh.
- Plaintext key tak pernah disimpan (hash SHA-256 saja) dan tak pernah
  dikembalikan ke browser setelah dibuat.
- Jejak ganda: activity log per user + sufiks "via <key>" pada konten buatan
  agent.
- Error 404 tidak membedakan "tidak ada" dan "tidak boleh dilihat".

---

*Referensi teknis: `src/lib/agent/auth.ts` (autentikasi & key),
`src/lib/agent/respond.ts` (bungkus respons), `src/app/api/agent/**` (route),
epic: `docs/epics/EPIC-023-agent-api.md`.*
