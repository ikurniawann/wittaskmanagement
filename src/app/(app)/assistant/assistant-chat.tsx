"use client";

import { ArrowUp, Paperclip, Sparkles, Square, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { UserAvatar } from "@/components/task-meta";
import { SaveToPage } from "./save-to-page";
import { cn } from "@/lib/utils";

// Claude-style chat for the AI assistant (EPIC-014, Owner request).
// Conversation lives in memory for the session; context is rebuilt
// permission-scoped on every request server-side.

interface Message {
  role: "user" | "assistant";
  content: string;
  /** names of files sent with this turn — display only (EPIC-016 T-161) */
  files?: string[];
}

/** Extensions the server can actually read; anything else is refused here
 *  so the user finds out before an upload rather than after. */
const ACCEPTED =
  ".pdf,.docx,.xlsx,.csv,.tsv,.txt,.md,.json,.log,.png,.jpg,.jpeg,.webp,.gif";
const MAX_ATTACHMENTS = 5;

const SUGGESTIONS = [
  "Prediksi apakah project ini akan berjalan lancar, dan apa alasannya?",
  "Siapa yang paling overload minggu ini, dan task apa saja?",
  "Bottleneck paling berbahaya sekarang apa, dan apa dampaknya?",
  "Bandingkan kesiapan kita dengan praktik industri untuk konser sekelas ini.",
];

// -- markdown-lite renderer (bold / headings / lists / inline code) — plain
// React elements, no HTML injection surface
function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  parts.forEach((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      out.push(<strong key={`${keyBase}-${i}`}>{part.slice(2, -2)}</strong>);
    } else if (part.startsWith("`") && part.endsWith("`")) {
      out.push(
        <code
          key={`${keyBase}-${i}`}
          className="rounded-sm bg-muted px-1 font-mono text-[0.85em]"
        >
          {part.slice(1, -1)}
        </code>,
      );
    } else if (part) {
      out.push(part);
    }
  });
  return out;
}

function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  const flushList = (key: string) => {
    if (!list) return;
    const items = list.items;
    blocks.push(
      list.ordered ? (
        <ol key={key} className="my-1.5 list-decimal space-y-1 pl-5">
          {items.map((item, i) => (
            <li key={i}>{inline(item, `${key}-${i}`)}</li>
          ))}
        </ol>
      ) : (
        <ul key={key} className="my-1.5 list-disc space-y-1 pl-5">
          {items.map((item, i) => (
            <li key={i}>{inline(item, `${key}-${i}`)}</li>
          ))}
        </ul>
      ),
    );
    list = null;
  };

  text.split("\n").forEach((line, i) => {
    const key = `b${i}`;
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);

    if (bullet) {
      if (!list || list.ordered) {
        flushList(`${key}-f`);
        list = { ordered: false, items: [] };
      }
      list.items.push(bullet[1]);
      return;
    }
    if (numbered) {
      if (!list || !list.ordered) {
        flushList(`${key}-f`);
        list = { ordered: true, items: [] };
      }
      list.items.push(numbered[1]);
      return;
    }
    flushList(`${key}-f`);
    if (heading) {
      blocks.push(
        <p key={key} className="mt-3 mb-1 font-semibold">
          {inline(heading[2], key)}
        </p>,
      );
    } else if (line.trim()) {
      blocks.push(
        <p key={key} className="my-1.5">
          {inline(line, key)}
        </p>,
      );
    }
  });
  flushList("tail");

  return <div className="text-sm leading-relaxed">{blocks}</div>;
}

