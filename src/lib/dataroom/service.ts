import { and, asc, desc, eq, inArray, isNull, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  dataroomAccessLog,
  dataroomFileVersions,
  dataroomFiles,
  dataroomFolderMembers,
  dataroomFolders,
  appSettings,
  events,
  profiles,
} from "@/db/schema";
import { logActivity } from "@/lib/activity";
import { canViewEvent } from "@/lib/events/visibility";
import { assertCan, PermissionError, type Actor } from "@/lib/permissions";
import {
  canNest,
  DEFAULT_VISIBILITY,
  resolveFolderAccess,
  wouldOrphan,
  wouldOrphanByDowngrade,
  type AccessSubject,
  type FolderNode,
  type Visibility,
} from "./access";
import { isId } from "./paths";
import {
  DEFAULT_QUOTA_BYTES,
  crossesWarningLine,
  decideUpload,
  usage,
} from "./quota";
import {
  OverAllowanceError,
  freeDiskBytes,
  purgeFile,
  writeVersion,
} from "./storage";

// Dataroom service (EPIC-017 T-172). Permission checks live here; the pure
// rules live in access.ts and quota.ts, and the bytes in storage.ts.
//
// Every read of a file is written to dataroom_access_log. There is no second
// route to the bytes, so the log cannot be bypassed — that is the whole
// reason storage sits behind the app instead of in a browsable share.

function subjectFor(actor: Actor, canViewEvent: boolean): AccessSubject {
  return {
    id: actor.id,
    role: actor.role,
    divisionIds: actor.memberships.map((m) => m.divisionId),
    canViewEvent,
  };
}

/** Every folder of an event with its sealed member list, once. */
async function loadFolders(eventId: string) {
  const rows = await db
    .select()
    .from(dataroomFolders)
    .where(eq(dataroomFolders.eventId, eventId))
    .orderBy(asc(dataroomFolders.name));
  if (rows.length === 0) return { rows, members: new Map<string, FolderNode["members"]>() };

  const grants = await db
    .select()
    .from(dataroomFolderMembers)
    .where(
      inArray(
        dataroomFolderMembers.folderId,
        rows.map((r) => r.id),
      ),
    );
  const members = new Map<string, Array<{ userId: string; canEdit: boolean }>>();
  for (const g of grants) {
    const list = members.get(g.folderId) ?? [];
    list.push({ userId: g.userId, canEdit: g.canEdit });
    members.set(g.folderId, list);
  }
  return { rows, members };
}

type FolderRow = Awaited<ReturnType<typeof loadFolders>>["rows"][number];

/** Root-first chain for one folder, so access can check every ancestor. */
function chainFor(
  folderId: string,
  byId: Map<string, FolderRow>,
  members: Map<string, FolderNode["members"]>,
): FolderNode[] {
  const chain: FolderNode[] = [];
  const seen = new Set<string>();
  let current = byId.get(folderId);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    chain.unshift({
      id: current.id,
      visibility: current.visibility,
      divisionId: current.divisionId,
      createdBy: current.createdBy,
      members: members.get(current.id) ?? [],
    });
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return chain;
}

export interface FolderView {
  id: string;
  name: string;
  parentId: string | null;
  visibility: Visibility;
  divisionId: string | null;
  canUpload: boolean;
  canManage: boolean;
  /**
   * When something inside last changed — the newest updatedAt of any live
   * file in the folder's SUBTREE (Owner 2026-08-13, "berdasarkan perubahan
   * terakhir file yang diubah atau ditambahkan"). Null for an empty branch.
   */
  updatedAt: string | null;
}

/** Folders the actor may see. The filter lives here so no caller can forget
 *  it, mirroring listPages in the Pages module. */
