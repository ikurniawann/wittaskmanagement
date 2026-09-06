"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

// Opening a task from a list used to slide a sheet in from the right edge.
// It now takes the whole screen (Owner 2026-08-31) — a task carries a
// description, a checklist, assignees, dependencies and a comment thread, and
// half a viewport made every one of them a column two words wide.
//
// Still an intercepted route, so the URL is the real /tasks/[id] and Back
// returns to the list behind it. Only the shape of the container changed.
export function TaskPeek({ children }: { children: ReactNode }) {
  const router = useRouter();

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) router.back();
      }}
    >
      <DialogContent
        // The base centres itself with a translate and caps at sm:max-w-sm;
        // every one of those has to be undone with ! or the utilities below
        // lose to it. Dropping the translate also means no transformed
        // ancestor, so a position:fixed child resolves against the viewport
        // like it reads.
        className="!inset-0 !top-0 !left-0 !max-w-none !translate-x-0 !translate-y-0 flex h-svh w-screen flex-col gap-0 rounded-none bg-background p-0 ring-0"
      >
        <DialogTitle className="sr-only">Task detail</DialogTitle>
        {/* the page scrolls, not the dialog frame, and the text keeps a
            readable measure instead of stretching across a wide monitor */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-5xl px-6 py-10 sm:px-8">
            {children}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
