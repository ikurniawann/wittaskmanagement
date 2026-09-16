import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// Standard empty state: an invitation, not an apology — round icon tile, one
// line of hint, one clear action (WIT UI style, 2026-09-16: no dashed box).
export function EmptyState({
  icon: Icon,
  title,
  hint,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  hint?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-card bg-card px-6 py-12 text-center shadow-card",
        className,
      )}
    >
      <span className="flex size-12 items-center justify-center rounded-full bg-surface text-muted-foreground [&_svg]:size-6">
        <Icon />
      </span>
      <p className="text-sm font-semibold">{title}</p>
      {hint ? <p className="max-w-xs text-sm text-muted-foreground">{hint}</p> : null}
      {action ? <div className="pt-2">{action}</div> : null}
    </div>
  );
}