export async function listFolders(
  actor: Actor,
  eventId: string,
): Promise<FolderView[]> {
  assertCan(actor, "event.view");
  if (!isId(eventId)) return [];
  // an "event"-level folder is readable by anyone who can view the event —
  // which is now a real question, not always yes. Passing `true` here would
  // leak event folders to people who are not on the event at all.
  const onEvent = await canViewEvent(actor, eventId);
  const { rows, members } = await loadFolders(eventId);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const subject = subjectFor(actor, onEvent);

  // one grouped query for the whole event, then a child→parent roll-up so a
  // folder's stamp reflects its deepest subtree, not just its direct files
  const stamps = await db
    .select({
      folderId: dataroomFiles.folderId,
      last: sql<string>`max(${dataroomFiles.updatedAt})`,
    })
    .from(dataroomFiles)
    .where(and(eq(dataroomFiles.eventId, eventId), isNull(dataroomFiles.trashedAt)))
    .groupBy(dataroomFiles.folderId);
  const own = new Map(stamps.map((s) => [s.folderId, new Date(s.last).getTime()]));

  const out: FolderView[] = [];
  const visible = new Set<string>();
  for (const row of rows) {
    const access = resolveFolderAccess(subject, chainFor(row.id, byId, members));
    if (!access.canView) continue;
    visible.add(row.id);
    out.push({
      id: row.id,
      name: row.name,
      parentId: row.parentId,
      visibility: row.visibility,
      divisionId: row.divisionId,
      canUpload: access.canUpload,
      canManage: access.canManage,
      updatedAt: null, // filled by the roll-up below
    });
  }

  // Bubble each stamp up the ancestor chain — but only through folders this
  // actor can SEE. A sealed subfolder's activity must not tick the parent's
  // date for someone the seal excludes; that timestamp would leak that work
  // is happening behind the lock.
  const best = new Map<string, number>();
  for (const [folderId, at] of own) {
    if (!visible.has(folderId)) continue;
    let cursor: string | null = folderId;
    while (cursor && visible.has(cursor)) {
      const prior = best.get(cursor);
      if (prior === undefined || at > prior) best.set(cursor, at);
      cursor = byId.get(cursor)?.parentId ?? null;
    }
  }
  for (const view of out) {
    const at = best.get(view.id);
    if (at !== undefined) view.updatedAt = new Date(at).toISOString();
  }
  return out;
}

/** Loads one folder and throws unless the actor may do `need` with it. */
async function requireFolder(
  actor: Actor,
  folderId: string,
  need: "view" | "upload" | "manage",
) {
  assertCan(actor, "event.view");
  if (!isId(folderId)) throw new PermissionError("event.view");
  const [folder] = await db
    .select()
    .from(dataroomFolders)
    .where(eq(dataroomFolders.id, folderId))
    .limit(1);
  if (!folder) throw new PermissionError("event.view");

  const { rows, members } = await loadFolders(folder.eventId);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const access = resolveFolderAccess(
    subjectFor(actor, await canViewEvent(actor, folder.eventId)),
    chainFor(folder.id, byId, members),
  );
  const ok =
    need === "view" ? access.canView : need === "upload" ? access.canUpload : access.canManage;
  if (!ok) throw new PermissionError("event.view");
  return { folder, access };
}

export async function createFolder(
  actor: Actor,
  input: {
    eventId: string;
    parentId?: string | null;
    name: string;
    visibility?: Visibility;
    divisionId?: string | null;
  },
): Promise<{ id: string }> {
  assertCan(actor, "event.view");
  const name = input.name.trim();
  if (!name) throw new Error("A folder needs a name.");
  const visibility = input.visibility ?? DEFAULT_VISIBILITY;
  if (visibility === "division" && !input.divisionId) {
    // a division folder without a division would admit nobody, which reads
    // as a bug rather than a decision
    throw new Error("Choose which division this folder belongs to.");
  }

  if (input.parentId) {
    const { folder: parent } = await requireFolder(actor, input.parentId, "upload");
    if (!canNest(parent.visibility, visibility)) {
      throw new Error(
        `A folder inside "${parent.name}" cannot be more open than it is (${parent.visibility}).`,
      );
    }
    if (parent.eventId !== input.eventId) {
      throw new Error("That parent belongs to another project.");
    }
  }

  const [row] = await db
    .insert(dataroomFolders)
    .values({
      eventId: input.eventId,
      parentId: input.parentId ?? null,
      name,
      visibility,
      divisionId: visibility === "division" ? (input.divisionId ?? null) : null,
      createdBy: actor.id,
    })
    .returning({ id: dataroomFolders.id });

  if (visibility === "sealed") {
    // A sealed folder admits only the people on its list, and the creator is
    // not implicitly on it — without this the folder is orphaned the moment
    // it exists: nobody can open it, not even to add the first member.
    // Granting explicitly (rather than special-casing the creator in the
    // access rules) keeps the grant visible in the member list and auditable.
    await db.insert(dataroomFolderMembers).values({
      folderId: row.id,
      userId: actor.id,
      canEdit: true,
    });
  }
  return row;
}

// ---- sealed folder membership --------------------------------------------

export interface FolderMemberView {
  userId: string;
  name: string;
  email: string;
  canEdit: boolean;
}

