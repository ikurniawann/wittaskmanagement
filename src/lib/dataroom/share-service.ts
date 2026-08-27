import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  dataroomAccessLog,
  dataroomFileVersions,
  dataroomFiles,
  dataroomFolders,
  dataroomShareLinks,
} from "@/db/schema";
import { logActivity } from "@/lib/activity";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { env } from "@/lib/env";
import type { Actor } from "@/lib/permissions";
import { breadcrumb, collectSubtreeIds, type FolderNode } from "./folder-tree";
import { isId } from "./paths";
import { watermarkDecision } from "./watermark";
import {
  DEFAULT_EXPIRY_DAYS,
  gateRequirements,
  refusalMessage,
  resolveExpiry,
  verifyShareAttempt,
  type ShareVerdict,
} from "./share-rules";

// Share links for people outside the system (EPIC-018 T-180).
//
// The rules live in share-rules.ts; this file adds the database, the token
// and the audit entry. Two things are deliberate:
//   1. The token is stored only as a sha256 hash, so a database leak yields
//      nothing that opens. The plaintext is returned exactly once.
//   2. Every check runs on every request. Nothing is trusted from a cookie
//      set at the first visit, or a revocation would take effect only after
//      the visitor closed their browser.

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface CreateShareInput {
  fileId: string;
  expiryDays?: number;
  passcode?: string;
  requireEmail?: boolean;
  allowedEmails?: string[] | null;
  allowDownload?: boolean;
  watermark?: boolean;
  label?: string;
}

export interface CreatedShare {
  id: string;
  /** the only time the plaintext token exists outside the recipient's URL */
  url: string;
  expiresAt: Date;
}

/**
 * Creates a link. The caller must already have proven it may see the file —
 * requireFileAccess in service.ts does that, and this is only reached from
 * there.
 */
export async function createShareLink(
  actor: Actor,
  file: {
    id: string;
    eventId: string;
    name: string;
    folderId?: string | null;
    mimeType?: string;
    sizeBytes?: number;
  },
  input: Omit<CreateShareInput, "fileId">,
): Promise<CreatedShare> {
  if (input.watermark) {
    // decided now, not at view time: a switch that silently does nothing is
    // worse than no switch, and the sender can still export to PDF instead
    const verdict = watermarkDecision(
      file.mimeType ?? "application/octet-stream",
      file.sizeBytes ?? 0,
    );
    if (!verdict.ok) throw new Error(verdict.reason);
  }
  const token = randomBytes(32).toString("hex");
  const expiresAt = resolveExpiry(input.expiryDays ?? DEFAULT_EXPIRY_DAYS, new Date());

  const [row] = await db
    .insert(dataroomShareLinks)
    .values({
      fileId: file.id,
      eventId: file.eventId,
      tokenHash: hashToken(token),
      label: input.label?.trim() || null,
      expiresAt,
      passcodeHash: input.passcode?.trim()
        ? hashPassword(input.passcode.trim())
        : null,
      requireEmail: input.requireEmail ?? true,
      allowedEmails: (input.allowedEmails ?? null) as never,
      allowDownload: input.allowDownload ?? true,
      watermark: input.watermark ?? false,
      createdBy: actor.id,
    })
    .returning({ id: dataroomShareLinks.id });

  await logActivity({
    actorId: actor.id,
    action: "dataroom.share_created",
    entity: `dataroom_file:${file.id}`,
    // the token never reaches the activity log
    detail: { fileName: file.name, expiresAt: expiresAt.toISOString() },
    eventId: file.eventId,
  });

  // The dataroom's own trail answers "who sent this out, and to whom" beside
  // "who opened it" (Owner 2026-08-12). Recipients are named when a list was
  // set; a link without one is honestly recorded as open to whoever holds it.
  const recipients =
    input.allowedEmails && input.allowedEmails.length > 0
      ? `to ${input.allowedEmails.join(", ")}`
      : "to anyone holding the link";
  const gates = [
    input.passcode?.trim() ? "passcode" : null,
    (input.requireEmail ?? true) ? "email required" : null,
    input.watermark ? "watermarked" : null,
  ]
    .filter(Boolean)
    .join(", ");
  await db.insert(dataroomAccessLog).values({
    actorId: actor.id,
    fileId: file.id,
    folderId: file.folderId ?? null,
    eventId: file.eventId,
    fileName: file.name,
    versionNo: null,
    action: "share_created",
    note: `${input.label?.trim() ? `“${input.label.trim()}” ` : ""}${recipients}${gates ? ` (${gates})` : ""}, expires ${expiresAt.toISOString().slice(0, 10)}`,
  });

  return { id: row.id, url: `${env.APP_URL}/share/${token}`, expiresAt };
}

