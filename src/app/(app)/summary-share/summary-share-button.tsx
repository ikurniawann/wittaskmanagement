"use client";

import { Share2 } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { SummaryShareDialog } from "./summary-share-dialog";

/** Opens the read-only progress link dialog. Client-only so the server pages
 *  that host it stay server components. */
export function SummaryShareButton({
  kind,
  targetId,
  targetName,
  className,
  label = "Share progress",
}: {
  kind: "project" | "task";
  targetId: string;
  targetName: string;
  className?: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline",
          className,
        )}
      >
        <Share2 className="size-3.5" /> {label}
      </button>
      {open ? (
        <SummaryShareDialog
          kind={kind}
          targetId={targetId}
          targetName={targetName}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}