export async function listFolderMembers(
  actor: Actor,
  folderId: string,
): Promise<FolderMemberView[]> {
  await requireFolder(actor, folderId, "manage");
  const rows = await db
    .select({
      userId: dataroomFolderMembers.userId,
      canEdit: dataroomFolderMembers.canEdit,
      name: profiles.name,
      email: profiles.email,
    })
    .from(dataroomFolderMembers)
    .innerJoin(profiles, eq(dataroomFolderMembers.userId, profiles.id))
    .where(eq(dataroomFolderMembers.folderId, folderId))
    .orderBy(asc(profiles.name));
  return rows;
}

async function membersOf(folderId: string) {
  return db
    .select({
      userId: dataroomFolderMembers.userId,
      canEdit: dataroomFolderMembers.canEdit,
    })
    .from(dataroomFolderMembers)
    .where(eq(dataroomFolderMembers.folderId, folderId));
}

export async function addFolderMember(
  actor: Actor,
  folderId: string,
  userId: string,
  canEdit: boolean,
) {
  const { folder } = await requireFolder(actor, folderId, "manage");
  if (folder.visibility !== "sealed") {
    // any other level draws its audience from divisions or the event, so a
    // member list there would be decoration that quietly implies control
    throw new Error("Only a sealed folder has a member list.");
  }
  if (!isId(userId)) throw new Error("Unknown person.");

  const [person] = await db
    .select({ role: profiles.role })
    .from(profiles)
    .where(eq(profiles.id, userId))
    .limit(1);
  if (!person) throw new Error("Unknown person.");
  if (person.role === "external") {
    // externals never reach the dataroom; letting one onto a list would
    // create a grant that silently never works
    throw new Error("External accounts cannot be given dataroom access.");
  }

  // downgrading the last editor strands the folder exactly like removing them
  if (!canEdit) {
    const current = await membersOf(folderId);
    if (current.some((m) => m.userId === userId && m.canEdit) &&
        wouldOrphanByDowngrade(current, userId)) {
      throw new Error(
        "Someone must keep edit rights, or nobody could ever open this folder again.",
      );
    }
  }

  await db
    .insert(dataroomFolderMembers)
    .values({ folderId, userId, canEdit })
    .onConflictDoUpdate({
      target: [dataroomFolderMembers.folderId, dataroomFolderMembers.userId],
      set: { canEdit },
    });
}

export async function removeFolderMember(
  actor: Actor,
  folderId: string,
  userId: string,
) {
  await requireFolder(actor, folderId, "manage");
  const current = await membersOf(folderId);
  if (wouldOrphan(current, userId)) {
    throw new Error(
      "This is the last person who can manage the folder. Add someone else first, or nobody could open it again.",
    );
  }
  await db
    .delete(dataroomFolderMembers)
    .where(
      and(
        eq(dataroomFolderMembers.folderId, folderId),
        eq(dataroomFolderMembers.userId, userId),
      ),
    );
}

// ---- quota ----------------------------------------------------------------

/** Bytes an event holds: every version of every file, including the trash,
 *  because both still occupy the disk (EPIC-017 quota rules 1 and 2). */
export async function usedBytes(eventId: string): Promise<number> {
  const [row] = await db
    .select({
      total: sql<number>`coalesce(sum(${dataroomFileVersions.sizeBytes}), 0)::bigint`,
    })
    .from(dataroomFileVersions)
    .innerJoin(dataroomFiles, eq(dataroomFileVersions.fileId, dataroomFiles.id))
    .where(eq(dataroomFiles.eventId, eventId));
  return Number(row?.total ?? 0);
}

/** Installation-wide default, editable in Admin; falls back to the figure
 *  agreed in EPIC-017 (10 GB). */
export async function defaultQuota(): Promise<number> {
  try {
    const [row] = await db
      .select()
      .from(appSettings)
      .where(eq(appSettings.key, "dataroom_default_quota_bytes"))
      .limit(1);
    const value = Number(row?.value);
    return Number.isFinite(value) && value > 0 ? value : DEFAULT_QUOTA_BYTES;
  } catch {
    return DEFAULT_QUOTA_BYTES;
  }
}

export async function quotaFor(eventId: string): Promise<number> {
  const [row] = await db
    .select({ quota: events.dataroomQuotaBytes })
    .from(events)
    .where(eq(events.id, eventId))
    .limit(1);
  // null = follow the default, so changing the default moves every event that
  // never had an override, with no data migration
  return row?.quota ?? (await defaultQuota());
}

export interface EventStorageRow {
  eventId: string;
  eventName: string;
  usedBytes: number;
  limitBytes: number;
  /** false when the event follows the installation default */
  hasOverride: boolean;
  ratio: number;
  level: "ok" | "warning" | "full";
}

