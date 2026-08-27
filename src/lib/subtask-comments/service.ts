import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  subtaskCommentReads,
  subtaskComments,
  taskChecklistItems,
} from "@/db/schema";
import { readerKey, unreadCount, type Reader } from "./identity";

// The thread itself. Who may read or write is decided by the caller — the app
// session for a colleague, a live share link for a guest — because the two
// authorisations have nothing in common and folding them together here would
// mean one weaker check standing in for both.

const MAX_BODY = 4000;

export interface ThreadComment {
  id: string;
  authorName: string;
  /** true when the reader wrote it, so the bubble can sit on their side */
  mine: boolean;
  fromTeam: boolean;
  body: string;
  createdAt: string;
}

export async function listThread(
  checklistItemId: string,
  reader: Reader,
): Promise<{ comments: ThreadComment[]; unread: number }> {
  const rows = await db
    .select()
    .from(subtaskComments)
    .where(eq(subtaskComments.checklistItemId, checklistItemId))
    .orderBy(asc(subtaskComments.createdAt));

  const [read] = await db
    .select()
    .from(subtaskCommentReads)
    .where(
      and(
        eq(subtaskCommentReads.checklistItemId, checklistItemId),
        eq(subtaskCommentReads.readerKey, readerKey(reader)),
      ),
    )
    .limit(1);

  const mine = (r: (typeof rows)[number]) =>
    reader.kind === "member"
      ? r.authorId === reader.profileId
      : r.authorId === null &&
        (r.guestEmail ?? null) === (reader.email ? reader.email.trim().toLowerCase() : null);

  return {
    unread: unreadCount(rows, reader, read?.lastReadAt ?? null),
    comments: rows.map((r) => ({
      id: r.id,
      authorName: r.authorName,
      mine: mine(r),
      fromTeam: r.authorId !== null,
      body: r.body,
      createdAt: r.createdAt.toISOString(),
    })),
  };
}

export async function postComment(
  checklistItemId: string,
  reader: Reader,
  body: string,
): Promise<void> {
  const text = body.trim();
  if (!text) throw new Error("Write something first.");
  if (text.length > MAX_BODY) throw new Error("That message is too long.");

  const [item] = await db
    .select({ taskId: taskChecklistItems.taskId })
    .from(taskChecklistItems)
    .where(eq(taskChecklistItems.id, checklistItemId))
    .limit(1);
  if (!item) throw new Error("That sub-task no longer exists.");

  await db.insert(subtaskComments).values({
    checklistItemId,
    taskId: item.taskId,
    authorId: reader.kind === "member" ? reader.profileId : null,
    authorName: reader.name,
    guestEmail:
      reader.kind === "guest" ? (reader.email?.trim().toLowerCase() ?? null) : null,
    shareLinkId: reader.kind === "guest" ? reader.shareLinkId : null,
    body: text,
  });

  // posting counts as reading: the writer has plainly seen everything above
  await markRead(checklistItemId, reader);
}

export async function markRead(checklistItemId: string, reader: Reader): Promise<void> {
  const key = readerKey(reader);
  await db
    .insert(subtaskCommentReads)
    .values({ checklistItemId, readerKey: key, lastReadAt: new Date() })
    .onConflictDoUpdate({
      target: [subtaskCommentReads.checklistItemId, subtaskCommentReads.readerKey],
      set: { lastReadAt: new Date() },
    });
}

/** Unread counts for every sub-task of one task, for the badges. */
export async function unreadByItem(
  taskId: string,
  reader: Reader,
): Promise<Map<string, number>> {
  const rows = await db
    .select()
    .from(subtaskComments)
    .where(eq(subtaskComments.taskId, taskId));
  if (rows.length === 0) return new Map();

  const itemIds = [...new Set(rows.map((r) => r.checklistItemId))];
  const reads = await db
    .select()
    .from(subtaskCommentReads)
    .where(
      and(
        inArray(subtaskCommentReads.checklistItemId, itemIds),
        eq(subtaskCommentReads.readerKey, readerKey(reader)),
      ),
    );
  const lastRead = new Map(reads.map((r) => [r.checklistItemId, r.lastReadAt]));

  const out = new Map<string, number>();
  for (const itemId of itemIds) {
    const n = unreadCount(
      rows.filter((r) => r.checklistItemId === itemId),
      reader,
      lastRead.get(itemId) ?? null,
    );
    if (n > 0) out.set(itemId, n);
  }
  return out;
}

/** Total comments per sub-task, so a quiet thread still shows it exists. */
export async function commentCountByItem(taskId: string): Promise<Map<string, number>> {
  const rows = await db
    .select({ itemId: subtaskComments.checklistItemId })
    .from(subtaskComments)
    .where(eq(subtaskComments.taskId, taskId));
  const out = new Map<string, number>();
  for (const r of rows) out.set(r.itemId, (out.get(r.itemId) ?? 0) + 1);
  return out;
}
