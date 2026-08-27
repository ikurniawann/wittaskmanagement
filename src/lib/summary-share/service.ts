import { createHash, randomBytes } from "node:crypto";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  dataroomAccessLog,
  dataroomFileVersions,
  dataroomFiles,
  dataroomFolders,
  divisions,
  eventPhases,
  events,
  summaryShareLinks,
  taskChecklistItems,
  tasks,
} from "@/db/schema";
import { logActivity } from "@/lib/activity";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import {
  DEFAULT_EXPIRY_DAYS,
  gateRequirements,
  refusalMessage,
  resolveExpiry,
  verifyShareAttempt,
  type ShareVerdict,
} from "@/lib/dataroom/share-rules";
import { env } from "@/lib/env";
import { decideUpload } from "@/lib/dataroom/quota";
import { quotaFor, usedBytes } from "@/lib/dataroom/service";
import { freeDiskBytes, writeVersion } from "@/lib/dataroom/storage";
import { assertCan, type Actor } from "@/lib/permissions";
import { summarizeStatuses } from "@/lib/tasks/progress";
import type { TaskStatus } from "@/lib/tasks/service";
import { publicChecklist, publicTaskRows, type PublicTaskRow } from "./public-view";

// Read-only progress links (Owner 2026-08-27).
//
// The gate is not re-implemented: expiry, passcode, allowlist and revocation
// come from lib/dataroom/share-rules.ts, which is pure and already tested. The
// only new judgement here is WHAT an outsider sees, and that lives in
// public-view.ts. This file is the database and the token.

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface CreateSummaryShareInput {
  expiryDays?: number;
  /** task links only — lets the recipient upload into the task's folders */
  allowUpload?: boolean;
  passcode?: string;
  requireEmail?: boolean;
  allowedEmails?: string[] | null;
  label?: string;
}

export interface CreatedSummaryShare {
  id: string;
  /** the only time the plaintext token exists outside the recipient's URL */
  url: string;
  expiresAt: Date;
}

async function insertLink(
  actor: Actor,
  row: { kind: "project" | "task"; eventId: string; taskId: string | null },
  input: CreateSummaryShareInput,
  subject: string,
): Promise<CreatedSummaryShare> {
  const token = randomBytes(32).toString("hex");
  const expiresAt = resolveExpiry(input.expiryDays ?? DEFAULT_EXPIRY_DAYS, new Date());

  const [created] = await db
    .insert(summaryShareLinks)
    .values({
      kind: row.kind,
      eventId: row.eventId,
      taskId: row.taskId,
      tokenHash: hashToken(token),
      label: input.label?.trim() || null,
      expiresAt,
      passcodeHash: input.passcode?.trim() ? hashPassword(input.passcode.trim()) : null,
      requireEmail: input.requireEmail ?? true,
      allowedEmails: (input.allowedEmails ?? null) as never,
      // a project link never accepts uploads: there is no sub-task to file
      // them under, and "somewhere in this project" is not a destination
      allowUpload: row.kind === "task" ? (input.allowUpload ?? false) : false,
      createdBy: actor.id,
    })
    .returning({ id: summaryShareLinks.id });

  await logActivity({
    actorId: actor.id,
    action: "summary.share_created",
    entity: row.taskId ? `task:${row.taskId}` : `event:${row.eventId}`,
    // the token never reaches the activity log
    detail: { subject, expiresAt: expiresAt.toISOString() },
    eventId: row.eventId,
  });

  return { id: created.id, url: `${env.APP_URL}/progress/${token}`, expiresAt };
}

/** Publishing a project's progress is an act on the project, so it asks for
 *  the right to edit it rather than merely to look at it. */
export async function createProjectShare(
  actor: Actor,
  eventId: string,
  input: CreateSummaryShareInput,
): Promise<CreatedSummaryShare> {
  assertCan(actor, "event.edit");
  const [event] = await db.select().from(events).where(eq(events.id, eventId)).limit(1);
  if (!event) throw new Error("Project not found.");
  return insertLink(actor, { kind: "project", eventId, taskId: null }, input, event.name);
}

