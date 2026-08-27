"use client";

import { MessageCircle } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { SubtaskChat } from "./subtask-chat";

/**
 * Comment button for one sub-task, carrying its own unread bubble.
 *
 * The count is held in state rather than read from the server on every
 * render, so opening the thread clears the bubble immediately instead of
 * waiting for a refresh — the reader has plainly just read it.
 */
export function SubtaskCommentButton({
  itemId,
  itemTitle,
  token,
  unread = 0,
  total = 0,
  className,
}: {
  itemId: string;
  itemTitle: string;
  token?: string;
  unread?: number;
  total?: number;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(unread);

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
        aria-label={
          count > 0
            ? `${count} unread message${count === 1 ? "" : "s"} on ${itemTitle}`
            : `Comments on ${itemTitle}`
        }
        className={cn(
          "relative inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] tabular-nums transition-colors",
          count > 0
            ? "text-foreground"
            : "text-muted-foreground hover:bg-accent hover:text-foreground",
          className,
        )}
      >
        <MessageCircle className={cn("size-3.5", count > 0 && "fill-current/10")} />
        {total > 0 ? total : null}
        {count > 0 ? (
          <span
            aria-hidden
            className="absolute -right-0.5 -top-0.5 flex min-w-[15px] items-center justify-center rounded-full bg-destructive px-1 text-[9px] font-semibold leading-[15px] text-white"
          >
            {count > 9 ? "9+" : count}
          </span>
        ) : null}
      </button>
      {open ? (
        <SubtaskChat
          itemId={itemId}
          itemTitle={itemTitle}
          token={token}
          onClose={() => setOpen(false)}
          onCountChange={setCount}
        />
      ) : null}
    </>
  );
}