/** Admin → Storage. One SUM per event, grouped in a single query. */
export async function listEventStorage(actor: Actor): Promise<EventStorageRow[]> {
  assertCan(actor, "org.manage");
  const fallback = await defaultQuota();

  const rows = await db
    .select({
      eventId: events.id,
      eventName: events.name,
      quota: events.dataroomQuotaBytes,
    })
    .from(events)
    .orderBy(asc(events.name));

  const sums = await db
    .select({
      eventId: dataroomFiles.eventId,
      total: sql<number>`coalesce(sum(${dataroomFileVersions.sizeBytes}), 0)::bigint`,
    })
    .from(dataroomFileVersions)
    .innerJoin(dataroomFiles, eq(dataroomFileVersions.fileId, dataroomFiles.id))
    .groupBy(dataroomFiles.eventId);
  const byEvent = new Map(sums.map((r) => [r.eventId, Number(r.total)]));

  return rows.map((row) => {
    const limit = row.quota ?? fallback;
    const state = usage(byEvent.get(row.eventId) ?? 0, limit);
    return {
      eventId: row.eventId,
      eventName: row.eventName,
      usedBytes: state.usedBytes,
      limitBytes: limit,
      hasOverride: row.quota !== null,
      ratio: state.ratio,
      level: state.level,
    };
  });
}

/**
 * Sets one event's cap. Owner/Admin only: a division head able to raise their
 * own ceiling would turn the quota into a suggestion.
 *
 * Lowering it below current usage is allowed and deletes NOTHING — the event
 * simply cannot upload again until it is back under. A settings change must
 * never destroy a document.
 */
export async function setEventQuota(
  actor: Actor,
  eventId: string,
  limitBytes: number | null,
) {
  assertCan(actor, "org.manage");
  if (limitBytes !== null && (!Number.isFinite(limitBytes) || limitBytes <= 0)) {
    throw new Error("Enter a size in GB, or leave it blank to use the default.");
  }
  await db
    .update(events)
    .set({ dataroomQuotaBytes: limitBytes })
    .where(eq(events.id, eventId));
  await logActivity({
    actorId: actor.id,
    action: "dataroom.quota_set",
    entity: `event:${eventId}`,
    detail: { limitBytes },
    eventId,
  });
}

export async function setDefaultQuota(actor: Actor, limitBytes: number) {
  assertCan(actor, "org.manage");
  if (!Number.isFinite(limitBytes) || limitBytes <= 0) {
    throw new Error("Enter a size in GB.");
  }
  await db
    .insert(appSettings)
    .values({ key: "dataroom_default_quota_bytes", value: limitBytes })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value: limitBytes, updatedAt: new Date() },
    });
  await logActivity({
    actorId: actor.id,
    action: "dataroom.default_quota_set",
    entity: "org:dataroom",
    detail: { limitBytes },
  });
}

export async function eventUsage(eventId: string) {
  const [used, limit] = await Promise.all([usedBytes(eventId), quotaFor(eventId)]);
  return usage(used, limit);
}

// ---- upload ---------------------------------------------------------------

export interface UploadResult {
  fileId: string;
  versionNo: number;
  sizeBytes: number;
  /** true when this upload took the event past 80% — fires the WA warning */
  crossedWarning: boolean;
}

/**
 * Stores a new file, or a new version of one. The quota is decided before a
 * byte is written and enforced again mid-stream, because the declared size is
 * a claim; a stream that outgrows its allowance is aborted and removed.
 */