/**
 * The folder twin of createShareLink (Owner 2026-08-27). Same gates, same
 * token handling, same audit trail — only the target differs, so a recipient
 * gets one browsable folder instead of one file.
 *
 * No watermark decision here: watermarking is judged per file (mime + size)
 * and a folder holds a mixture, so the flag is carried on the link and each
 * file is judged as it is opened.
 */
export async function createFolderShareLink(
  actor: Actor,
  folder: { id: string; eventId: string; name: string },
  input: Omit<CreateShareInput, "fileId">,
): Promise<CreatedShare> {
  const token = randomBytes(32).toString("hex");
  const expiresAt = resolveExpiry(input.expiryDays ?? DEFAULT_EXPIRY_DAYS, new Date());

  const [row] = await db
    .insert(dataroomShareLinks)
    .values({
      fileId: null,
      folderId: folder.id,
      eventId: folder.eventId,
      tokenHash: hashToken(token),
      label: input.label?.trim() || null,
      expiresAt,
      passcodeHash: input.passcode?.trim()
        ? hashPassword(input.passcode.trim())
        : null,
      requireEmail: input.requireEmail ?? true,
      allowedEmails: (input.allowedEmails ?? null) as never,
      allowDownload: input.allowDownload ?? true,
      watermark: input.watermark ?? false,
      createdBy: actor.id,
    })
    .returning({ id: dataroomShareLinks.id });

  await logActivity({
    actorId: actor.id,
    action: "dataroom.share_created",
    entity: `dataroom_folder:${folder.id}`,
    detail: { folderName: folder.name, expiresAt: expiresAt.toISOString() },
    eventId: folder.eventId,
  });

  const recipients =
    input.allowedEmails && input.allowedEmails.length > 0
      ? `to ${input.allowedEmails.join(", ")}`
      : "to anyone holding the link";
  const gates = [
    input.passcode?.trim() ? "passcode" : null,
    (input.requireEmail ?? true) ? "email required" : null,
    input.watermark ? "watermarked" : null,
  ]
    .filter(Boolean)
    .join(", ");
  await db.insert(dataroomAccessLog).values({
    actorId: actor.id,
    fileId: null,
    folderId: folder.id,
    eventId: folder.eventId,
    fileName: folder.name,
    versionNo: null,
    action: "share_created",
    note: `folder ${input.label?.trim() ? `“${input.label.trim()}” ` : ""}${recipients}${gates ? ` (${gates})` : ""}, expires ${expiresAt.toISOString().slice(0, 10)}`,
  });

  return { id: row.id, url: `${env.APP_URL}/share/${token}`, expiresAt };
}

export async function revokeShareLink(actor: Actor, linkId: string) {
  if (!isId(linkId)) throw new Error("Unknown link.");
  const [link] = await db
    .select()
    .from(dataroomShareLinks)
    .where(eq(dataroomShareLinks.id, linkId))
    .limit(1);
  if (!link) throw new Error("Unknown link.");

  await db
    .update(dataroomShareLinks)
    .set({ revokedAt: new Date() })
    .where(eq(dataroomShareLinks.id, linkId));
  await logActivity({
    actorId: actor.id,
    action: "dataroom.share_revoked",
    entity: link.folderId
      ? `dataroom_folder:${link.folderId}`
      : `dataroom_file:${link.fileId}`,
    detail: {},
    eventId: link.eventId,
  });

  // The trail names whatever the link pointed at, so revoking a folder link
  // reads as clearly as revoking a file one.
  let fileId: string | null = null;
  let folderId: string | null = null;
  let name = "?";
  if (link.folderId) {
    const [folder] = await db
      .select({ name: dataroomFolders.name })
      .from(dataroomFolders)
      .where(eq(dataroomFolders.id, link.folderId))
      .limit(1);
    folderId = link.folderId;
    name = folder?.name ?? "?";
  } else if (link.fileId) {
    const [file] = await db
      .select({ name: dataroomFiles.name, folderId: dataroomFiles.folderId })
      .from(dataroomFiles)
      .where(eq(dataroomFiles.id, link.fileId))
      .limit(1);
    fileId = link.fileId;
    folderId = file?.folderId ?? null;
    name = file?.name ?? "?";
  }
  await db.insert(dataroomAccessLog).values({
    actorId: actor.id,
    fileId,
    folderId,
    eventId: link.eventId,
    fileName: name,
    versionNo: null,
    action: "share_revoked",
    note: link.label ? `“${link.label}”` : null,
  });
}

