"use client";

import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { useHeaderSlot } from "@/lib/ui/header-slot";
import { cn } from "@/lib/utils";

// Page title + description (+ optional meta on the right and action
// controls). On md+ it lives in the shell's header row, level with the
// primary action and the bell; on phones it sits at the top of the page.
export function PageHeader({
  title,
  description,
  meta,
  children,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  /** small muted text on the right (a date, a count) */
  meta?: ReactNode;
  /** controls that belong to the page (view toggles, filters) */
  children?: ReactNode;
  className?: string;
}) {
  const slot = useHeaderSlot();
  const block = (
    <div className={cn("flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-2", className)}>
      <div className="min-w-0">
        <h1 className="truncate text-2xl font-bold leading-tight tracking-tight">
          {title}
          <span className="text-accent">.</span>
        </h1>
        {description ? (
          <p className="mt-0.5 truncate text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {meta || children ? (
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          {children}
          {meta ? <span className="text-xs text-muted-foreground">{meta}</span> : null}
        </div>
      ) : null}
    </div>
  );

  // before the slot mounts (and on the server) the inline copy is the only
  // one, so the title never flashes away on desktop
  return (
    <>
      {slot ? createPortal(<div className="hidden min-w-0 md:block">{block}</div>, slot) : null}
      <div className={cn("mb-4", slot && "md:hidden")}>{block}</div>
    </>
  );
}