export async function uploadFile(
  actor: Actor,
  input: {
    folderId: string;
    name: string;
    declaredSize: number;
    mimeType?: string;
    body: ReadableStream<Uint8Array> | Buffer;
    /** set to add a version to an existing file instead of creating one */
    replaceFileId?: string;
  },
): Promise<UploadResult> {
  const { folder } = await requireFolder(actor, input.folderId, "upload");
  const eventId = folder.eventId;

  const [used, limit, free] = await Promise.all([
    usedBytes(eventId),
    quotaFor(eventId),
    freeDiskBytes(),
  ]);
  const verdict = decideUpload({
    usedBytes: used,
    limitBytes: limit,
    incomingBytes: input.declaredSize,
    freeDiskBytes: free,
  });
  if (!verdict.ok) throw new Error(verdict.message);

  let fileId = input.replaceFileId ?? null;
  let versionNo = 1;
  if (fileId) {
    const [existing] = await db
      .select()
      .from(dataroomFiles)
      .where(eq(dataroomFiles.id, fileId))
      .limit(1);
    if (!existing || existing.folderId !== input.folderId) {
      throw new Error("That file is not in this folder.");
    }
    versionNo = existing.currentVersion + 1;
  } else {
    const [created] = await db
      .insert(dataroomFiles)
      .values({
        eventId,
        folderId: input.folderId,
        name: input.name.trim() || "Untitled",
        currentVersion: 1,
        createdBy: actor.id,
      })
      .returning({ id: dataroomFiles.id });
    fileId = created.id;
  }

  let written: number;
  try {
    written = await writeVersion(
      eventId,
      fileId,
      versionNo,
      input.body,
      verdict.remainingAfter + input.declaredSize,
    );
  } catch (error) {
    // a first version that never landed leaves a file row pointing at
    // nothing — remove it rather than showing an empty entry
    if (!input.replaceFileId) {
      await db.delete(dataroomFiles).where(eq(dataroomFiles.id, fileId));
    }
    if (error instanceof OverAllowanceError) {
      throw new Error("That file is larger than it claimed and was rejected.");
    }
    throw error;
  }

  await db.insert(dataroomFileVersions).values({
    fileId,
    versionNo,
    sizeBytes: written,
    mimeType: input.mimeType || "application/octet-stream",
    uploadedBy: actor.id,
  });
  if (input.replaceFileId) {
    await db
      .update(dataroomFiles)
      .set({ currentVersion: versionNo, updatedAt: new Date() })
      .where(eq(dataroomFiles.id, fileId));
  }

  await logAccess(actor, {
    fileId,
    folderId: input.folderId,
    eventId,
    fileName: input.name,
    versionNo,
    action: "upload",
  });

  return {
    fileId,
    versionNo,
    sizeBytes: written,
    crossedWarning: crossesWarningLine(used, used + written, limit),
  };
}

// ---- access log -----------------------------------------------------------

async function logAccess(
  actor: Actor,
  entry: {
    fileId: string;
    folderId: string | null;
    eventId: string;
    fileName: string;
    versionNo: number | null;
    action: "view" | "download" | "upload" | "trash" | "restore";
    note?: string;
  },
) {
  await db.insert(dataroomAccessLog).values({
    actorId: actor.id,
    fileId: entry.fileId,
    folderId: entry.folderId,
    eventId: entry.eventId,
    fileName: entry.fileName,
    versionNo: entry.versionNo,
    action: entry.action,
    note: entry.note ?? null,
  });
}

// ---- assistant access (Owner 2026-08-12) ----------------------------------

/**
 * Files the ASKER may see, for the assistant's context. The filter is the
 * same requireFolder/canSeeTask-style chain as the browsing UI — the
 * assistant must never become the side door past a sealed folder.
 */
export async function listFilesForAssistant(
  actor: Actor,
  eventId: string,
  cap = 100,
): Promise<
  Array<{ fileId: string; name: string; folderName: string; sizeHint: number }>
> {
  const folders = await listFolders(actor, eventId); // already access-filtered
  const out: Array<{ fileId: string; name: string; folderName: string; sizeHint: number }> = [];
  for (const folder of folders) {
    if (out.length >= cap) break;
    const files = await db
      .select()
      .from(dataroomFiles)
      .where(and(eq(dataroomFiles.folderId, folder.id), isNull(dataroomFiles.trashedAt)))
      .orderBy(asc(dataroomFiles.name));
    for (const file of files) {
      if (out.length >= cap) break;
      out.push({
        fileId: file.id,
        name: file.name,
        folderName: folder.name,
        sizeHint: 0,
      });
    }
  }
  return out;
}

/**
 * Opens a file for the assistant to read on the asker's behalf.
 *
 * The permission check is the asker's own (rule 1), and the read lands in
 * the access log attributed to the asker with the channel named (rule 2) —
 * an unlogged read here would make "who has seen this contract" a lie.
 */
export async function openForAssistant(actor: Actor, fileId: string) {
  const file = await requireFile(actor, fileId, "view");
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
  const { statVersion } = await import("./storage");
  const stored = await statVersion(file.eventId, file.id, version.versionNo);
  if (!stored) return null;

  await logAccess(actor, {
    fileId: file.id,
    folderId: file.folderId,
    eventId: file.eventId,
    fileName: file.name,
    versionNo: version.versionNo,
    action: "view",
    note: "via AI Assistant",
  });

  return {
    fileName: file.name,
    mimeType: version.mimeType,
    absolutePath: stored.absolutePath,
    sizeBytes: stored.sizeBytes,
  };
}

export interface ActivityRow {
  id: string;
  actorName: string | null;
  /** the email an outside visitor gave — the "who" when actorName is null */
  viewerEmail: string | null;
  action: string;
  fileName: string;
  versionNo: number | null;
  /** share detail: the link's label, its recipients, its gates */
  note: string | null;
  createdAt: Date;
}

