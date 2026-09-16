"use client";

import { Check, FileText, Loader2, Plus } from "lucide-react";
import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  editablePagesAction,
  saveAnswerToPageAction,
  type SaveToPageState,
} from "./page-actions";

// "Save to page" offer under an assistant answer (EPIC-016 T-163).
// Deliberately opt-in per answer: the assistant never writes to a page on its
// own, so nothing reaches a shared surface without a person choosing it.

export function SaveToPage({
  markdown,
  conversationId,
}: {
  markdown: string;
  conversationId: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"new" | "existing">("new");
  const [targets, setTargets] = useState<Array<{ id: string; title: string }>>([]);
  const [targetId, setTargetId] = useState("");
  const [state, formAction, saving] = useActionState<SaveToPageState, FormData>(
    saveAnswerToPageAction,
    {},
  );

  // the page list is only needed once the panel is opened
  useEffect(() => {
    if (!open || targets.length > 0) return;
    let alive = true;
    void editablePagesAction().then((rows) => {
      if (alive) setTargets(rows);
    });
    return () => {
      alive = false;
    };
  }, [open, targets.length]);

  if (state.pageId) {
    return (
      <p className="mt-2 flex items-center gap-1.5 text-xs text-status-done">
        <Check className="size-3.5" />
        Saved to{" "}
        <Link
          href={`/pages/${state.pageId}`}
          className="font-medium underline underline-offset-4"
        >
          {state.title ?? "the page"}
        </Link>
      </p>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-2 flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
      >
        <FileText className="size-3.5" />
        Save to a page
      </button>
    );
  }

  return (
    <form
      action={formAction}
      className="mt-2 flex flex-col gap-2.5 rounded-md border bg-muted/20 p-3"
    >
      <input type="hidden" name="markdown" value={markdown} />
      <input type="hidden" name="conversationId" value={conversationId ?? ""} />

      <div className="flex gap-1">
        {(["new", "existing"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={cn(
              "rounded-full border px-2.5 py-1 text-xs transition-colors",
              mode === m
                ? "border-foreground/40 bg-background font-medium"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {m === "new" ? "New page" : "Add to a page"}
          </button>
        ))}
      </div>

      {mode === "new" ? (
        <Input
          name="title"
          placeholder="Page title — leave blank to use the answer's heading"
          className="h-9 text-sm"
        />
      ) : targets.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          You have no pages of your own yet — create one with New page.
        </p>
      ) : (
        <div className="flex max-h-40 flex-col gap-1 overflow-y-auto">
          <input type="hidden" name="pageId" value={targetId} />
          {targets.map((page) => (
            <button
              key={page.id}
              type="button"
              onClick={() => setTargetId(page.id)}
              className={cn(
                "flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-left text-xs transition-colors",
                targetId === page.id
                  ? "border-foreground/40 bg-background font-medium"
                  : "border-transparent hover:bg-surface-2",
              )}
            >
              <FileText className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate">{page.title}</span>
            </button>
          ))}
        </div>
      )}

      {state.error ? (
        <p role="alert" className="text-xs text-destructive">
          {state.error}
        </p>
      ) : null}

      <div className="flex items-center gap-2">
        <Button
          type="submit"
          size="sm"
          disabled={saving || (mode === "existing" && !targetId)}
          className="gap-1.5"
        >
          {saving ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Plus className="size-3.5" />
          )}
          {mode === "new" ? "Create page" : "Append"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => setOpen(false)}
          className="text-muted-foreground"
        >
          Cancel
        </Button>
        <span className="text-[11px] text-muted-foreground">
          New pages are private until you share them.
        </span>
      </div>
    </form>
  );
}