/** A task link is scoped to the task's own division, so a division head can
 *  publish their own work without needing rights over the whole project. */
export async function createTaskShare(
  actor: Actor,
  taskId: string,
  input: CreateSummaryShareInput,
): Promise<CreatedSummaryShare> {
  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  if (!task) throw new Error("Task not found.");
  assertCan(actor, "task.edit", { divisionId: task.divisionId });
  if (task.restricted) {
    // the flag exists to keep a task from most colleagues; a link to the
    // outside would invert it
    throw new Error("This task is restricted — it cannot be shared outside.");
  }
  return insertLink(
    actor,
    { kind: "task", eventId: task.eventId, taskId: task.id },
    input,
    task.title,
  );
}

export interface SummaryShareRow {
  id: string;
  label: string | null;
  expiresAt: Date;
  revokedAt: Date | null;
  hasPasscode: boolean;
  requireEmail: boolean;
  allowedEmails: string[] | null;
  opens: number;
  lastViewedAt: Date | null;
  createdAt: Date;
  expired: boolean;
}

function toRow(r: typeof summaryShareLinks.$inferSelect, now: number): SummaryShareRow {
  return {
    id: r.id,
    label: r.label,
    expiresAt: r.expiresAt,
    revokedAt: r.revokedAt,
    hasPasscode: r.passcodeHash !== null,
    requireEmail: r.requireEmail,
    allowedEmails: (r.allowedEmails as string[] | null) ?? null,
    opens: r.opens,
    lastViewedAt: r.lastViewedAt,
    createdAt: r.createdAt,
    expired: r.expiresAt.getTime() <= now,
  };
}

export async function listProjectShares(actor: Actor, eventId: string) {
  assertCan(actor, "event.edit");
  const rows = await db
    .select()
    .from(summaryShareLinks)
    .where(and(eq(summaryShareLinks.eventId, eventId), isNull(summaryShareLinks.taskId)));
  const now = Date.now();
  return rows.map((r) => toRow(r, now)).sort((a, b) => +b.createdAt - +a.createdAt);
}

export async function listTaskShares(actor: Actor, taskId: string) {
  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  if (!task) return [];
  assertCan(actor, "task.edit", { divisionId: task.divisionId });
  const rows = await db
    .select()
    .from(summaryShareLinks)
    .where(eq(summaryShareLinks.taskId, taskId));
  const now = Date.now();
  return rows.map((r) => toRow(r, now)).sort((a, b) => +b.createdAt - +a.createdAt);
}

export interface TaskShareOpens {
  /** every open this task's links have ever had, live or withdrawn */
  opens: number;
  /** at least one link is still usable right now */
  live: boolean;
}

/**
 * Open counts per task for one project, for the task list (Owner 2026-08-27).
 *
 * Withdrawn and expired links still contribute: the question the column
 * answers is "how often has this been looked at from outside", and revoking a
 * link does not un-view it. `live` says whether anything is still open, which
 * is the separate question.
 *
 * Gated at event.view — the same right the list itself needs. It exposes no
 * token and no viewer, only counts.
 */
export async function shareOpensByTask(
  actor: Actor,
  eventId: string,
): Promise<Map<string, TaskShareOpens>> {
  assertCan(actor, "event.view");
  const rows = await db
    .select({
      taskId: summaryShareLinks.taskId,
      opens: summaryShareLinks.opens,
      expiresAt: summaryShareLinks.expiresAt,
      revokedAt: summaryShareLinks.revokedAt,
    })
    .from(summaryShareLinks)
    .where(eq(summaryShareLinks.eventId, eventId));

  const now = Date.now();
  const out = new Map<string, TaskShareOpens>();
  for (const r of rows) {
    if (!r.taskId) continue; // project-level links are not a task's business
    const cell = out.get(r.taskId) ?? { opens: 0, live: false };
    cell.opens += r.opens;
    if (r.revokedAt === null && r.expiresAt.getTime() > now) cell.live = true;
    out.set(r.taskId, cell);
  }
  return out;
}