/**
 * The activity view, filtered by the same rules as the files.
 *
 * Without this filter the page would read out the names of sealed documents
 * to anyone who can see the event, which would defeat the folders it exists
 * to audit. Rows whose folder has since been deleted stay with Owner/Admin
 * only: nobody is left who could be shown them safely.
 */
export async function listAccessLog(
  actor: Actor,
  eventId: string,
  limit = 200,
): Promise<ActivityRow[]> {
  assertCan(actor, "event.view");
  const visible = new Set((await listFolders(actor, eventId)).map((f) => f.id));
  const isOwnerAdmin = actor.role === "owner" || actor.role === "admin";

  const rows = await db
    .select({
      id: dataroomAccessLog.id,
      actorName: profiles.name,
      viewerEmail: dataroomAccessLog.viewerEmail,
      action: dataroomAccessLog.action,
      fileName: dataroomAccessLog.fileName,
      versionNo: dataroomAccessLog.versionNo,
      note: dataroomAccessLog.note,
      createdAt: dataroomAccessLog.createdAt,
      folderId: dataroomAccessLog.folderId,
    })
    .from(dataroomAccessLog)
    .leftJoin(profiles, eq(dataroomAccessLog.actorId, profiles.id))
    .where(eq(dataroomAccessLog.eventId, eventId))
    .orderBy(desc(dataroomAccessLog.createdAt))
    .limit(limit);

  return rows
    .filter((r) =>
      r.folderId === null ? isOwnerAdmin : visible.has(r.folderId),
    )
    .map((row) => ({
      id: row.id,
      actorName: row.actorName,
      viewerEmail: row.viewerEmail,
      action: row.action,
      fileName: row.fileName,
      versionNo: row.versionNo,
      note: row.note,
      createdAt: row.createdAt,
    }));
}

// ---- files ----------------------------------------------------------------

export async function listFiles(actor: Actor, folderId: string) {
  await requireFolder(actor, folderId, "view");
  return db
    .select()
    .from(dataroomFiles)
    .where(and(eq(dataroomFiles.folderId, folderId), isNull(dataroomFiles.trashedAt)))
    .orderBy(asc(dataroomFiles.name));
}

export async function listVersions(actor: Actor, fileId: string) {
  const file = await requireFile(actor, fileId, "view");
  return db
    .select()
    .from(dataroomFileVersions)
    .where(eq(dataroomFileVersions.fileId, file.id))
    .orderBy(desc(dataroomFileVersions.versionNo));
}

async function requireFile(
  actor: Actor,
  fileId: string,
  need: "view" | "upload" | "manage",
) {
  if (!isId(fileId)) throw new PermissionError("event.view");
  const [file] = await db
    .select()
    .from(dataroomFiles)
    .where(eq(dataroomFiles.id, fileId))
    .limit(1);
  if (!file) throw new PermissionError("event.view");
  await requireFolder(actor, file.folderId, need);
  return file;
}

/** Resolves a file for streaming AND writes the audit entry. The two are one
 *  operation on purpose: a download that skipped the log would be invisible. */
export async function openForDownload(
  actor: Actor,
  fileId: string,
  versionNo?: number,
) {
  const file = await requireFile(actor, fileId, "view");
  const wanted = versionNo ?? file.currentVersion;
  const [version] = await db
    .select()
    .from(dataroomFileVersions)
    .where(
      and(
        eq(dataroomFileVersions.fileId, file.id),
        eq(dataroomFileVersions.versionNo, wanted),
      ),
    )
    .limit(1);
  if (!version) return null;

  await logAccess(actor, {
    fileId: file.id,
    folderId: file.folderId,
    eventId: file.eventId,
    fileName: file.name,
    versionNo: wanted,
    action: "download",
  });
  return { file, version };
}

export async function renameFile(actor: Actor, fileId: string, name: string) {
  const file = await requireFile(actor, fileId, "upload");
  const clean = name.trim();
  if (!clean) throw new Error("A file needs a name.");
  await db
    .update(dataroomFiles)
    .set({ name: clean, updatedAt: new Date() })
    .where(eq(dataroomFiles.id, fileId));
  await logActivity({
    actorId: actor.id,
    action: "dataroom.file_renamed",
    entity: `dataroom_file:${fileId}`,
    detail: { from: file.name, to: clean },
    eventId: file.eventId,
  });
}

export async function renameFolder(actor: Actor, folderId: string, name: string) {
  const { folder } = await requireFolder(actor, folderId, "manage");
  const clean = name.trim();
  if (!clean) throw new Error("A folder needs a name.");
  await db
    .update(dataroomFolders)
    .set({ name: clean, updatedAt: new Date() })
    .where(eq(dataroomFolders.id, folderId));
  await logActivity({
    actorId: actor.id,
    action: "dataroom.folder_renamed",
    entity: `dataroom_folder:${folderId}`,
    detail: { from: folder.name, to: clean },
    eventId: folder.eventId,
  });
}