export interface ShareLinkView {
  id: string;
  label: string | null;
  expiresAt: Date;
  revokedAt: Date | null;
  hasPasscode: boolean;
  allowDownload: boolean;
  watermark: boolean;
  requireEmail: boolean;
  allowedEmails: string[] | null;
  opens: number;
  createdAt: Date;
  /** decided here, not in the browser: the server owns the clock, and a
   *  render-time Date.now() is impure under the React compiler */
  expired: boolean;
}

export async function listShareLinks(fileId: string): Promise<ShareLinkView[]> {
  const rows = await db
    .select()
    .from(dataroomShareLinks)
    .where(eq(dataroomShareLinks.fileId, fileId))
    .orderBy(desc(dataroomShareLinks.createdAt));

  const counts = await db
    .select({
      shareLinkId: dataroomAccessLog.shareLinkId,
      total: sql<number>`count(*)::int`,
    })
    .from(dataroomAccessLog)
    .where(eq(dataroomAccessLog.fileId, fileId))
    .groupBy(dataroomAccessLog.shareLinkId);
  const byLink = new Map(counts.map((c) => [c.shareLinkId, c.total]));

  const now = Date.now();
  return rows.map((r) => ({
    id: r.id,
    expired: r.expiresAt.getTime() <= now,
    label: r.label,
    expiresAt: r.expiresAt,
    revokedAt: r.revokedAt,
    hasPasscode: r.passcodeHash !== null,
    allowDownload: r.allowDownload,
    watermark: r.watermark,
    requireEmail: r.requireEmail,
    allowedEmails: (r.allowedEmails as string[] | null) ?? null,
    opens: byLink.get(r.id) ?? 0,
    createdAt: r.createdAt,
  }));
}

/** The folder twin of listShareLinks — same view, keyed by the folder. */
export async function listFolderShareLinks(folderId: string): Promise<ShareLinkView[]> {
  const rows = await db
    .select()
    .from(dataroomShareLinks)
    .where(eq(dataroomShareLinks.folderId, folderId))
    .orderBy(desc(dataroomShareLinks.createdAt));

  // opens are counted per link, so the same join works for either target
  const counts = await db
    .select({
      shareLinkId: dataroomAccessLog.shareLinkId,
      total: sql<number>`count(*)::int`,
    })
    .from(dataroomAccessLog)
    .where(eq(dataroomAccessLog.folderId, folderId))
    .groupBy(dataroomAccessLog.shareLinkId);
  const byLink = new Map(counts.map((c) => [c.shareLinkId, c.total]));

  const now = Date.now();
  return rows.map((r) => ({
    id: r.id,
    expired: r.expiresAt.getTime() <= now,
    label: r.label,
    expiresAt: r.expiresAt,
    revokedAt: r.revokedAt,
    hasPasscode: r.passcodeHash !== null,
    allowDownload: r.allowDownload,
    watermark: r.watermark,
    requireEmail: r.requireEmail,
    allowedEmails: (r.allowedEmails as string[] | null) ?? null,
    opens: byLink.get(r.id) ?? 0,
    createdAt: r.createdAt,
  }));
}

export interface ResolvedShare {
  linkId: string;
  /** the sender's label for this link, for the audit note */
  linkLabel: string | null;
  fileId: string;
  eventId: string;
  fileName: string;
  versionNo: number;
  mimeType: string;
  allowDownload: boolean;
  watermark: boolean;
  viewerEmail: string | null;
  /** so the gate can mint a pass that survives the next request */
  passcodeOk: boolean;
}

