"use client";

import { useActionState, useMemo, useRef, useState } from "react";
import { commentAction, type TaskActionState } from "../actions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useActionToast } from "@/lib/use-action-toast";

// Comment box with @mention typeahead (T-034): typing "@" filters division
// members; picking one inserts "@Name" and records the mention id.
export function CommentForm({
  taskId,
  mentionOptions,
}: {
  taskId: string;
  mentionOptions: Array<{ id: string; name: string }>;
}) {
  const [state, formAction, pending] = useActionState<TaskActionState, FormData>(
    commentAction,
    {},
  );
  useActionToast(pending, state.error, "Comment posted");
  const [body, setBody] = useState("");
  const [mentions, setMentions] = useState<Array<{ id: string; name: string }>>([]);
  const [query, setQuery] = useState<string | null>(null);
  const [imageName, setImageName] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const imageRef = useRef<HTMLInputElement>(null);

  const matches = useMemo(() => {
    if (query === null) return [];
    const q = query.toLowerCase();
    const people = mentionOptions
      .filter((m) => m.name.toLowerCase().includes(q))
      .slice(0, 5);
    // socmed-style @all — pings everyone in the task's division
    const withAll =
      "all".startsWith(q) || q === ""
        ? [{ id: "all", name: "all" }, ...people]
        : people;
    return withAll.slice(0, 6);
  }, [query, mentionOptions]);

  const onChange = (value: string) => {
    setBody(value);
    const caret = textareaRef.current?.selectionStart ?? value.length;
    const upToCaret = value.slice(0, caret);
    const match = /@([\w ]{0,30})$/.exec(upToCaret);
    setQuery(match ? match[1] : null);
  };

  const pick = (user: { id: string; name: string }) => {
    const caret = textareaRef.current?.selectionStart ?? body.length;
    const upToCaret = body.slice(0, caret).replace(/@[\w ]{0,30}$/, `@${user.name} `);
    setBody(upToCaret + body.slice(caret));
    if (!mentions.some((m) => m.id === user.id)) {
      setMentions((prev) => [...prev, user]);
    }
    setQuery(null);
    textareaRef.current?.focus();
  };

  return (
    <form
      action={(formData) => {
        formAction(formData);
        setBody("");
        setMentions([]);
        setImageName(null);
      }}
      className="relative flex flex-col gap-3"
    >
      <input type="hidden" name="taskId" value={taskId} />
      {mentions.map((m) => (
        <input key={m.id} type="hidden" name="mentions" value={m.id} />
      ))}
      <textarea
        ref={textareaRef}
        name="body"
        rows={3}
        value={body}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Write a comment… use @ to mention"
        className="border-input rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      />
      {matches.length > 0 ? (
        <ul className="absolute bottom-14 left-2 z-40 w-56 rounded-md border bg-popover p-1 shadow-md">
          {matches.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                onClick={() => pick(m)}
                className={cn(
                  "w-full rounded-sm px-2 py-1.5 text-left text-xs hover:bg-surface-2",
                  m.id === "all" && "font-semibold",
                )}
              >
                @{m.name}
                {m.id === "all" ? (
                  <span className="ml-1.5 font-normal text-muted-foreground">
                    — everyone in this division
                  </span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {mentions.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          Mentions: {mentions.map((m) => `@${m.name}`).join(", ")}
        </p>
      ) : null}
      {state.error ? (
        <p role="alert" className="text-sm text-destructive">{state.error}</p>
      ) : null}
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={pending || !body.trim()}>
          {pending ? "Posting…" : "Comment"}
        </Button>
        <input
          ref={imageRef}
          type="file"
          name="attachment"
          className="hidden"
          onChange={(e) => setImageName(e.target.files?.[0]?.name ?? null)}
        />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => imageRef.current?.click()}
          className="text-xs text-muted-foreground"
        >
          📎 {imageName ?? "Attach image / file"}
        </Button>
      </div>
    </form>
  );
}
