import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// Stat card of the WIT UI style (2026-09-16): label / big value / hint on
// the left, a soft-tinted square icon tile top-right. Tones are tints — the
// solid ink tile is reserved for the one primary stat on a screen.
export type StatTone = "default" | "danger" | "success" | "warning" | "info" | "ink";

const TILE: Record<StatTone, string> = {
  default: "bg-surface text-body",
  danger: "bg-accent-soft text-accent",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  info: "bg-info-soft text-info",
  ink: "bg-ink text-on-ink",
};

export function StatCard({
  label,
  value,
  unit,
  hint,
  icon: Icon,
  tone = "default",
  className,
}: {
  label: string;
  value: ReactNode;
  /** muted, top-aligned beside the number */
  unit?: string;
  hint?: ReactNode;
  icon: LucideIcon;
  tone?: StatTone;
  className?: string;
}) {
  return (
    <div className={cn("flex items-start gap-3 rounded-card bg-card p-5 shadow-card", className)}>
      <div className="min-w-0 flex-1">
        <p className="text-[0.8125rem] font-semibold text-body/80">{label}</p>
        <p className="mt-1.5 flex items-start gap-1 truncate text-[1.75rem] font-extrabold leading-[1.15] tracking-[-0.5px] tabular-nums">
          {value}
          {unit ? <span className="pt-1.5 text-sm font-semibold text-muted-foreground">{unit}</span> : null}
        </p>
        {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
      </div>
      <div
        className={cn(
          "flex size-[2.625rem] shrink-0 items-center justify-center rounded-[0.8125rem] [&_svg]:size-[1.125rem]",
          TILE[tone],
        )}
      >
        <Icon />
      </div>
    </div>
  );
}

/** 2–4 equal cells flush with the card edge; place last inside a p-5 card. */
export function SplitStats({
  cells,
  className,
}: {
  cells: Array<{ label: string; value: ReactNode }>;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "-mx-5 -mb-5 mt-auto grid divide-x divide-border border-t border-border",
        cells.length === 2 && "grid-cols-2",
        cells.length === 3 && "grid-cols-3",
        cells.length >= 4 && "grid-cols-4",
        className,
      )}
    >
      {cells.map((c) => (
        <div key={c.label} className="px-2 py-3 text-center">
          <span className="block text-[0.66rem] font-medium text-muted-foreground">{c.label}</span>
          <span className="block text-[0.9375rem] font-extrabold tabular-nums">{c.value}</span>
        </div>
      ))}
    </div>
  );
}

/** Card header with a title, an optional count badge and a right-side action. */
export function CardTitleRow({
  icon: Icon,
  title,
  count,
  action,
}: {
  icon?: LucideIcon;
  title: string;
  count?: number;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="flex items-center gap-2 text-base font-semibold leading-tight">
        {Icon ? <Icon className="size-4 text-muted-foreground" /> : null}
        {title}
        {count !== undefined ? (
          <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-surface px-1.5 text-[10px] font-bold tabular-nums text-body">
            {count}
          </span>
        ) : null}
      </h2>
      {action}
    </div>
  );
}
