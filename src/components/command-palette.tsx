"use client";

import {
  CalendarRange,
  FileText,
  ListChecks,
  Search,
  UserRound,
} from "lucide-react";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

// ⌘K global search palette (T-102). Fetches /api/search (debounced); every
// result is already permission-scoped server-side.

interface Hit {
  id: string;
  title: string;
  subtitle: string;
  href: string;
}
interface Results {
  events: Hit[];
  tasks: Hit[];
  documents: Hit[];
  people: Hit[];
}

const EMPTY: Results = { events: [], tasks: [], documents: [], people: [] };

const GROUPS: Array<{
  key: keyof Results;
  label: string;
  icon: ReactNode;
}> = [
  { key: "events", label: "Projects", icon: <CalendarRange className="size-3.5" /> },
  { key: "tasks", label: "Tasks", icon: <ListChecks className="size-3.5" /> },
  { key: "documents", label: "Documents", icon: <FileText className="size-3.5" /> },
  { key: "people", label: "People", icon: <UserRound className="size-3.5" /> },
];

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Results>(EMPTY);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const trimmed = query.trim();
  // below the minimum length we show nothing without clearing state in an
  // effect — the visible set is derived, not stored
  const shown = trimmed.length < 2 ? EMPTY : results;

  // flatten in render order for arrow-key navigation
  const flat = useMemo(
    () =>
      GROUPS.flatMap((group) =>
        shown[group.key].map((hit) => ({ ...hit, group: group.key })),
      ),
    [shown],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const onOpenChange = useCallback((next: boolean) => {
    setOpen(next);
    if (!next) {
      setQuery("");
      setResults(EMPTY);
      setActive(0);
    }
  }, []);

  useEffect(() => {
    if (!open || trimmed.length < 2) return;
    const timer = setTimeout(async () => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setLoading(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(trimmed)}`, {
          signal: controller.signal,
        });
        if (res.ok) {
          setResults((await res.json()) as Results);
          setActive(0);
        }
      } catch {
        // aborted or offline — keep previous results
      } finally {
        setLoading(false);
      }
    }, 220);
    return () => clearTimeout(timer);
  }, [open, trimmed]);

  const go = useCallback(
    (hit: Hit) => {
      if (!hit.href) return;
      onOpenChange(false);
      router.push(hit.href);
    },
    [onOpenChange, router],
  );

  const onInputKey = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((a) => Math.min(a + 1, flat.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (event.key === "Enter" && flat[active]) {
      event.preventDefault();
      go(flat[active]);
    }
  };

  let index = -1;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-8 items-center gap-2 rounded-md border px-2.5 text-xs text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground"
        aria-label="Search (Ctrl+K)"
      >
        <Search className="size-3.5" />
        <span className="hidden sm:inline">Search</span>
        <kbd className="hidden rounded-sm border bg-muted px-1 font-mono text-[10px] sm:inline">
          ⌘K
        </kbd>
      </button>

      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="top-24 translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-xl">
          <DialogTitle className="sr-only">Global search</DialogTitle>
          <div className="flex items-center gap-2.5 border-b px-4">
            <Search className="size-4 shrink-0 text-muted-foreground" />
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={onInputKey}
              placeholder="Search tasks, projects, documents, people…"
              className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
            {loading ? (
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
                …
              </span>
            ) : null}
          </div>

          <div className="max-h-[55vh] overflow-y-auto p-2">
            {trimmed.length < 2 ? (
              <p className="px-3 py-8 text-center text-xs text-muted-foreground">
                Type at least two characters. Results only show what you can
                open.
              </p>
            ) : flat.length === 0 && !loading ? (
              <p className="px-3 py-8 text-center text-xs text-muted-foreground">
                Nothing matches &ldquo;{trimmed}&rdquo;.
              </p>
            ) : (
              GROUPS.map((group) => {
                const hits = shown[group.key];
                if (hits.length === 0) return null;
                return (
                  <div key={group.key} className="mb-1">
                    <div className="flex items-center gap-1.5 px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                      {group.icon}
                      {group.label}
                    </div>
                    {hits.map((hit) => {
                      index += 1;
                      const i = index;
                      const clickable = hit.href !== "";
                      return (
                        <button
                          key={hit.id}
                          type="button"
                          disabled={!clickable}
                          onClick={() => go(hit)}
                          onMouseMove={() => setActive(i)}
                          className={cn(
                            "flex w-full items-baseline gap-2 rounded-md px-3 py-2 text-left text-sm",
                            i === active && clickable
                              ? "bg-accent text-accent-foreground"
                              : "text-foreground",
                            !clickable && "cursor-default opacity-80",
                          )}
                        >
                          <span className="min-w-0 flex-1 truncate">
                            {hit.title}
                          </span>
                          <span className="max-w-[45%] truncate text-xs text-muted-foreground">
                            {hit.subtitle}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                );
              })
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
