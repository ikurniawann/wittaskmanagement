// Who is reading a sub-task thread (Owner 2026-08-27).
//
// Two unrelated kinds of reader share one thread, so "who am I" is reduced to
// a single opaque string. Keeping that reduction pure — and in one place —
// matters more than it looks: the key decides whose unread bubble is whose,
// and two readers colliding on one key would show each other's unread state.

export type Reader =
  | { kind: "member"; profileId: string; name: string }
  | { kind: "guest"; shareLinkId: string; email: string | null; name: string };

export function readerKey(reader: Reader): string {
  return reader.kind === "member"
    ? `profile:${reader.profileId}`
    : // Anonymous guests on the SAME link share one key, and that is the
      // honest answer: without an email there is nothing to tell them apart,
      // and inventing a per-browser identity would only pretend otherwise.
      `guest:${reader.shareLinkId}:${reader.email?.trim().toLowerCase() || "anon"}`;
}

export interface CommentLike {
  id: string;
  authorId: string | null;
  guestEmail: string | null;
  createdAt: Date;
}

/**
 * How many messages in a thread are new to this reader.
 *
 * Your own messages never count: seeing a bubble appear because you wrote
 * something is noise, and it would never clear until you re-read your own
 * words. A reader who has never opened the thread has read nothing, so
 * everything by anyone else is new.
 */
export function unreadCount(
  comments: CommentLike[],
  reader: Reader,
  lastReadAt: Date | null,
): number {
  const mine = (c: CommentLike) =>
    reader.kind === "member"
      ? c.authorId === reader.profileId
      : c.authorId === null &&
        (c.guestEmail ?? null) ===
          (reader.email ? reader.email.trim().toLowerCase() : null);

  return comments.filter(
    (c) => !mine(c) && (lastReadAt === null || c.createdAt > lastReadAt),
  ).length;
}
