// WhatsApp message templates (EPIC-015 T-151/T-152).
//
// Pure, DB-free and client-safe: the admin editor imports renderTemplate and
// validateTemplate to preview and check wording in the browser, while the
// notification fan-out imports the same functions on the server. Identical
// code on both sides is the point — the preview cannot drift from what the
// team actually receives.
//
// The stored bodies live in app_settings (see template-store.ts). These
// defaults apply until someone edits them, and again after a reset.
//
// WhatsApp formatting: *bold*, _italic_.

export type WaTemplateKey =
  | "task_assigned_lead"
  | "task_assigned_member"
  | "task_urgent"
  | "dataroom_uploaded";

export type PlaceholderName =
  | "name"
  | "task"
  | "event"
  | "url"
  | "reason"
  | "file"
  | "folder"
  | "by";

export interface PlaceholderSpec {
  name: PlaceholderName;
  /** shown in the editor next to the insert button */
  description: string;
}

const COMMON: PlaceholderSpec[] = [
  { name: "name", description: "Recipient's first name" },
  { name: "task", description: "Task title" },
  { name: "event", description: "Project name" },
  { name: "url", description: "Link to the task" },
];

/** Only the dataroom message uses these — a task has no file or folder. */
const DATAROOM: PlaceholderSpec[] = [
  { name: "name", description: "Recipient's first name" },
  { name: "event", description: "Project name" },
  { name: "file", description: "Name of the uploaded file" },
  { name: "folder", description: "Folder it was filed in" },
  { name: "by", description: "Who uploaded it" },
  { name: "url", description: "Link to the document room" },
];

const REASON: PlaceholderSpec = {
  name: "reason",
  description: "Why it became urgent",
};

export interface TemplateSpec {
  key: WaTemplateKey;
  label: string;
  /** when this message is sent, in plain words */
  trigger: string;
  placeholders: PlaceholderSpec[];
}

export const TEMPLATE_SPECS: readonly TemplateSpec[] = [
  {
    key: "task_assigned_lead",
    label: "Assigned as lead (PIC)",
    trigger:
      "Sent to the person who becomes the lead of a task, on creation or when the lead changes.",
    placeholders: COMMON,
  },
  {
    key: "task_assigned_member",
    label: "Assigned as member",
    trigger: "Sent to each person added to a task's assignees.",
    placeholders: COMMON,
  },
  {
    key: "task_urgent",
    label: "Task became urgent",
    trigger:
      "Sent to the lead (PIC) when a task reaches priority Urgent — raised by a person, or auto-escalated by dependencies.",
    placeholders: [...COMMON, REASON],
  },
  {
    key: "dataroom_uploaded",
    label: "File added to the document room",
    trigger:
      "Sent to everyone on a project when a file is filed in its document room — by a colleague or through a progress link.",
    placeholders: DATAROOM,
  },
];

export const DEFAULT_TEMPLATES: Record<WaTemplateKey, string> = {
  task_assigned_lead: `Hi {name}, you are now the *lead (PIC)* of a task.

*{task}*
Event: {event}

Open it: {url}`,
  task_assigned_member: `Hi {name}, you have been *assigned a task*.

*{task}*
Event: {event}

Open it: {url}`,
  task_urgent: `Hi {name}, a task you lead is now *URGENT*.

*{task}*
Event: {event}
Why: {reason}.

Open it: {url}`,
  dataroom_uploaded: `Hi {name}, a new file was added to *{event}*.

📎 *{file}*
Folder: {folder}
Uploaded by: {by}

Open the document room: {url}`,
};

/** Longest body we accept. WhatsApp itself allows far more; this keeps a
 *  notification a notification rather than a newsletter. */
export const MAX_TEMPLATE_LENGTH = 1000;

/** Placeholders a message is useless without. */
const REQUIRED: PlaceholderName[] = ["task", "url"];

const PLACEHOLDER_RE = /\{([a-zA-Z_]+)\}/g;

export type TemplateVars = Partial<Record<PlaceholderName, string>>;

/**
 * Substitutes {placeholders}. Unknown names are left verbatim rather than
 * blanked, so a typo that slipped past validation is visible in the message
 * instead of silently producing a hole.
 */
export function renderTemplate(body: string, vars: TemplateVars): string {
  return body.replace(PLACEHOLDER_RE, (whole, rawName: string) => {
    const value = vars[rawName as PlaceholderName];
    return value === undefined ? whole : value;
  });
}

export type TemplateValidation =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Checked on save so a broken template is rejected at the editor rather than
 * discovered by the whole team on WhatsApp.
 */
export function validateTemplate(
  key: WaTemplateKey,
  body: string,
): TemplateValidation {
  const trimmed = body.trim();
  if (!trimmed) {
    return { ok: false, error: "The message cannot be empty." };
  }
  if (trimmed.length > MAX_TEMPLATE_LENGTH) {
    return {
      ok: false,
      error: `Too long — ${trimmed.length} characters, the limit is ${MAX_TEMPLATE_LENGTH}.`,
    };
  }

  const spec = TEMPLATE_SPECS.find((s) => s.key === key);
  const allowed = new Set<string>(
    (spec?.placeholders ?? COMMON).map((p) => p.name),
  );

  const used = new Set<string>();
  for (const match of trimmed.matchAll(PLACEHOLDER_RE)) used.add(match[1]);

  const unknown = [...used].filter((n) => !allowed.has(n));
  if (unknown.length > 0) {
    return {
      ok: false,
      error: `Unknown placeholder${unknown.length > 1 ? "s" : ""}: ${unknown
        .map((n) => `{${n}}`)
        .join(", ")}. Allowed: ${[...allowed].map((n) => `{${n}}`).join(", ")}.`,
    };
  }

  const missing = REQUIRED.filter((n) => allowed.has(n) && !used.has(n));
  if (missing.length > 0) {
    return {
      ok: false,
      error: `Keep ${missing
        .map((n) => `{${n}}`)
        .join(" and ")} — without it the message cannot be acted on.`,
    };
  }

  return { ok: true };
}

/** First name only — a WhatsApp message greeting a full legal name reads odd. */
export function firstName(fullName: string): string {
  const clean = fullName.trim();
  if (!clean) return "there";
  return clean.split(/\s+/)[0];
}

/** Reason clause for a priority a person set by hand. */
export function manualUrgentReason(actorName: string): string {
  const who = actorName.trim();
  return who ? `raised to urgent by ${who}` : "raised to urgent";
}

/**
 * Reason clause for the dependency engine's auto-escalation (EPIC-012):
 * enough other work is blocked on this task that it became critical.
 */
export function autoUrgentReason(input: {
  waiters: number;
  overdue: boolean;
}): string {
  const blocked =
    input.waiters === 1
      ? "1 other task is waiting on it"
      : `${input.waiters} other tasks are waiting on it`;
  return input.overdue ? `${blocked}, and it is past its due date` : blocked;
}

/** Sample values so the editor can preview without touching the database. */
export const PREVIEW_VARS: Required<TemplateVars> = {
  name: "Tono",
  task: "Confirm stage rigging vendor",
  event: "YE Live in Jakarta",
  url: "https://example.com/tasks/8f2e-4c1a",
  reason: "3 other tasks are waiting on it, and it is past its due date",
  file: "Rundown Natcon 2026.pdf",
  folder: "Dokumen Persiapan Natcon",
  by: "Agus Sugiman",
};
