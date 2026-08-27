import { Eye } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * How often a task's read-only progress link has been opened from outside.
 *
 * Absent entirely when the task was never shared — an explicit "0 opens" on
 * every untouched row would be noise, and the useful signal is "this one is
 * being watched". A withdrawn or expired link keeps its count but reads
 * dimmed, because the views happened even though the door is now shut.
 */
export function ShareOpensBadge({
  opens,
  live,
  className,
}: {
  opens: number;
  live: boolean;
  className?: string;
}) {
  return (
    <span
      title={
        live
          ? `Shared link opened ${opens} time${opens === 1 ? "" : "s"}`
          : `Shared link opened ${opens} time${opens === 1 ? "" : "s"} — the link is no longer active`
      }
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 text-[10px] tabular-nums",
        live ? "text-foreground" : "border-dashed text-muted-foreground",
        className,
      )}
    >
      <Eye className="size-3" />
      {opens}
    </span>
  );
}