export async function revokeSummaryShare(actor: Actor, linkId: string) {
  const [link] = await db
    .select()
    .from(summaryShareLinks)
    .where(eq(summaryShareLinks.id, linkId))
    .limit(1);
  if (!link) return;
  if (link.taskId) {
    const [task] = await db.select().from(tasks).where(eq(tasks.id, link.taskId)).limit(1);
    assertCan(actor, "task.edit", { divisionId: task?.divisionId });
  } else {
    assertCan(actor, "event.edit");
  }
  await db
    .update(summaryShareLinks)
    .set({ revokedAt: new Date() })
    .where(eq(summaryShareLinks.id, linkId));
  await logActivity({
    actorId: actor.id,
    action: "summary.share_revoked",
    entity: link.taskId ? `task:${link.taskId}` : `event:${link.eventId}`,
    detail: {},
    eventId: link.eventId,
  });
}

// ---- the public side -----------------------------------------------------

export interface ProjectSummaryView {
  kind: "project";
  name: string;
  phaseName: string | null;
  phaseIndex: number | null;
  phaseTotal: number;
  showDate: string;
  daysToShow: number;
  health: "on_track" | "at_risk" | "critical";
  progress: { done: number; committed: number; pct: number | null; total: number };
  overdueCount: number;
  divisions: Array<{ name: string; total: number; done: number; overdue: number }>;
  tasks: PublicTaskRow[];
}

export interface TaskSummaryView {
  kind: "task";
  /** needed by the page to look up the sub-task conversations */
  taskId: string;
  projectName: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: string;
  divisionName: string;
  startDate: string | null;
  dueDate: string | null;
  overdue: boolean;
  checklist: ReturnType<typeof publicChecklist>;
  /** the recipient may file documents against each sub-task */
  allowUpload: boolean;
  /** sub-tasks they may upload against — id is needed to name the folder */
  uploadTargets: Array<{ id: string; title: string }>;
}

export type SummaryView = ProjectSummaryView | TaskSummaryView;

export type SummaryResolution =
  | {
      ok: true;
      linkId: string;
      label: string | null;
      view: SummaryView;
      /** so the gate can mint a pass that survives the next request */
      viewerEmail: string | null;
      passcodeOk: boolean;
    }
  | { ok: false; message: string; needsPasscode: boolean; needsEmail: boolean };

function dayNumber(date: Date): number {
  const wib = new Date(date.getTime() + 7 * 3600_000);
  return Math.floor(
    Date.UTC(wib.getUTCFullYear(), wib.getUTCMonth(), wib.getUTCDate()) / 86_400_000,
  );
}