/** A folder link, once the visitor is past the gate. */
export interface ResolvedFolderShare {
  linkId: string;
  linkLabel: string | null;
  /** the shared folder — the ceiling; nothing above it is ever reachable */
  rootFolderId: string;
  eventId: string;
  rootFolderName: string;
  allowDownload: boolean;
  watermark: boolean;
  viewerEmail: string | null;
  passcodeOk: boolean;
}

export type ShareResolution =
  | { ok: true; kind: "file"; share: ResolvedShare }
  | { ok: true; kind: "folder"; share: ResolvedFolderShare }
  | { ok: false; message: string; needsPasscode: boolean; needsEmail: boolean };

/**
 * Resolves a visitor's attempt. Re-reads the link every time — expiry,
 * revocation, passcode and the allowlist are never cached, so revoking takes
 * effect on the visitor's very next request.
 */
export async function resolveShare(
  token: string,
  attempt: {
    passcode?: string;
    email?: string;
    /** carried by the signed pass cookie: the passcode was already proven */
    passcodeVerified?: boolean;
  },
): Promise<ShareResolution> {
  const [link] = token
    ? await db
        .select()
        .from(dataroomShareLinks)
        .where(eq(dataroomShareLinks.tokenHash, hashToken(token)))
        .limit(1)
    : [];

  const passcodeOk =
    !link?.passcodeHash ||
    attempt.passcodeVerified === true ||
    (attempt.passcode
      ? verifyPassword(attempt.passcode, link.passcodeHash)
      : false);

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
    // Once the link is known live, report EVERYTHING it asks for, so the form
    // can show both boxes at once. A dead link (reason "unknown") reports
    // nothing, so it still gives away neither its existence nor its shape.
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

  // A folder link resolves to the folder itself; its contents are fetched
  // per request by listSharedFolder, so a file added or trashed after the
  // link was sent is reflected immediately.
  if (link!.folderId) {
    const [folder] = await db
      .select()
      .from(dataroomFolders)
      .where(eq(dataroomFolders.id, link!.folderId))
      .limit(1);
    if (!folder) {
      return { ok: false, message: refusalMessage("unknown"), needsPasscode: false, needsEmail: false };
    }
    return {
      ok: true,
      kind: "folder",
      share: {
        linkId: link!.id,
        linkLabel: link!.label,
        rootFolderId: folder.id,
        eventId: folder.eventId,
        rootFolderName: folder.name,
        allowDownload: link!.allowDownload,
        watermark: link!.watermark,
        viewerEmail: verdict.viewerEmail,
        passcodeOk,
      },
    };
  }

  const [file] = await db
    .select()
    .from(dataroomFiles)
    .where(eq(dataroomFiles.id, link!.fileId!))
    .limit(1);
  // a trashed file behaves as if the link were dead: the sender pulled it
  if (!file || file.trashedAt !== null) {
    return { ok: false, message: refusalMessage("unknown"), needsPasscode: false, needsEmail: false };
  }

  const [version] = await db
    .select()
    .from(dataroomFileVersions)
    .where(
      and(
        eq(dataroomFileVersions.fileId, file.id),
        eq(dataroomFileVersions.versionNo, file.currentVersion),
      ),
    )
    .limit(1);
  if (!version) {
    return { ok: false, message: refusalMessage("unknown"), needsPasscode: false, needsEmail: false };
  }

  return {
    ok: true,
    kind: "file",
    share: {
      linkId: link!.id,
      linkLabel: link!.label,
      fileId: file.id,
      eventId: file.eventId,
      fileName: file.name,
      versionNo: version.versionNo,
      mimeType: version.mimeType,
      allowDownload: link!.allowDownload,
      watermark: link!.watermark,
      viewerEmail: verdict.viewerEmail,
      passcodeOk,
    },
  };
}

export interface SharedFolderListing {
  /** the folder being shown, which is the root or something under it */
  folderId: string;
  /** root → … → current, for navigation; never reaches above the root */
  trail: Array<{ id: string; name: string }>;
  folders: Array<{ id: string; name: string }>;
  files: Array<{
    id: string;
    name: string;
    versionNo: number;
    mimeType: string;
    sizeBytes: number;
  }>;
}

/** Reads the event's folder rows as the plain tree folder-tree.ts works on. */
async function folderNodes(eventId: string): Promise<FolderNode[]> {
  const rows = await db
    .select({
      id: dataroomFolders.id,
      parentId: dataroomFolders.parentId,
      name: dataroomFolders.name,
    })
    .from(dataroomFolders)
    .where(eq(dataroomFolders.eventId, eventId));
  return rows;
}

