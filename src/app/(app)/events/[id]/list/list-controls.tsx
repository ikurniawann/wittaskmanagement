"use client";

import { ChevronDown, ListFilter, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { PriorityIcon } from "@/components/task-meta";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// Plane-style toolbar (Owner feedback): filters & display live behind compact
// popover buttons instead of rows of exposed pills. Selection still navigates
// via URL params (server-rendered filtering).

interface Params {
  sort: string;
  dir: string;
  division?: string;
  priority?: string;
}

function Popover({
  label,
  icon,
  activeCount,
  children,
}: {
  label: string;
  icon: ReactNode;
  activeCount?: number;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="gap-1.5"
      >
        {icon}
        {label}
        {activeCount ? (
          <span className="flex size-4 items-center justify-center rounded-full bg-foreground text-[9px] font-semibold text-background">
            {activeCount}
          </span>
        ) : null}
        <ChevronDown
          className={cn("size-3 transition-transform", open && "rotate-180")}
        />
      </Button>
      {open ? (
        <div
          className="absolute left-0 top-9 z-50 w-72 max-w-[calc(100vw-2rem)] rounded-lg border bg-popover p-3 shadow-lg"
          onClick={(e) => {
            if ((e.target as HTMLElement).closest("a")) setOpen(false);
          }}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}

function OptionPill({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-all duration-150",
        active
          ? "border-foreground bg-foreground font-medium text-background"
          : "text-muted-foreground hover:border-foreground/40 hover:text-foreground",
      )}
    >
      {children}
    </Link>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 py-2 first:pt-0 last:pb-0">
      <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
        {title}
      </span>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

export function ListControls({
  basePath,
  params,
  divisions,
  savedViews,
  saveAction,
  deleteAction,
}: {
  basePath: string;
  params: Params;
  divisions: Array<{ id: string; name: string }>;
  savedViews: Array<{ id: string; name: string; href: string }>;
  saveAction: (formData: FormData) => Promise<void>;
  deleteAction: (formData: FormData) => Promise<void>;
}) {
  const query = (patch: Partial<Params>) => {
    const merged = { ...params, ...patch };
    const q = new URLSearchParams();
    if (merged.sort && merged.sort !== "due") q.set("sort", merged.sort);
    if (merged.dir && merged.dir !== "asc") q.set("dir", merged.dir);
    if (merged.division) q.set("division", merged.division);
    if (merged.priority) q.set("priority", merged.priority);
    const s = q.toString();
    return `${basePath}${s ? `?${s}` : ""}`;
  };

  const filterCount = (params.division ? 1 : 0) + (params.priority ? 1 : 0);
  const divisionName = divisions.find((d) => d.id === params.division)?.name;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Popover
        label="Filters"
        icon={<ListFilter className="size-3.5" />}
        activeCount={filterCount}
      >
        <Section title="Division">
          <OptionPill href={query({ division: undefined })} active={!params.division}>
            All
          </OptionPill>
          {divisions.map((d) => (
            <OptionPill
              key={d.id}
              href={query({ division: d.id })}
              active={params.division === d.id}
            >
              {d.name}
            </OptionPill>
          ))}
        </Section>
        <Section title="Priority">
          <OptionPill href={query({ priority: undefined })} active={!params.priority}>
            All
          </OptionPill>
          {(["urgent", "high", "medium", "low"] as const).map((p) => (
            <OptionPill
              key={p}
              href={query({ priority: p })}
              active={params.priority === p}
            >
              <PriorityIcon priority={p} />
              {p}
            </OptionPill>
          ))}
        </Section>
        <Section title="Saved views">
          {savedViews.map((view) => (
            <span key={view.id} className="flex items-center gap-1">
              <OptionPill href={view.href} active={false}>
                {view.name}
              </OptionPill>
              <form action={deleteAction}>
                <input type="hidden" name="filterId" value={view.id} />
                <button
                  type="submit"
                  aria-label={`Delete view ${view.name}`}
                  className="text-xs text-muted-foreground hover:text-destructive"
                >
                  ×
                </button>
              </form>
            </span>
          ))}
          <form action={saveAction} className="mt-1 flex w-full items-center gap-2">
            <input type="hidden" name="division" value={params.division ?? ""} />
            <input type="hidden" name="priority" value={params.priority ?? ""} />
            <Input
              name="name"
              placeholder="Save current view as…"
              className="h-8 flex-1 text-xs"
            />
            <Button type="submit" size="sm" variant="outline">
              Save
            </Button>
          </form>
        </Section>
      </Popover>

      <Popover label="Display" icon={<SlidersHorizontal className="size-3.5" />}>
        <Section title="Sort by">
          {[
            { key: "due", label: "Due date" },
            { key: "priority", label: "Priority" },
            { key: "title", label: "Title" },
            { key: "created", label: "Created" },
          ].map((s) => (
            <OptionPill
              key={s.key}
              href={query({ sort: s.key })}
              active={params.sort === s.key}
            >
              {s.label}
            </OptionPill>
          ))}
        </Section>
        <Section title="Direction">
          <OptionPill href={query({ dir: "asc" })} active={params.dir === "asc"}>
            ↑ Ascending
          </OptionPill>
          <OptionPill href={query({ dir: "desc" })} active={params.dir === "desc"}>
            ↓ Descending
          </OptionPill>
        </Section>
      </Popover>

      {/* active filter summary chips */}
      {divisionName ? (
        <Link
          href={query({ division: undefined })}
          className="inline-flex items-center gap-1 rounded-full border bg-accent/50 px-2.5 py-1 text-xs hover:border-foreground/40"
          title="Clear division filter"
        >
          {divisionName} <span className="text-muted-foreground">×</span>
        </Link>
      ) : null}
      {params.priority ? (
        <Link
          href={query({ priority: undefined })}
          className="inline-flex items-center gap-1 rounded-full border bg-accent/50 px-2.5 py-1 text-xs capitalize hover:border-foreground/40"
          title="Clear priority filter"
        >
          <PriorityIcon priority={params.priority as "low" | "medium" | "high" | "urgent"} />
          {params.priority} <span className="text-muted-foreground">×</span>
        </Link>
      ) : null}
    </div>
  );
}
