import { describe, expect, it } from "vitest";
import { readerKey, unreadCount, type CommentLike, type Reader } from "./identity";

const MEMBER: Reader = { kind: "member", profileId: "p1", name: "Ilham" };
const GUEST: Reader = { kind: "guest", shareLinkId: "L1", email: "Klien@Contoh.com", name: "Klien" };
const ANON: Reader = { kind: "guest", shareLinkId: "L1", email: null, name: "Guest" };

function c(over: Partial<CommentLike>): CommentLike {
  return { id: "c", authorId: null, guestEmail: null, createdAt: new Date("2026-08-27T10:00:00Z"), ...over };
}

describe("readerKey", () => {
  it("separates a member from a guest", () => {
    expect(readerKey(MEMBER)).not.toBe(readerKey(GUEST));
  });

  it("is case- and space-insensitive for a guest email", () => {
    expect(readerKey(GUEST)).toBe(
      readerKey({ kind: "guest", shareLinkId: "L1", email: "  klien@contoh.com ", name: "x" }),
    );
  });

  it("separates the same email arriving through different links", () => {
    expect(readerKey(GUEST)).not.toBe(
      readerKey({ kind: "guest", shareLinkId: "L2", email: "klien@contoh.com", name: "x" }),
    );
  });

  it("gives every anonymous visitor on one link the same key", () => {
    expect(readerKey(ANON)).toBe(readerKey({ kind: "guest", shareLinkId: "L1", email: null, name: "y" }));
  });
});

describe("unreadCount", () => {
  const older = new Date("2026-08-27T09:00:00Z");
  const newer = new Date("2026-08-27T11:00:00Z");

  it("counts everything when the thread was never opened", () => {
    expect(unreadCount([c({ authorId: "p2" }), c({ guestEmail: "x@y.z" })], MEMBER, null)).toBe(2);
  });

  it("counts only what arrived after the last read", () => {
    const list = [c({ authorId: "p2", createdAt: older }), c({ authorId: "p2", createdAt: newer })];
    expect(unreadCount(list, MEMBER, new Date("2026-08-27T10:00:00Z"))).toBe(1);
  });

  it("never counts the reader's OWN messages", () => {
    expect(unreadCount([c({ authorId: "p1" }), c({ authorId: "p1" })], MEMBER, null)).toBe(0);
    expect(unreadCount([c({ guestEmail: "klien@contoh.com" })], GUEST, null)).toBe(0);
  });

  it("a guest still sees the team's messages as unread", () => {
    expect(unreadCount([c({ authorId: "p1" })], GUEST, null)).toBe(1);
  });

  it("an anonymous guest counts every guest message as someone else's", () => {
    // nothing distinguishes them, so the honest answer is "not provably mine"
    expect(unreadCount([c({ guestEmail: "someone@else.com" })], ANON, null)).toBe(1);
  });
});