async function buildProjectView(eventId: string, now: Date): Promise<ProjectSummaryView | null> {
  const [event] = await db.select().from(events).where(eq(events.id, eventId)).limit(1);
  if (!event || event.archivedAt !== null) return null;

  const phases = await db
    .select()
    .from(eventPhases)
    .where(eq(eventPhases.eventId, eventId))
    .orderBy(asc(eventPhases.sortOrder));
  const phaseIdx = phases.findIndex((p) => p.id === event.currentPhaseId);

  const rows = await db
    .select({
      id: tasks.id,
      title: tasks.title,
      status: tasks.status,
      priority: tasks.priority,
      divisionId: tasks.divisionId,
      startDate: tasks.startDate,
      dueDate: tasks.dueDate,
      restricted: tasks.restricted,
    })
    .from(tasks)
    .where(eq(tasks.eventId, eventId));

  const visible = publicTaskRows(rows, now);
  // progress is computed from the SAME visible set the reader is shown, so the
  // percentage always adds up against the list underneath it
  const progress = summarizeStatuses(
    rows.filter((r) => !r.restricted).map((r) => r.status as TaskStatus),
  );

  const divisionNames = new Map((await db.select().from(divisions)).map((d) => [d.id, d.name]));
  const byDivision = new Map<string, { total: number; done: number; overdue: number }>();
  for (const t of visible) {
    const cell = byDivision.get(t.divisionId) ?? { total: 0, done: 0, overdue: 0 };
    cell.total += 1;
    if (t.status === "done") cell.done += 1;
    if (t.overdue) cell.overdue += 1;
    byDivision.set(t.divisionId, cell);
  }

  const daysToShow = dayNumber(event.showDate) - dayNumber(now);
  const overdueCount = visible.filter((t) => t.overdue).length;

  return {
    kind: "project",
    name: event.name,
    phaseName: phases[phaseIdx]?.name ?? null,
    phaseIndex: phaseIdx >= 0 ? phaseIdx + 1 : null,
    phaseTotal: phases.length,
    showDate: event.showDate.toISOString(),
    daysToShow,
    // the STORED verdict, not a fresh one: recomputing here without the
    // budget signals would let the public page disagree with what the team
    // sees internally, and the quieter of two answers is the wrong one to
    // show an outsider
    health: event.health,
    progress: {
      done: progress.done,
      committed: progress.committed,
      pct: progress.pct,
      total: progress.total,
    },
    overdueCount,
    divisions: [...byDivision.entries()]
      .map(([id, cell]) => ({ name: divisionNames.get(id) ?? id, ...cell }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    tasks: visible,
  };
}

async function buildTaskView(
  taskId: string,
  now: Date,
  allowUpload: boolean,
): Promise<TaskSummaryView | null> {
  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  // restricted is re-checked at READ time, not only at creation: a task can be
  // marked restricted after a link was handed out, and that must close it
  if (!task || task.restricted) return null;

  const [event] = await db.select().from(events).where(eq(events.id, task.eventId)).limit(1);
  const divisionNames = new Map((await db.select().from(divisions)).map((d) => [d.id, d.name]));

  const items = await db
    .select()
    .from(taskChecklistItems)
    .where(eq(taskChecklistItems.taskId, taskId))
    .orderBy(asc(taskChecklistItems.sortOrder));

  return {
    kind: "task",
    taskId: task.id,
    projectName: event?.name ?? "",
    title: task.title,
    description: task.description,
    status: task.status as TaskStatus,
    priority: task.priority,
    divisionName: divisionNames.get(task.divisionId) ?? task.divisionId,
    startDate: task.startDate ? task.startDate.toISOString() : null,
    dueDate: task.dueDate ? task.dueDate.toISOString() : null,
    overdue:
      task.status !== "done" &&
      task.status !== "cancelled" &&
      task.dueDate !== null &&
      dayNumber(task.dueDate) < dayNumber(now),
    checklist: publicChecklist(items),
    allowUpload,
    uploadTargets: allowUpload ? items.map((i) => ({ id: i.id, title: i.title })) : [],
  };
}

/**
 * Resolves a visitor's attempt. Re-reads the link every time, so revoking or
 * restricting takes effect on the visitor's very next request rather than
 * when their session happens to end.
 */
export async function resolveSummaryShare(
  token: string,
  attempt: { passcode?: string; email?: string; passcodeVerified?: boolean },
): Promise<SummaryResolution> {
  const [link] = token
    ? await db
        .select()
        .from(summaryShareLinks)
        .where(eq(summaryShareLinks.tokenHash, hashToken(token)))
        .limit(1)
    : [];

  const passcodeOk =
    !link?.passcodeHash ||
    attempt.passcodeVerified === true ||
    (attempt.passcode ? verifyPassword(attempt.passcode, link.passcodeHash) : false);

  const state = link
    ? {
        expiresAt: link.expiresAt,
        revokedAt: link.revokedAt,
        passcodeHash: link.passcodeHash,
        requireEmail: link.requireEmail,
        allowedEmails: (link.allowedEmails as string[] | null) ?? null,
      }
    : null;

  const verdict: ShareVerdict = verifyShareAttempt(
    state,
    {
      passcodeOk,
      passcodeAttempted: Boolean(attempt.passcode),
      email: attempt.email ?? null,
    },
    new Date(),
  );

  if (!verdict.ok) {
    const needs =
      verdict.reason === "unknown" || !state
        ? { passcode: false, email: false }
        : gateRequirements(state);
    return {
      ok: false,
      message: refusalMessage(verdict.reason),
      needsPasscode: needs.passcode,
      needsEmail: needs.email,
    };
  }

  const now = new Date();
  const view = link!.taskId
    ? await buildTaskView(link!.taskId, now, link!.allowUpload)
    : await buildProjectView(link!.eventId, now);
  // an archived project or a newly-restricted task behaves as a dead link
  if (!view) {
    return { ok: false, message: refusalMessage("unknown"), needsPasscode: false, needsEmail: false };
  }

  return {
    ok: true,
    linkId: link!.id,
    label: link!.label,
    view,
    viewerEmail: verdict.viewerEmail,
    passcodeOk,
  };
}

/** One open. Counted on the link and mirrored into the audit trail so
 *  "who has seen this" is answerable next to every other access. */
export async function recordSummaryOpen(
  linkId: string,
  viewer: string | null,
): Promise<void> {
  const [link] = await db
    .update(summaryShareLinks)
    .set({ opens: sql`${summaryShareLinks.opens} + 1`, lastViewedAt: new Date() })
    .where(eq(summaryShareLinks.id, linkId))
    .returning();
  if (!link) return;
  await logActivity({
    actorId: null,
    action: "summary.share_viewed",
    entity: link.taskId ? `task:${link.taskId}` : `event:${link.eventId}`,
    detail: { viewer: viewer ?? "anonymous" },
    eventId: link.eventId,
  });
}

// ---- guest uploads (Owner 2026-08-27) ------------------------------------

/**
 * Finds — or creates once — the pair of folders a sub-task files into:
 * `<task name>/<sub-task name>`, inside the task's own project dataroom.
 *
 * Matched by NAME rather than kept in a column, so a folder someone renamed
 * or moved by hand is not silently duplicated on the next upload... and, the
 * other way round, renaming the task later starts a fresh folder rather than
 * retitling one that other people may already be using. That is the honest
 * trade: no hidden coupling between a task's title and a folder's identity.
 *
 * Visibility is "event" — anyone on the project. A guest-facing drop box that
 * landed in a sealed folder would be invisible to the very team meant to
 * collect it.
 */
async function ensureUploadFolder(
  eventId: string,
  taskTitle: string,
  subTaskTitle: string,
  createdBy: string | null,
): Promise<string> {
  const findOrCreate = async (name: string, parentId: string | null) => {
    const clean = name.trim().slice(0, 120) || "Untitled";
    const existing = await db
      .select({ id: dataroomFolders.id })
      .from(dataroomFolders)
      .where(
        and(
          eq(dataroomFolders.eventId, eventId),
          eq(dataroomFolders.name, clean),
          parentId === null
            ? isNull(dataroomFolders.parentId)
            : eq(dataroomFolders.parentId, parentId),
        ),
      )
      .limit(1);
    if (existing[0]) return existing[0].id;
    const [created] = await db
      .insert(dataroomFolders)
      .values({
        eventId,
        parentId,
        name: clean,
        visibility: "event",
        createdBy,
      })
      .returning({ id: dataroomFolders.id });
    return created.id;
  };

  const taskFolderId = await findOrCreate(taskTitle, null);
  return findOrCreate(subTaskTitle, taskFolderId);
}

export interface ShareUploadResult {
  fileName: string;
  sizeBytes: number;
  folderPath: string;
}

/**
 * A file arriving through a share link.
 *
 * The link is the authorisation, so it is re-verified here rather than
 * trusted from the page that rendered the form: the token must still open,
 * the link must carry allowUpload, and the sub-task must belong to THIS
 * link's task. Without that last check a valid token plus a guessed checklist
 * id would file documents into someone else's project.
 *
 * The project's dataroom quota and the disk floor are enforced with the same
 * decideUpload the internal path uses — a guest must not be able to fill the
 * disk any more than a colleague can.
 */
export async function uploadFromShare(
  token: string,
  attempt: { passcode?: string; email?: string; passcodeVerified?: boolean },
  input: {
    checklistItemId: string;
    name: string;
    declaredSize: number;
    mimeType?: string;
    body: ReadableStream<Uint8Array> | Buffer;
  },
): Promise<ShareUploadResult> {
  const resolution = await resolveSummaryShare(token, attempt);
  if (!resolution.ok) throw new Error(resolution.message);
  if (resolution.view.kind !== "task" || !resolution.view.allowUpload) {
    throw new Error("This link does not accept uploads.");
  }

  const [link] = await db
    .select()
    .from(summaryShareLinks)
    .where(eq(summaryShareLinks.id, resolution.linkId))
    .limit(1);
  if (!link?.taskId) throw new Error("This link does not accept uploads.");

  const [item] = await db
    .select()
    .from(taskChecklistItems)
    .where(
      and(
        eq(taskChecklistItems.id, input.checklistItemId),
        // the binding that keeps one link from writing into another's task
        eq(taskChecklistItems.taskId, link.taskId),
      ),
    )
    .limit(1);
  if (!item) throw new Error("That sub-task is not part of this link.");

  const [task] = await db.select().from(tasks).where(eq(tasks.id, link.taskId)).limit(1);
  if (!task || task.restricted) throw new Error("This link is no longer valid.");

  const folderId = await ensureUploadFolder(
    task.eventId,
    task.title,
    item.title,
    link.createdBy,
  );

  const [used, limit, free] = await Promise.all([
    usedBytes(task.eventId),
    quotaFor(task.eventId),
    freeDiskBytes(),
  ]);
  const verdict = decideUpload({
    usedBytes: used,
    limitBytes: limit,
    incomingBytes: input.declaredSize,
    freeDiskBytes: free,
  });
  if (!verdict.ok) throw new Error(verdict.message);

  const name = input.name.trim().slice(0, 200) || "Untitled";
  const [file] = await db
    .insert(dataroomFiles)
    .values({
      eventId: task.eventId,
      folderId,
      name,
      currentVersion: 1,
      // a guest has no profile; the access log names them by email instead
      createdBy: null,
    })
    .returning({ id: dataroomFiles.id });

  let written: number;
  try {
    written = await writeVersion(
      task.eventId,
      file.id,
      1,
      input.body,
      verdict.remainingAfter + input.declaredSize,
    );
  } catch (error) {
    // a first version that never landed leaves a row pointing at nothing
    await db.delete(dataroomFiles).where(eq(dataroomFiles.id, file.id));
    throw error;
  }

  await db.insert(dataroomFileVersions).values({
    fileId: file.id,
    versionNo: 1,
    sizeBytes: written,
    mimeType: input.mimeType || "application/octet-stream",
    uploadedBy: null,
  });

  await db.insert(dataroomAccessLog).values({
    actorId: null,
    viewerEmail: resolution.viewerEmail,
    shareLinkId: link.id,
    fileId: file.id,
    folderId,
    eventId: task.eventId,
    fileName: name,
    versionNo: 1,
    action: "upload",
    note: `via progress link${link.label ? ` “${link.label}”` : ""} — ${task.title} / ${item.title}`,
  });

  return {
    fileName: name,
    sizeBytes: written,
    folderPath: `${task.title} / ${item.title}`,
  };
}
