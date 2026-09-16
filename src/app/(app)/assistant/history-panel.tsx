"use client";

import {
  FolderClosed,
  FolderPlus,
  Inbox,
  MessageSquareText,
  MoreHorizontal,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import Link from "next/link";
import { useActionState, useState } from "react";
import {
  createGroupAction,
  deleteConversationAction,
  deleteGroupAction,
  moveConversationAction,
} from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// Conversation history panel (EPIC-014 T-141): user-defined groups +
// an implicit "Ungrouped" bucket for everything else.

export interface HistoryConversation {
  id: string;
  title: string;
  groupId: string | null;
}

export interface HistoryGroup {
  id: string;
  name: string;
  conversations: HistoryConversation[];
}

function ConversationRow({
  conversation,
  activeId,
  groups,
}: {
  conversation: HistoryConversation;
  activeId: string | null;
  groups: Array<{ id: string; name: string }>;
}) {
  // options expand INLINE below the row (never a floating popover — the
  // scrollable history column clipped it; Owner bug report 2026-08-07)
  const [menuOpen, setMenuOpen] = useState(false);
  const active = conversation.id === activeId;

  return (
    <div
      className={cn(
        "group/row flex flex-col rounded-md",
        active
          ? "bg-surface-2 text-foreground"
          : "text-muted-foreground hover:bg-surface-2 hover:text-foreground",
      )}
    >
      <div className="flex items-center gap-1 pr-1">
        <Link
          href={`/assistant?c=${conversation.id}`}
          className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-[13px]"
        >
          <MessageSquareText className="size-3.5 shrink-0 opacity-60" />
          <span className="min-w-0 truncate">{conversation.title}</span>
        </Link>
        <button
          type="button"
          aria-label="Conversation options"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((o) => !o)}
          className={cn(
            "shrink-0 rounded p-1 text-muted-foreground/60 hover:text-foreground",
            !menuOpen && "opacity-0 group-hover/row:opacity-100",
          )}
        >
          <MoreHorizontal className="size-3.5" />
        </button>
      </div>

      {menuOpen ? (
        <div className="flex flex-col gap-1.5 border-t px-2 py-2">
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
            Move to
          </span>
          <div className="flex flex-wrap gap-1">
            <form action={moveConversationAction}>
              <input type="hidden" name="conversationId" value={conversation.id} />
              <input type="hidden" name="groupId" value="" />
              <button
                type="submit"
                aria-pressed={conversation.groupId === null}
                className={cn(
                  "rounded-full border px-2 py-0.5 text-[11px] transition-all",
                  conversation.groupId === null
                    ? "border-foreground bg-foreground font-medium text-background"
                    : "text-muted-foreground hover:border-foreground/40 hover:text-foreground",
                )}
              >
                Ungrouped
              </button>
            </form>
            {groups.map((group) => (
              <form key={group.id} action={moveConversationAction}>
                <input type="hidden" name="conversationId" value={conversation.id} />
                <input type="hidden" name="groupId" value={group.id} />
                <button
                  type="submit"
                  aria-pressed={conversation.groupId === group.id}
                  className={cn(
                    "max-w-40 truncate rounded-full border px-2 py-0.5 text-[11px] transition-all",
                    conversation.groupId === group.id
                      ? "border-foreground bg-foreground font-medium text-background"
                      : "text-muted-foreground hover:border-foreground/40 hover:text-foreground",
                  )}
                >
                  {group.name}
                </button>
              </form>
            ))}
          </div>
          <form action={deleteConversationAction}>
            <input type="hidden" name="conversationId" value={conversation.id} />
            <input type="hidden" name="active" value={String(active)} />
            <button
              type="submit"
              className="flex w-full items-center gap-1.5 rounded py-0.5 text-left text-xs text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="size-3.5" /> Delete chat
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}

export function HistoryPanel({
  groups,
  ungrouped,
  activeId,
}: {
  groups: HistoryGroup[];
  ungrouped: HistoryConversation[];
  activeId: string | null;
}) {
  const [addingGroup, setAddingGroup] = useState(false);
  const [state, formAction, pending] = useActionState<{ error?: string }, FormData>(
    createGroupAction,
    {},
  );
  const groupOptions = groups.map((g) => ({ id: g.id, name: g.name }));

  return (
    <aside className="flex w-full shrink-0 flex-col gap-4 lg:w-64">
      <Link
        href="/assistant"
        className="flex items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground elev-hover"
      >
        <Plus className="size-4" /> New chat
      </Link>

      <div className="flex flex-col gap-3 overflow-y-auto">
        {groups.map((group) => (
          <div key={group.id} className="flex flex-col gap-1">
            <div className="group/head flex items-center gap-1.5 px-1">
              <FolderClosed className="size-3.5 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate text-xs font-semibold text-muted-foreground">
                {group.name}
              </span>
              <form action={deleteGroupAction}>
                <input type="hidden" name="groupId" value={group.id} />
                <button
                  type="submit"
                  aria-label={`Delete group ${group.name} (chats move to Ungrouped)`}
                  title="Delete group — chats move to Ungrouped"
                  className="rounded p-0.5 text-muted-foreground/50 opacity-0 hover:text-destructive group-hover/head:opacity-100"
                >
                  <X className="size-3" />
                </button>
              </form>
            </div>
            {group.conversations.length === 0 ? (
              <p className="px-2 text-[11px] text-muted-foreground/60">
                Empty — move chats here.
              </p>
            ) : (
              group.conversations.map((conversation) => (
                <ConversationRow
                  key={conversation.id}
                  conversation={conversation}
                  activeId={activeId}
                  groups={groupOptions}
                />
              ))
            )}
          </div>
        ))}

        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1.5 px-1">
            <Inbox className="size-3.5 text-muted-foreground" />
            <span className="text-xs font-semibold text-muted-foreground">
              Ungrouped
            </span>
          </div>
          {ungrouped.length === 0 ? (
            <p className="px-2 text-[11px] text-muted-foreground/60">
              No saved chats yet.
            </p>
          ) : (
            ungrouped.map((conversation) => (
              <ConversationRow
                key={conversation.id}
                conversation={conversation}
                activeId={activeId}
                groups={groupOptions}
              />
            ))
          )}
        </div>
      </div>

      {addingGroup ? (
        <form action={formAction} className="flex flex-col gap-1.5">
          <div className="flex items-center gap-1.5">
            <Input
              name="name"
              autoFocus
              placeholder="Group name…"
              className="h-8 text-xs"
            />
            <Button type="submit" size="sm" disabled={pending}>
              Add
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setAddingGroup(false)}
            >
              ×
            </Button>
          </div>
          {state.error ? (
            <p role="alert" className="text-[11px] text-destructive">
              {state.error}
            </p>
          ) : null}
        </form>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setAddingGroup(true)}
          className="justify-start gap-1.5 text-xs text-muted-foreground"
        >
          <FolderPlus className="size-3.5" /> New group
        </Button>
      )}
    </aside>
  );
}