/**
 * One page of a folder share.
 *
 * `folderId` comes from the visitor's URL, so it is treated as hostile: it is
 * accepted only after breadcrumb() proves it sits at or below the shared root.
 * Anything else — a folder from another event, the shared folder's own parent,
 * a guessed uuid — returns null, which the page renders as "not found". The
 * refusal deliberately looks identical in every case, so probing ids tells an
 * outsider nothing about what exists.
 */
export async function listSharedFolder(
  share: ResolvedFolderShare,
  folderId?: string | null,
): Promise<SharedFolderListing | null> {
  const target = folderId && isId(folderId) ? folderId : share.rootFolderId;
  const nodes = await folderNodes(share.eventId);

  const trail = breadcrumb(share.rootFolderId, target, nodes);
  if (!trail) return null;

  const children = nodes
    .filter((n) => n.parentId === target)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((n) => ({ id: n.id, name: n.name }));

  const fileRows = await db
    .select({
      id: dataroomFiles.id,
      name: dataroomFiles.name,
      versionNo: dataroomFileVersions.versionNo,
      mimeType: dataroomFileVersions.mimeType,
      sizeBytes: dataroomFileVersions.sizeBytes,
    })
    .from(dataroomFiles)
    .innerJoin(
      dataroomFileVersions,
      and(
        eq(dataroomFileVersions.fileId, dataroomFiles.id),
        eq(dataroomFileVersions.versionNo, dataroomFiles.currentVersion),
      ),
    )
    .where(
      and(
        eq(dataroomFiles.folderId, target),
        // a trashed file disappears from the link the moment it is trashed
        sql`${dataroomFiles.trashedAt} is null`,
      ),
    );

  return {
    folderId: target,
    trail: trail.map((n) => ({ id: n.id, name: n.name })),
    folders: children,
    files: fileRows
      .map((f) => ({ ...f, sizeBytes: Number(f.sizeBytes) }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/**
 * Turns "this visitor holds a folder link and asked for file X" into the same
 * shape a single-file link resolves to, or null when X is not inside the
 * shared folder.
 *
 * This is the check that keeps a folder link from becoming a room link: the
 * file's OWN folder must be in the shared subtree. Without it, a token plus a
 * guessed file id would read anything in the event.
 */
export async function resolveFileWithinFolderShare(
  share: ResolvedFolderShare,
  fileId: string,
): Promise<ResolvedShare | null> {
  if (!isId(fileId)) return null;

  const [file] = await db
    .select()
    .from(dataroomFiles)
    .where(eq(dataroomFiles.id, fileId))
    .limit(1);
  if (!file || file.trashedAt !== null) return null;
  if (file.eventId !== share.eventId) return null;

  const allowed = collectSubtreeIds(share.rootFolderId, await folderNodes(share.eventId));
  if (!allowed.has(file.folderId)) return null;

  const [version] = await db
    .select()
    .from(dataroomFileVersions)
    .where(
      and(
        eq(dataroomFileVersions.fileId, file.id),
        eq(dataroomFileVersions.versionNo, file.currentVersion),
      ),
    )
    .limit(1);
  if (!version) return null;

  return {
    linkId: share.linkId,
    linkLabel: share.linkLabel,
    fileId: file.id,
    eventId: file.eventId,
    fileName: file.name,
    versionNo: version.versionNo,
    mimeType: version.mimeType,
    allowDownload: share.allowDownload,
    watermark: share.watermark,
    viewerEmail: share.viewerEmail,
    passcodeOk: share.passcodeOk,
  };
}

/** Records an outside open in the same log as internal reads, so one activity
 *  view answers "who has seen this contract" for everyone. */
export async function logShareAccess(
  share: ResolvedShare,
  action: "view" | "download",
) {
  await db.insert(dataroomAccessLog).values({
    actorId: null,
    viewerEmail: share.viewerEmail,
    shareLinkId: share.linkId,
    fileId: share.fileId,
    folderId: null,
    eventId: share.eventId,
    fileName: share.fileName,
    versionNo: share.versionNo,
    action,
    note: share.linkLabel ? `via “${share.linkLabel}”` : "via share link",
  });
}
