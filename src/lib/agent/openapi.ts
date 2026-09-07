// OpenAPI 3.1 description of the Agent API (docs/AGENT-API.md is the prose
// companion). Hand-written on purpose: the routes are thin wrappers over the
// permission-scoped services, and their shapes are stable. A test walks
// src/app/api/agent/**/route.ts and fails when a route exists without an
// entry here (or the reverse), so the two cannot drift silently.
//
// Served by /api/openapi to signed-in admins and rendered at /api-docs.

type Schema = Record<string, unknown>;

const uuid: Schema = { type: "string", format: "uuid" };
const isoDate: Schema = {
  type: "string",
  format: "date-time",
  description: "ISO 8601. Always send a +07:00 offset for WIB times.",
};

const errorEnvelope: Schema = {
  type: "object",
  required: ["ok", "error"],
  properties: {
    ok: { type: "boolean", const: false },
    error: { type: "string", description: "Readable sentence — safe to hand back to an LLM as tool feedback." },
  },
};

function envelope(data: Schema): Schema {
  return {
    type: "object",
    required: ["ok", "data"],
    properties: { ok: { type: "boolean", const: true }, data },
  };
}

function ok(description: string, data: Schema, extra?: Record<string, unknown>) {
  return {
    200: { description, content: { "application/json": { schema: envelope(data) } } },
    400: { $ref: "#/components/responses/BadRequest" },
    401: { $ref: "#/components/responses/Unauthorized" },
    403: { $ref: "#/components/responses/Forbidden" },
    404: { $ref: "#/components/responses/NotFound" },
    429: { $ref: "#/components/responses/TooManyRequests" },
    ...extra,
  };
}

function q(name: string, description: string, required = false, schema: Schema = { type: "string" }) {
  return { name, in: "query", required, description, schema };
}
function p(name: string, description: string) {
  return { name, in: "path", required: true, description, schema: uuid };
}
function json(schema: Schema) {
  return { required: true, content: { "application/json": { schema } } };
}
function obj(properties: Record<string, Schema>, required: string[] = [], description?: string): Schema {
  return { type: "object", properties, required, ...(description ? { description } : {}) };
}
function list(items: Schema): Schema {
  return { type: "array", items };
}
const anyObject = (description: string): Schema => ({ type: "object", description, additionalProperties: true });

const TASK_STATUSES = ["backlog", "todo", "in_progress", "in_review", "blocked", "done", "cancelled"];
const PRIORITIES = ["low", "medium", "high", "urgent"];
const VISIBILITIES = ["sealed", "division", "event", "organisation"];

const eventSummary = obj(
  { id: uuid, name: { type: "string" }, showDate: isoDate, venue: { type: "string" }, health: { type: "string", enum: ["on_track", "at_risk", "critical"] } },
  ["id", "name"],
);
const taskSummary = obj(
  {
    id: uuid, title: { type: "string" }, status: { type: "string", enum: TASK_STATUSES },
    priority: { type: "string", enum: PRIORITIES }, dueDate: { ...isoDate, nullable: true },
    divisionId: { type: "string" },
  },
  ["id", "title", "status"],
);

