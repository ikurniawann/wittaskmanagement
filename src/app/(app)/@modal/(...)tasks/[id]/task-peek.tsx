"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

// Opening a task from a list takes the whole screen (Owner 2026-08-31). Still
// an intercepted route: the URL is the real /tasks/[id], Back returns to the
// list behind it, a refresh loads the standalone page.
export function TaskPeek({ children }: { children: ReactNode }) {
  const router = useRouter();

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (open) return;
        // Two different things close this dialog, and only one of them
        // should move history:
        //   - Esc / the X / a backdrop press: the URL is still /tasks/…, so
        //     go back one step to whatever list opened it.
        //   - the browser's own Back button: Next has ALREADY popped the
        //     route (the URL is the list again) and is unmounting us, and
        //     this callback fires as part of that. Calling back() here too
        //     went one step further than the user asked — past the list and
        //     onto the board they were on before it (Owner bug report).
        // The URL tells the two apart.
        if (window.location.pathname.startsWith("/tasks/")) router.back();
      }}
    >
      <DialogContent
        // The base centres itself with a translate and caps at sm:max-w-sm;
        // each has to be undone with ! or the utilities below lose to it.
        className="!inset-0 !top-0 !left-0 !max-w-none !translate-x-0 !translate-y-0 flex h-svh w-screen flex-col gap-0 rounded-none bg-background p-0 ring-0"
      >
        <DialogTitle className="sr-only">Task detail</DialogTitle>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-5xl px-6 py-10 sm:px-8">
            {children}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
