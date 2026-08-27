"use client";

import { Loader2, MessageCircle, Send, Smile } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

// The sub-task conversation, as a chat rather than a comment log (Owner asked
// for something with a bit of life in it). Bubbles take sides — yours on the
// right, theirs on the left — because a two-party back-and-forth is far
// easier to follow that way than as a flat list of names.
//
// Portalled, like every other dialog here: it opens from inside a drawer on
// the internal side, whose transform would otherwise become the containing
// block and clip it.

interface Comment {
  id: string;
  authorName: string;
  mine: boolean;
  fromTeam: boolean;
  body: string;
  createdAt: string;
}

const QUICK = ["👍", "🙏", "🎉", "🔥", "👀", "✅"];

const time = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Asia/Jakarta",
});

/** Deterministic hue per name, so the same person keeps the same colour
 *  everywhere without storing one. */
function hueFor(name: string): number {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

export function SubtaskChat({
  itemId,
  itemTitle,
  token,
  onClose,
  onCountChange,
}: {
  itemId: string;
  itemTitle: string;
  /** present when the reader is a guest on a progress link */
  token?: string;
  onClose: () => void;
  onCountChange?: (unread: number) => void;
}) {
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const url = `/api/subtask-comments/${itemId}${token ? `?token=${encodeURIComponent(token)}` : ""}`;

  useEffect(() => {
    let alive = true;
    void fetch(url)
      .then((r) => r.json())
      .then((d: { comments?: Comment[]; error?: string }) => {
        if (!alive) return;
        if (d.error) setError(d.error);
        setComments(d.comments ?? []);
        // opening the thread IS reading it — clear the caller's bubble
        onCountChange?.(0);
      })
      .catch(() => alive && setError("Could not load the conversation."));
    return () => {
      alive = false;
    };
  }, [url, onCountChange]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [comments]);

  const send = async (text: string) => {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body }),
      });
      const d = (await res.json()) as { comments?: Comment[]; error?: string };
      if (!res.ok) throw new Error(d.error ?? "Could not post.");
      setComments(d.comments ?? []);
      setDraft("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not post.");
    } finally {
      setSending(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex h-[85svh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border bg-card shadow-lg sm:h-[70svh] sm:rounded-2xl">
        <header className="flex shrink-0 items-center gap-2 border-b px-4 py-3">
          <MessageCircle className="size-4 text-muted-foreground" />
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-sm font-semibold">{itemTitle}</span>
            <span className="text-[11px] text-muted-foreground">
              {comments === null
                ? "…"
                : comments.length === 0
                  ? "No messages yet"
                  : `${comments.length} message${comments.length === 1 ? "" : "s"}`}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            Close
          </button>
        </header>

        <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
          {comments === null ? (
            <p className="flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" /> Loading…
            </p>
          ) : comments.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
              <span className="text-3xl">💬</span>
              <p className="text-sm font-medium">Nothing here yet</p>
              <p className="max-w-xs text-xs text-muted-foreground">
                Ask a question, share an update, or just say hello — whoever is
                on the other side will see it.
              </p>
            </div>
          ) : (
            comments.map((c) => (
              <div
                key={c.id}
                className={cn("flex items-end gap-2", c.mine && "flex-row-reverse")}
              >
                <span
                  title={c.authorName}
                  style={{
                    backgroundColor: `oklch(0.85 0.06 ${hueFor(c.authorName)})`,
                    color: `oklch(0.32 0.09 ${hueFor(c.authorName)})`,
                  }}
                  className="flex size-7 shrink-0 select-none items-center justify-center rounded-full text-[11px] font-semibold uppercase"
                >
                  {c.authorName.slice(0, 1)}
                </span>
                <div className={cn("flex max-w-[75%] flex-col gap-0.5", c.mine && "items-end")}>
                  <span className="px-1 text-[10px] text-muted-foreground">
                    {c.authorName}
                    {c.fromTeam ? " · team" : ""} · {time.format(new Date(c.createdAt))}
                  </span>
                  <p
                    className={cn(
                      "whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm",
                      c.mine
                        ? "rounded-br-sm bg-foreground text-background"
                        : "rounded-bl-sm bg-muted text-foreground",
                    )}
                  >
                    {c.body}
                  </p>
                </div>
              </div>
            ))
          )}
          <div ref={endRef} />
        </div>

        <div className="flex shrink-0 flex-col gap-2 border-t p-3">
          <div className="flex flex-wrap gap-1">
            {QUICK.map((e) => (
              <button
                key={e}
                type="button"
                disabled={sending}
                onClick={() => void send(e)}
                className="rounded-full border px-2 py-0.5 text-sm transition-transform hover:scale-110 active:scale-95"
              >
                {e}
              </button>
            ))}
            <Smile className="ml-auto size-3.5 self-center text-muted-foreground" />
          </div>

          {error ? (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          ) : null}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void send(draft);
            }}
            className="flex items-end gap-2"
          >
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send(draft);
                }
              }}
              rows={1}
              maxLength={4000}
              placeholder="Write a message…  (Enter to send)"
              className="max-h-32 min-h-9 flex-1 resize-y rounded-xl border bg-background px-3 py-2 text-sm outline-none focus:border-foreground/40"
            />
            <button
              type="submit"
              disabled={sending || !draft.trim()}
              aria-label="Send"
              className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-foreground text-background transition-transform hover:scale-105 active:scale-95 disabled:opacity-40 disabled:hover:scale-100"
            >
              {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            </button>
          </form>
        </div>
      </div>
    </div>,
    document.body,
  );
}