export const agentOpenApi = {
  openapi: "3.1.0",
  info: {
    title: "Backstage Agent API",
    version: "1",
    description: [
      "Every request carries **two credentials**: the bearer key proves *which agent* is calling, ",
      "`X-On-Behalf-Of` names *which human* it speaks for (a WhatsApp number known to the app). ",
      "The request then runs with **that person's** permissions — the key adds no rights of its own, ",
      "so an unknown phone is a brick and a sealed folder stays sealed.\n\n",
      "Successful responses are `{ ok: true, data }`; failures are `{ ok: false, error }` with the HTTP status below. ",
      "Rate limit: 120 requests per minute per key. Times are WIB (Asia/Jakarta); send ISO dates with `+07:00`.\n\n",
      "Prose guide with worked examples: `docs/AGENT-API.md` in the repository.",
    ].join(""),
  },
  servers: [{ url: "/api/agent" }],
  security: [{ agentKey: [], onBehalfOf: [] }],
  tags: [
    { name: "Identity" }, { name: "Projects" }, { name: "Tasks" }, { name: "Dataroom" },
    { name: "Timeline" }, { name: "Approvals" }, { name: "Pages" }, { name: "Dashboard & Calendar" },
    { name: "Budget" }, { name: "Guests & Handoffs" }, { name: "Run of Show & Tickets" }, { name: "Admin" },
  ],
  components: {
    securitySchemes: {
      agentKey: { type: "http", scheme: "bearer", description: "Agent key issued in Admin → Agent keys (`rvca_…`). Shown once at creation." },
      onBehalfOf: { type: "apiKey", in: "header", name: "X-On-Behalf-Of", description: "WhatsApp number of the human the agent acts for, e.g. `081809078014` or `6281809078014`." },
    },
    responses: {
      BadRequest: { description: "Body or parameter invalid — the message names the field.", content: { "application/json": { schema: errorEnvelope } } },
      Unauthorized: { description: "Key missing, wrong or revoked, or `X-On-Behalf-Of` absent.", content: { "application/json": { schema: errorEnvelope } } },
      Forbidden: { description: "Phone not registered, user inactive, or this user may not do that.", content: { "application/json": { schema: errorEnvelope } } },
      NotFound: { description: "Object missing **or not visible** to this user — existence is never leaked.", content: { "application/json": { schema: errorEnvelope } } },
      TooManyRequests: { description: "More than 120 requests/minute for this key — back off about a minute.", content: { "application/json": { schema: errorEnvelope } } },
    },
  },
  paths: {
    "/me": {
      get: {
        tags: ["Identity"], summary: "Who am I acting for, and what may they do",
        description: "The first call an agent should make: identity, global role, division memberships and the key in use.",
        responses: ok("Identity", obj({
          userId: uuid, name: { type: "string", nullable: true }, role: { type: "string", enum: ["owner", "admin", "member", "external"] },
          memberships: list(obj({ divisionId: { type: "string" }, role: { type: "string" } })),
          actingVia: obj({ key: { type: "string" }, phone: { type: "string" } }),
        })),
      },
    },
    "/events": {
      get: { tags: ["Projects"], summary: "Projects visible to this user", responses: ok("Projects", list(eventSummary)) },
    },
    "/events/{id}": {
      get: {
        tags: ["Projects"], summary: "One project: header, PIC & members, divisions, latest ticket numbers",
        parameters: [p("id", "project id")],
        responses: ok("Project detail", obj({
          id: uuid, name: { type: "string" }, artists: { type: "string" }, venue: { type: "string" }, showDate: isoDate,
          capacity: { type: "integer", nullable: true }, health: { type: "string" }, phase: { type: "string", nullable: true },
          pic: obj({ id: uuid, name: { type: "string" } }), members: list(obj({ id: uuid, name: { type: "string" } })),
          divisions: list(obj({ id: { type: "string" }, name: { type: "string" } })),
          tickets: obj({ day: { type: "string" }, sold: { type: "integer" }, revenue: { type: "integer", description: "face value in IDR" }, note: { type: "string" } }),
        })),
      },
    },
    "/tasks": {
      get: {
        tags: ["Tasks"], summary: "Tasks of a project, or my tasks across projects",
        parameters: [
          q("eventId", "project id — required unless `mine=1`"),
          q("status", "filter by status", false, { type: "string", enum: TASK_STATUSES }),
          q("mine", "`1` = tasks where the caller is lead or assignee, across projects"),
        ],
        responses: ok("Tasks (restricted tasks filtered by the caller's rights)", list(taskSummary)),
      },
      post: {
        tags: ["Tasks"], summary: "Create a task",
        description: "The description gets a `— via <key> (wa:<phone>)` trace so relayed tasks stay distinguishable.",
        requestBody: json(obj({
          eventId: uuid, divisionId: { type: "string" }, title: { type: "string" }, description: { type: "string" },
          priority: { type: "string", enum: PRIORITIES }, dueDate: isoDate,
        }, ["eventId", "divisionId", "title"])),
        responses: ok("Created", obj({ id: uuid, title: { type: "string" } })),
      },
    },
    "/tasks/{id}": {
      get: {
        tags: ["Tasks"], summary: "Task detail incl. assigneeIds and whether the caller is assigned",
        parameters: [p("id", "task id")],
        responses: ok("Task", { allOf: [taskSummary, obj({ description: { type: "string", nullable: true }, assigneeIds: list(uuid), isAssigned: { type: "boolean" } })] }),
      },
      patch: {
        tags: ["Tasks"], summary: "Update status, priority, title or due date",
        description: "Send only what changes. `dueDate: null` clears the due date. Leads edit fully; assignees may update their own task.",
        parameters: [p("id", "task id")],
        requestBody: json(obj({
          status: { type: "string", enum: TASK_STATUSES }, priority: { type: "string", enum: PRIORITIES },
          title: { type: "string" }, dueDate: { ...isoDate, nullable: true },
        })),
        responses: ok("Changed fields", obj({ changed: list({ type: "string" }) })),
      },
    },
    "/tasks/{id}/comments": {
      post: {
        tags: ["Tasks"], summary: "Comment on a task",
        description: "Shown in the task timeline with a `— via <key>` suffix. `@all` mentions the task's whole division.",
        parameters: [p("id", "task id")],
        requestBody: json(obj({ body: { type: "string" } }, ["body"])),
        responses: ok("Posted", obj({ posted: { type: "boolean" } })),
      },
    },
    "/dataroom": {
      get: {
        tags: ["Dataroom"], summary: "Folders and files of a project the caller may see",
        parameters: [q("eventId", "project id", true)],
        responses: ok("Folders with files, canUpload and canManage per folder", obj({
          folders: list(obj({
            id: uuid, name: { type: "string" }, parentId: { ...uuid, nullable: true }, visibility: { type: "string", enum: VISIBILITIES },
            canUpload: { type: "boolean" }, canManage: { type: "boolean" },
            files: list(obj({ id: uuid, name: { type: "string" }, version: { type: "integer" }, updatedAt: isoDate })),
          })),
        })),
      },
    },
    "/dataroom/folders": {
      post: {
        tags: ["Dataroom"], summary: "Create a folder",
        description: "`visibility` defaults to `event`; `division` requires `divisionId`. Nesting rules are enforced by the service.",
        requestBody: json(obj({
          eventId: uuid, name: { type: "string" }, parentId: { ...uuid, nullable: true },
          visibility: { type: "string", enum: VISIBILITIES }, divisionId: { type: "string", nullable: true },
        }, ["eventId", "name"])),
        responses: ok("Created", obj({ id: uuid })),
      },
    },
    "/dataroom/folders/{folderId}": {
      patch: {
        tags: ["Dataroom"], summary: "Rename and/or move a folder",
        parameters: [p("folderId", "folder id")],
        requestBody: json(obj({ name: { type: "string" }, parentId: { ...uuid, nullable: true, description: "null = move to the root" } })),
        responses: ok("Updated", anyObject("what changed")),
      },
      delete: {
        tags: ["Dataroom"], summary: "Delete an empty folder",
        description: "Refuses a folder that still holds files — emptying it must be a deliberate decision.",
        parameters: [p("folderId", "folder id")],
        responses: ok("Deleted", anyObject("result")),
      },
    },
    "/dataroom/files": {
      put: {
        tags: ["Dataroom"], summary: "Upload a file (raw PUT, bytes as body)",
        description: "Metadata travels in the query string so quota is checked while streaming. `replaceFileId` uploads a new version of an existing file. Quota / disk floor → 400 with the exact numbers.",
        parameters: [
          q("folderId", "target folder", true), q("name", "file name incl. extension", true),
          q("replaceFileId", "existing file id to version over"),
          { name: "X-File-Type", in: "header", required: false, description: "MIME type of the body", schema: { type: "string" } },
        ],
        requestBody: { required: true, content: { "application/octet-stream": { schema: { type: "string", format: "binary" } } } },
        responses: ok("Stored", obj({ fileId: uuid, versionNo: { type: "integer" }, sizeBytes: { type: "integer" }, crossedWarning: { type: "boolean" } })),
      },
    },
    "/dataroom/files/{fileId}": {
      get: {
        tags: ["Dataroom"], summary: "Download a file (bytes, not JSON)",
        description: "Every download lands in the dataroom access log under the acting user. Invisible files answer 404, never 403.",
        parameters: [p("fileId", "file id")],
        responses: {
          200: { description: "File bytes with `Content-Disposition: attachment`", content: { "application/octet-stream": { schema: { type: "string", format: "binary" } } } },
          401: { $ref: "#/components/responses/Unauthorized" }, 403: { $ref: "#/components/responses/Forbidden" }, 404: { $ref: "#/components/responses/NotFound" },
        },
      },
      patch: {
        tags: ["Dataroom"], summary: "Rename and/or move a file",
        parameters: [p("fileId", "file id")],
        requestBody: json(obj({ name: { type: "string" }, folderId: uuid })),
        responses: ok("Updated", anyObject("what changed")),
      },
      delete: {
        tags: ["Dataroom"], summary: "Move a file to trash (soft delete only)",
        description: "Restorable during the retention window. Hard delete is deliberately not offered to agents.",
        parameters: [p("fileId", "file id")],
        responses: ok("Trashed", anyObject("result")),
      },
    },
    "/timeline": {
      get: {
        tags: ["Timeline"], summary: "Activity feed and unread count",
        parameters: [q("mentions", "`1` = only entries that mention the caller"), q("limit", "max entries (default 30, cap 100)", false, { type: "integer" })],
        responses: ok("Feed", anyObject("entries plus unread count")),
      },
    },
    "/approvals": {
      get: {
        tags: ["Approvals"], summary: "Decisions waiting on me, or my own requests",
        parameters: [q("mine", "`1` = requests I submitted instead of my queue")],
        responses: ok("Approvals", list(anyObject("approval"))),
      },
      post: {
        tags: ["Approvals"], summary: "Submit an approval request",
        requestBody: json(obj({ type: { type: "string" }, title: { type: "string" }, divisionId: { type: "string" }, description: { type: "string" }, amount: { type: "number" }, eventId: uuid }, ["type", "title", "divisionId"])),
        responses: ok("Submitted", anyObject("approval")),
      },
    },
    "/approvals/{id}": {
      get: { tags: ["Approvals"], summary: "Approval detail and history", parameters: [p("id", "approval id")], responses: ok("Approval", anyObject("approval with steps")) },
      post: {
        tags: ["Approvals"], summary: "Decide the current step",
        description: "A comment is mandatory; it is stored with a `— via <key>` suffix.",
        parameters: [p("id", "approval id")],
        requestBody: json(obj({ decision: { type: "string", enum: ["approved", "rejected"] }, comment: { type: "string" } }, ["decision", "comment"])),
        responses: ok("Decided", obj({ decided: { type: "string" } })),
      },
    },
    "/pages": {
      get: { tags: ["Pages"], summary: "List pages", responses: ok("Pages", list(anyObject("page"))) },
      post: {
        tags: ["Pages"], summary: "Create a page from Markdown",
        requestBody: json(obj({ title: { type: "string" }, markdown: { type: "string" } }, ["title"])),
        responses: ok("Created", anyObject("page")),
      },
    },
    "/pages/{id}": {
      get: { tags: ["Pages"], summary: "Page content", parameters: [p("id", "page id")], responses: ok("Page", anyObject("page")) },
      patch: {
        tags: ["Pages"], summary: "Update title and/or replace the whole content from Markdown",
        parameters: [p("id", "page id")], requestBody: json(obj({ title: { type: "string" }, markdown: { type: "string" } })),
        responses: ok("Updated", anyObject("result")),
      },
      delete: { tags: ["Pages"], summary: "Delete a page", parameters: [p("id", "page id")], responses: ok("Deleted", anyObject("result")) },
    },
    "/event-pages": {
      get: { tags: ["Pages"], summary: "Project wiki pages", parameters: [q("eventId", "project id", true)], responses: ok("Pages", list(anyObject("page"))) },
      post: {
        tags: ["Pages"], summary: "Create a project wiki page",
        requestBody: json(obj({ eventId: uuid, title: { type: "string" }, markdown: { type: "string" } }, ["eventId", "title"])),
        responses: ok("Created", anyObject("page")),
      },
    },
    "/event-pages/{id}": {
      get: { tags: ["Pages"], summary: "Wiki page content", parameters: [p("id", "page id")], responses: ok("Page", anyObject("page")) },
      patch: { tags: ["Pages"], summary: "Update a wiki page", parameters: [p("id", "page id")], requestBody: json(obj({ title: { type: "string" }, markdown: { type: "string" } })), responses: ok("Updated", anyObject("result")) },
      delete: { tags: ["Pages"], summary: "Delete a wiki page", parameters: [p("id", "page id")], responses: ok("Deleted", anyObject("result")) },
    },
    "/dashboard": {
      get: { tags: ["Dashboard & Calendar"], summary: "Portfolio, milestones, bottlenecks, blockers and overdue in one call", responses: ok("Dashboard", anyObject("dashboard")) },
    },
    "/calendar": {
      get: {
        tags: ["Dashboard & Calendar"], summary: "Launch days and task due dates in a window (WIB dates)",
        parameters: [q("from", "YYYY-MM-DD (default today)"), q("to", "YYYY-MM-DD (default +31 days)")],
        responses: ok("Calendar", anyObject("entries")),
      },
    },
    "/search": {
      get: { tags: ["Dashboard & Calendar"], summary: "Global search, visibility-scoped", parameters: [q("q", "at least 2 characters", true)], responses: ok("Results", anyObject("projects, tasks, documents, people")) },
    },
    "/budget": {
      get: { tags: ["Budget"], summary: "Budget rollup and expenses of a project", parameters: [q("eventId", "project id", true)], responses: ok("Budget", anyObject("rollup + expenses")) },
      post: {
        tags: ["Budget"], summary: "Add a budget line",
        requestBody: json(obj({ eventId: uuid, divisionId: { type: "string" }, name: { type: "string" }, plannedAmount: { type: "number" } }, ["eventId", "divisionId", "name", "plannedAmount"])),
        responses: ok("Created", anyObject("budget line")),
      },
    },
    "/expenses": {
      post: {
        tags: ["Budget"], summary: "Submit an expense (opens the approval chain automatically)",
        requestBody: json(obj({ eventId: uuid, divisionId: { type: "string" }, title: { type: "string" }, amount: { type: "number" }, budgetLineId: uuid, vendor: { type: "string" }, justification: { type: "string" } }, ["eventId", "divisionId", "title", "amount"])),
        responses: ok("Submitted", anyObject("expense")),
      },
    },
    "/guests": {
      get: { tags: ["Guests & Handoffs"], summary: "External guests invited to a project", parameters: [q("eventId", "project id", true)], responses: ok("Guests", list(anyObject("guest"))) },
      post: {
        tags: ["Guests & Handoffs"], summary: "Invite an external guest",
        description: "The magic link is returned in the response and is NOT sent automatically.",
        requestBody: json(obj({ eventId: uuid, divisionId: { type: "string" }, email: { type: "string", format: "email" }, name: { type: "string" }, requestedForms: list({ type: "string" }) }, ["eventId", "divisionId", "email", "name"])),
        responses: ok("Invited", anyObject("invite incl. magic link")),
      },
    },
    "/handoffs": {
      get: { tags: ["Guests & Handoffs"], summary: "Handoffs between divisions", parameters: [q("eventId", "project id", true)], responses: ok("Handoffs", list(anyObject("handoff"))) },
      post: {
        tags: ["Guests & Handoffs"], summary: "Request a handoff to another division",
        requestBody: json(obj({ eventId: uuid, fromDivisionId: { type: "string" }, toDivisionId: { type: "string" }, title: { type: "string" }, note: { type: "string" }, originTaskId: uuid }, ["eventId", "fromDivisionId", "toDivisionId", "title"])),
        responses: ok("Requested", anyObject("handoff")),
      },
    },
    "/handoffs/{id}": {
      post: {
        tags: ["Guests & Handoffs"], summary: "Accept or decline a handoff (receiving division)",
        parameters: [p("id", "handoff id")], requestBody: json(obj({ accept: { type: "boolean" } }, ["accept"])),
        responses: ok("Decided", obj({ decided: { type: "string", enum: ["accepted", "declined"] } })),
      },
    },
    "/run-of-show": {
      get: { tags: ["Run of Show & Tickets"], summary: "Cues of a project's run sheet", parameters: [q("eventId", "project id", true)], responses: ok("Cues", list(anyObject("cue"))) },
      post: {
        tags: ["Run of Show & Tickets"], summary: "Add a cue",
        requestBody: json(obj({ eventId: uuid, startTime: { type: "string", description: "HH:MM WIB" }, durationMinutes: { type: "integer" }, title: { type: "string" }, note: { type: "string" } }, ["eventId", "startTime", "title"])),
        responses: ok("Created", anyObject("cue")),
      },
    },
    "/run-of-show/{id}": {
      patch: {
        tags: ["Run of Show & Tickets"], summary: "Update a cue",
        parameters: [p("id", "cue id")], requestBody: json(obj({ startTime: { type: "string" }, durationMinutes: { type: "integer" }, title: { type: "string" }, note: { type: "string" } }, ["startTime", "title"])),
        responses: ok("Updated", anyObject("cue")),
      },
      delete: { tags: ["Run of Show & Tickets"], summary: "Delete a cue", parameters: [p("id", "cue id")], responses: ok("Deleted", anyObject("result")) },
    },
    "/tickets": {
      get: { tags: ["Run of Show & Tickets"], summary: "Ticket numbers per channel and the daily snapshot curve", parameters: [q("eventId", "project id", true)], responses: ok("Tickets", anyObject("channels + snapshots")) },
      post: {
        tags: ["Run of Show & Tickets"], summary: "Record a MANUAL daily snapshot (never overwrites synced data)",
        requestBody: json(obj({ eventId: uuid, ticketsSold: { type: "integer" }, revenue: { type: "integer" }, day: { type: "string", description: "YYYY-MM-DD WIB, default today" }, note: { type: "string" } }, ["eventId", "ticketsSold"])),
        responses: ok("Recorded", anyObject("snapshot")),
      },
    },
    "/admin/users": {
      get: { tags: ["Admin"], summary: "Users with memberships (no password hashes) — caller needs org.manage", responses: ok("Users", list(anyObject("user"))) },
    },
    "/admin/users/{id}": {
      patch: {
        tags: ["Admin"], summary: "Update a user's phone / WhatsApp notifications",
        parameters: [p("id", "profile id")], requestBody: json(obj({ phone: { type: "string", nullable: true }, whatsappNotifications: { type: "boolean" } }, ["phone"])),
        responses: ok("Updated", anyObject("result")),
      },
    },
    "/admin/divisions": {
      get: { tags: ["Admin"], summary: "Divisions", responses: ok("Divisions", list(obj({ id: { type: "string" }, name: { type: "string" } }))) },
      post: {
        tags: ["Admin"], summary: "Create, rename or delete a division",
        description: "`{name}` creates · `{id, name}` renames · `{id, delete: true}` deletes.",
        requestBody: json(obj({ id: { type: "string" }, name: { type: "string" }, delete: { type: "boolean" } })),
        responses: ok("Result", anyObject("division or result")),
      },
    },
    "/admin/branding": {
      get: { tags: ["Admin"], summary: "Organisation branding", responses: ok("Branding", anyObject("branding")) },
      patch: { tags: ["Admin"], summary: "Update organisation branding", requestBody: json(anyObject("branding fields to change")), responses: ok("Updated", anyObject("branding")) },
    },
  },
} as const;

export type AgentOpenApi = typeof agentOpenApi;