export function AssistantChat({
  userName,
  assistantName,
  events,
  configured,
  conversationId: initialConversationId = null,
  initialMessages = [],
  initialEventId = "",
}: {
  userName: string;
  /** installation-configured display name (Admin → branding) */
  assistantName: string;
  events: Array<{ id: string; name: string }>;
  configured: boolean;
  conversationId?: string | null;
  initialMessages?: Message[];
  initialEventId?: string;
}) {
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [input, setInput] = useState("");
  const [eventId, setEventId] = useState(initialEventId);
  const [streaming, setStreaming] = useState(false);
  // files chosen but not yet sent — they ride along with the next message
  const [pending, setPending] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const conversationRef = useRef<string | null>(initialConversationId);
  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  const send = async (text: string) => {
    const question = text.trim();
    if ((!question && pending.length === 0) || streaming) return;
    setInput("");
    const sending = pending;
    setPending([]);
    const nextMessages: Message[] = [
      ...messages,
      {
        role: "user",
        content: question,
        files: sending.map((f) => f.name),
      },
    ];
    setMessages([...nextMessages, { role: "assistant", content: "" }]);
    setStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const payload = {
        // strip the display-only file names before sending the history back
        messages: nextMessages.map((m) => ({ role: m.role, content: m.content })),
        eventId: eventId || undefined,
        conversationId: conversationRef.current ?? undefined,
      };
      let init: RequestInit;
      if (sending.length > 0) {
        // multipart only when there is something to upload; a plain chat
        // keeps the original JSON request
        const form = new FormData();
        form.set("payload", JSON.stringify(payload));
        for (const file of sending) form.append("files", file);
        init = { method: "POST", body: form, signal: controller.signal };
      } else {
        init = {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: controller.signal,
        };
      }
      const res = await fetch("/api/ai/chat", init);
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(data?.error ?? `Request failed (${res.status})`);
      }
      // a fresh chat gets its persisted id back — pin the URL to it so
      // reload/back keeps the conversation (T-141)
      const newId = res.headers.get("X-Conversation-Id");
      if (newId && !conversationRef.current) {
        conversationRef.current = newId;
        window.history.replaceState(null, "", `/assistant?c=${newId}`);
      }
      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response stream.");
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        setMessages((prev) => {
          const copy = [...prev];
          const last = copy[copy.length - 1];
          copy[copy.length - 1] = {
            ...last,
            content: last.content + chunk,
          };
          return copy;
        });
      }
    } catch (error) {
      const message =
        error instanceof DOMException && error.name === "AbortError"
          ? "(stopped)"
          : `[error] ${error instanceof Error ? error.message : "Request failed."}`;
      setMessages((prev) => {
        const copy = [...prev];
        const last = copy[copy.length - 1];
        copy[copy.length - 1] = {
          ...last,
          content: last.content ? `${last.content}\n\n${message}` : message,
        };
        return copy;
      });
    } finally {
      setStreaming(false);
      abortRef.current = null;
      textareaRef.current?.focus();
      // refresh the server-rendered history panel (new chat title / order)
      router.refresh();
    }
  };

  const stop = () => abortRef.current?.abort();

  if (!configured) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col items-center gap-2 rounded-md border border-dashed px-6 py-16 text-center">
        <Sparkles className="size-6 text-muted-foreground" />
        <p className="text-sm font-medium">
          {assistantName} is not configured
        </p>
        <p className="text-xs text-muted-foreground">
          Ask an admin to add an API key in Settings → Integrations.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col">
      {/* event focus */}
      <div className="flex flex-wrap items-center gap-1.5 pb-4">
        <span className="text-xs text-muted-foreground">Focus:</span>
        <button
          type="button"
          onClick={() => setEventId("")}
          aria-pressed={eventId === ""}
          className={cn(
            "rounded-full border px-2.5 py-1 text-xs transition-all",
            eventId === ""
              ? "border-foreground bg-foreground font-medium text-background"
              : "text-muted-foreground hover:border-foreground/40 hover:text-foreground",
          )}
        >
          All projects
        </button>
        {events.map((event) => (
          <button
            key={event.id}
            type="button"
            onClick={() => setEventId(event.id)}
            aria-pressed={eventId === event.id}
            className={cn(
              "max-w-48 truncate rounded-full border px-2.5 py-1 text-xs transition-all",
              eventId === event.id
                ? "border-foreground bg-foreground font-medium text-background"
                : "text-muted-foreground hover:border-foreground/40 hover:text-foreground",
            )}
          >
            {event.name}
          </button>
        ))}
      </div>

      {/* thread */}
      <div className="flex flex-1 flex-col gap-6 pb-6">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center gap-6 py-16 text-center">
            <span className="flex size-12 items-center justify-center rounded-full border bg-card elev">
              <Sparkles className="size-5" />
            </span>
            <div className="flex flex-col gap-1">
              <p className="text-lg font-semibold">
                Ask anything about your projects
              </p>
              <p className="max-w-md text-sm text-muted-foreground">
                Predictions, risks, workload, bottlenecks, budget burn, ticket
                pace — grounded in the live data you have access to.
              </p>
            </div>
            <div className="grid w-full max-w-xl gap-2 sm:grid-cols-2">
              {SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => void send(suggestion)}
                  className="rounded-md border bg-card px-3 py-2.5 text-left text-xs text-muted-foreground elev-hover hover:text-foreground"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((message, index) => (
            <div key={index} className="flex gap-3">
              {message.role === "assistant" ? (
                <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border bg-card">
                  <Sparkles className="size-3.5" />
                </span>
              ) : (
                <UserAvatar name={userName} className="mt-0.5 size-7 text-[10px]" />
              )}
              <div className="min-w-0 flex-1 pt-1">
                {message.role === "assistant" ? (
                  message.content ? (
                    <>
                      <Markdown text={message.content} />
                      {/* offered once the answer is complete — saving a
                          half-streamed answer would store a truncated page */}
                      {streaming && index === messages.length - 1 ? null : (
                        <SaveToPage
                          markdown={message.content}
                          conversationId={conversationRef.current}
                        />
                      )}
                    </>
                  ) : (
                    <span className="inline-block animate-pulse text-sm text-muted-foreground">
                      Thinking…
                    </span>
                  )
                ) : (
                  <div className="flex flex-col gap-1.5">
                    {message.files?.length ? (
                      <div className="flex flex-wrap gap-1.5">
                        {message.files.map((name) => (
                          <span
                            key={name}
                            className="flex items-center gap-1.5 rounded-full border bg-background/60 px-2.5 py-1 text-[11px]"
                          >
                            <Paperclip className="size-3 text-muted-foreground" />
                            <span className="max-w-48 truncate">{name}</span>
                          </span>
                        ))}
                      </div>
                    ) : null}
                    {message.content ? (
                      <p className="whitespace-pre-wrap text-sm font-medium">
                        {message.content}
                      </p>
                    ) : null}
                  </div>
                )}
              </div>
            </div>
          ))
        )}
        <div ref={endRef} />
      </div>

      {/* composer */}
      <div className="sticky bottom-4 rounded-xl border bg-card p-2 elev">
        {pending.length > 0 ? (
          <div className="flex flex-wrap gap-1.5 px-1 pb-1.5">
            {pending.map((file, i) => (
              <span
                key={`${file.name}-${i}`}
                className="flex items-center gap-1.5 rounded-full border bg-muted/40 py-1 pl-2.5 pr-1.5 text-xs"
              >
                <Paperclip className="size-3 text-muted-foreground" />
                <span className="max-w-40 truncate">{file.name}</span>
                <button
                  type="button"
                  aria-label={`Remove ${file.name}`}
                  onClick={() =>
                    setPending((prev) => prev.filter((_, j) => j !== i))
                  }
                  className="text-muted-foreground transition-colors hover:text-destructive"
                >
                  <X className="size-3" />
                </button>
              </span>
            ))}
          </div>
        ) : null}
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send(input);
            }
          }}
          rows={2}
          placeholder="Tanya soal project, risiko, workload… (Enter untuk kirim)"
          className="max-h-40 w-full resize-none bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-muted-foreground/60"
        />
        <div className="flex items-center justify-between px-1 pb-0.5">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={ACCEPTED}
            className="hidden"
            onChange={(e) => {
              const chosen = Array.from(e.target.files ?? []);
              setPending((prev) => [...prev, ...chosen].slice(0, MAX_ATTACHMENTS));
              // reset so picking the same file twice still fires onChange
              e.target.value = "";
            }}
          />
          <span className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={streaming || pending.length >= MAX_ATTACHMENTS}
              title={
                pending.length >= MAX_ATTACHMENTS
                  ? `Up to ${MAX_ATTACHMENTS} files per message`
                  : "Attach a file — PDF, Word, Excel, CSV, text or image"
              }
              aria-label="Attach a file"
              className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground disabled:opacity-40"
            >
              <Paperclip className="size-4" />
            </button>
          <span className="text-[10px] text-muted-foreground">
            {eventId
              ? `Fokus: ${events.find((e) => e.id === eventId)?.name ?? ""}`
              : "Semua project dalam scope Anda"}
          </span>
          </span>
          {streaming ? (
            <button
              type="button"
              onClick={stop}
              aria-label="Stop"
              className="flex size-8 items-center justify-center rounded-lg border text-muted-foreground hover:text-foreground"
            >
              <Square className="size-3.5" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void send(input)}
              disabled={!input.trim() && pending.length === 0}
              aria-label="Send"
              className={cn(
                "flex size-8 items-center justify-center rounded-lg transition-colors",
                input.trim() || pending.length > 0
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground",
              )}
            >
              <ArrowUp className="size-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
