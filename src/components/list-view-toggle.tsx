"use client";

import { LayoutGrid, List } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";

// List | Grid, riding the URL like the Calendar/Gantt toggle beside it — so
// a reload, a bookmark and a shared link all keep the view, and no client
// storage is involved.
export function ListViewToggle({
  basePath,
  active,
}: {
  basePath: string;
  active: "list" | "grid";
}) {
  const params = useSearchParams();

  const href = (view: "list" | "grid") => {
    const next = new URLSearchParams(params.toString());
    if (view === "grid") next.set("view", "grid");
    else next.delete("view");
    const query = next.toString();
    return query ? `${basePath}?${query}` : basePath;
  };

  return (
    <div className="flex rounded-md border p-0.5">
      {(
        [
          { key: "list", icon: <List className="size-3.5" />, label: "List view" },
          { key: "grid", icon: <LayoutGrid className="size-3.5" />, label: "Grid view" },
        ] as const
      ).map((option) => (
        <Link
          key={option.key}
          href={href(option.key)}
          aria-label={option.label}
          title={option.label}
          className={cn(
            "flex size-9 items-center justify-center rounded transition-colors sm:size-7",
            active === option.key
              ? "bg-accent text-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {option.icon}
        </Link>
      ))}
    </div>
  );
}