/**
 * Moves a file between folders — the drop half of drag-and-drop.
 *
 * Requires upload rights on BOTH sides: taking a document out of a folder is
 * as consequential as putting one in. Moving from a tighter folder to a wider
 * one effectively declassifies it, which the UI warns about; blocking it
 * outright would be theatre, since anyone who can read the file could
 * download and re-upload it anyway. So it is allowed, and it is logged with
 * both visibility levels named.
 */
/**
 * Re-parents a folder — the drop half of dragging a folder onto another.
 * `newParentId` null puts it back at the top level.
 *
 * Three refusals, each of which would otherwise corrupt the tree:
 *   1. A folder cannot move into itself or its own descendant — that detaches
 *      the whole subtree into an unreachable cycle.
 *   2. It cannot move to another event's dataroom.
 *   3. It cannot land under a parent more closed than itself (narrow-only,
 *      same rule as creation) — an "event" folder under a "sealed" one would
 *      look protected by its parent while its own level says open.
 */
export async function moveFolder(
  actor: Actor,
  folderId: string,
  newParentId: string | null,
) {
  const { folder } = await requireFolder(actor, folderId, "manage");
  if (folder.parentId === newParentId) return;
  if (newParentId === folder.id) throw new Error("A folder cannot contain itself.");

  if (newParentId) {
    const { folder: parent } = await requireFolder(actor, newParentId, "upload");
    if (parent.eventId !== folder.eventId) {
      throw new Error("A folder cannot move to another project's dataroom.");
    }
    // cycle guard: walk up from the target — if we meet the folder being
    // moved, the drop would place it inside its own subtree
    const { rows } = await loadFolders(folder.eventId);
    const byId = new Map(rows.map((r) => [r.id, r]));
    let cursor: string | null = parent.id;
    const seen = new Set<string>();
    while (cursor && !seen.has(cursor)) {
      if (cursor === folder.id) {
        throw new Error("That would put the folder inside itself.");
      }
      seen.add(cursor);
      cursor = byId.get(cursor)?.parentId ?? null;
    }
    if (!canNest(parent.visibility, folder.visibility)) {
      throw new Error(
        `“${folder.name}” (${folder.visibility}) cannot sit inside “${parent.name}” (${parent.visibility}) — a folder may only narrow.`,
      );
    }
  }

  await db
    .update(dataroomFolders)
    .set({ parentId: newParentId, updatedAt: new Date() })
    .where(eq(dataroomFolders.id, folderId));
  await logActivity({
    actorId: actor.id,
    action: "dataroom.folder_moved",
    entity: `dataroom_folder:${folderId}`,
    detail: { name: folder.name, toParent: newParentId },
    eventId: folder.eventId,
  });
}

export async function moveFile(
  actor: Actor,
  fileId: string,
  targetFolderId: string,
) {
  const file = await requireFile(actor, fileId, "upload");
  if (file.folderId === targetFolderId) return;

  const [source] = await db
    .select()
    .from(dataroomFolders)
    .where(eq(dataroomFolders.id, file.folderId))
    .limit(1);
  const { folder: target } = await requireFolder(actor, targetFolderId, "upload");
  if (target.eventId !== file.eventId) {
    throw new Error("A file cannot move to another project's dataroom.");
  }

  await db
    .update(dataroomFiles)
    .set({ folderId: targetFolderId, updatedAt: new Date() })
    .where(eq(dataroomFiles.id, fileId));
  await logActivity({
    actorId: actor.id,
    action: "dataroom.file_moved",
    entity: `dataroom_file:${fileId}`,
    detail: {
      fileName: file.name,
      from: source?.name ?? "?",
      to: target.name,
      fromVisibility: source?.visibility ?? "?",
      toVisibility: target.visibility,
    },
    eventId: file.eventId,
  });
}

