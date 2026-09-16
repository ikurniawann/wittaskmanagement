import { cn } from "@/lib/utils";

// Event badge (Owner request 2026-08-06): every cross-event list item shows
// which event it belongs to — a compact bordered chip with the ● accent dot.
export function EventChip({
  name,
  className,
}: {
  name: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        // min-w-0 on both levels is load-bearing: as a flex item the chip
        // defaults to min-width:auto, which made a long event name force its
        // whole row wider than a phone viewport (T-103 responsive audit).
        "inline-flex min-w-0 max-w-48 items-center gap-1.5 rounded-full border bg-surface-2 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-foreground/80",
        className,
      )}
    >
      <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-foreground/50" />
      <span className="min-w-0 truncate">{name}</span>
    </span>
  );
}