export async function deleteFolder(actor: Actor, folderId: string) {
  const { folder } = await requireFolder(actor, folderId, "manage");
  const [{ count } = { count: 0 }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(dataroomFiles)
    .where(
      and(eq(dataroomFiles.folderId, folderId), isNull(dataroomFiles.trashedAt)),
    );
  if (count > 0) {
    // deleting a folder full of documents by accident is unrecoverable here,
    // because the files go with it — make the person empty it first
    throw new Error(
      `“${folder.name}” still holds ${count} file${count === 1 ? "" : "s"}. Move or delete them first.`,
    );
  }
  await db.delete(dataroomFolders).where(eq(dataroomFolders.id, folderId));
  await logActivity({
    actorId: actor.id,
    action: "dataroom.folder_deleted",
    entity: `dataroom_folder:${folderId}`,
    detail: { name: folder.name },
    eventId: folder.eventId,
  });
}

// ---- share links (EPIC-018) ----------------------------------------------

/** Creating a link requires the same rights as uploading: handing a document
 *  to an outsider is a bigger act than reading it. */
/**
 * Folder twin of createShare (Owner 2026-08-27).
 *
 * Requires "manage" on the folder, not merely "view": handing a folder to an
 * outsider gives away everything nested inside it, present and future, so it
 * is a stronger act than opening one file and asks for the stronger right.
 */
export async function listFolderShares(actor: Actor, folderId: string) {
  await requireFolder(actor, folderId, "manage");
  const { listFolderShareLinks } = await import("./share-service");
  return listFolderShareLinks(folderId);
}

export async function revokeFolderShare(
  actor: Actor,
  folderId: string,
  linkId: string,
) {
  await requireFolder(actor, folderId, "manage");
  const { revokeShareLink } = await import("./share-service");
  return revokeShareLink(actor, linkId);
}

export async function createFolderShare(
  actor: Actor,
  folderId: string,
  input: {
    expiryDays?: number;
    passcode?: string;
    requireEmail?: boolean;
    allowedEmails?: string[] | null;
    allowDownload?: boolean;
    watermark?: boolean;
    label?: string;
  },
) {
  const { folder } = await requireFolder(actor, folderId, "manage");
  const { createFolderShareLink } = await import("./share-service");
  return createFolderShareLink(
    actor,
    { id: folder.id, eventId: folder.eventId, name: folder.name },
    input,
  );
}

export async function createShare(
  actor: Actor,
  fileId: string,
  input: {
    expiryDays?: number;
    passcode?: string;
    requireEmail?: boolean;
    allowedEmails?: string[] | null;
    allowDownload?: boolean;
    watermark?: boolean;
    label?: string;
  },
) {
  const file = await requireFile(actor, fileId, "upload");
  // the current version's type and size decide whether a watermark is even
  // possible, so they travel with the file
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
  const { createShareLink } = await import("./share-service");
  return createShareLink(
    actor,
    {
      ...file,
      mimeType: version?.mimeType,
      sizeBytes: version?.sizeBytes,
    },
    input,
  );
}

export async function listSharesFor(actor: Actor, fileId: string) {
  await requireFile(actor, fileId, "view");
  const { listShareLinks } = await import("./share-service");
  return listShareLinks(fileId);
}

export async function revokeShare(actor: Actor, fileId: string, linkId: string) {
  await requireFile(actor, fileId, "upload");
  const { revokeShareLink } = await import("./share-service");
  await revokeShareLink(actor, linkId);
}

export async function trashFile(actor: Actor, fileId: string) {
  const file = await requireFile(actor, fileId, "upload");
  await db
    .update(dataroomFiles)
    .set({ trashedAt: new Date(), trashedBy: actor.id })
    .where(eq(dataroomFiles.id, fileId));
  await logAccess(actor, {
    fileId,
    folderId: file.folderId,
    eventId: file.eventId,
    fileName: file.name,
    versionNo: null,
    action: "trash",
  });
}

export async function restoreFile(actor: Actor, fileId: string) {
  const file = await requireFile(actor, fileId, "upload");
  await db
    .update(dataroomFiles)
    .set({ trashedAt: null, trashedBy: null })
    .where(eq(dataroomFiles.id, fileId));
  await logAccess(actor, {
    fileId,
    folderId: file.folderId,
    eventId: file.eventId,
    fileName: file.name,
    versionNo: null,
    action: "restore",
  });
}

/**
 * Removes trashed files past the retention window, freeing their quota. Run
 * from cron — a quota that never recovers is the price of skipping this.
 */
export async function purgeTrash(retentionDays = 30): Promise<number> {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  const doomed = await db
    .select({ id: dataroomFiles.id, eventId: dataroomFiles.eventId })
    .from(dataroomFiles)
    .where(
      and(
        isNotNull(dataroomFiles.trashedAt),
        sql`${dataroomFiles.trashedAt} < ${cutoff}`,
      ),
    );
  for (const file of doomed) {
    await purgeFile(file.eventId, file.id);
    // the access log keeps its rows: who read this contract must outlive it
    await db.delete(dataroomFiles).where(eq(dataroomFiles.id, file.id));
  }
  return doomed.length;
}
