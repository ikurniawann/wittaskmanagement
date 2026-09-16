"use client";

import { usePathname } from "next/navigation";
import { useSyncExternalStore, type ReactNode } from "react";
import { getPlayActive, subscribePlayActive } from "@/lib/play/active-store";
import { cn } from "@/lib/utils";

// Route-aware shell frame. The WIT UI style canvas (2026-09-16): a soft grey
// page with 12–16px padding, the floating rail on the left, header + a main
// that scrolls on its own, and a faint accent glow top-right as the only
// decorative light. A few screens get a fullscreen canvas — the rail hides
// and the content well widens; navigation stays reachable via the drawer.
const FULLSCREEN_ROUTES = [/^\/assistant/, /^\/events\/[^/]+\/dataroom/, /^\/play/];

// Routes whose content IS the viewport (a WebGL canvas): no content padding
// and no entrance animation (EPIC-024 T-240).
const BARE_ROUTES = [/^\/play/];
export function isBareRoute(pathname: string): boolean {
  return BARE_ROUTES.some((route) => route.test(pathname));
}

/** The ONE answer to "does this route hide the rail?". */
export function isFullscreenRoute(pathname: string): boolean {
  return FULLSCREEN_ROUTES.some((route) => route.test(pathname));
}

export function AppFrame({
  sidebar,
  header,
  bottomBar,
  children,
}: {
  sidebar: ReactNode;
  header: ReactNode;
  bottomBar: ReactNode;
  children: ReactNode;
}) {
  const pathname = usePathname();
  // while the Play canvas is mounted (even under the task peek modal) the frame
  // keeps the canvas layout — see src/lib/play/active-store.ts
  const playActive = useSyncExternalStore(subscribePlayActive, getPlayActive, () => false);
  const fullscreen = isFullscreenRoute(pathname) || playActive;
  const bare = isBareRoute(pathname) || playActive;

  return (
    <div className="relative flex h-dvh gap-3 overflow-hidden bg-surface p-3 lg:gap-4 lg:p-4 print:h-auto print:overflow-visible print:bg-white print:p-0">
      <div
        aria-hidden
        className="ambient-glow pointer-events-none absolute -right-[8%] -top-[30%] h-[120%] w-[70%] opacity-70 blur-xl print:hidden"
      />
      {fullscreen ? null : <div className="hidden shrink-0 md:block print:hidden">{sidebar}</div>}
      <div className="relative flex min-w-0 flex-1 flex-col gap-3">
        {header}
        <main
          className={cn(
            "min-h-0 w-full flex-1",
            bare
              ? "flex flex-col overflow-hidden rounded-[28px]"
              : "overflow-y-auto overscroll-contain pb-24 pr-0.5 md:pb-2 print:overflow-visible",
          )}
        >
          {/* keyed on the route so the entrance replays on navigation */}
          <div
            key={pathname}
            className={cn(
              bare
                ? "flex min-h-0 flex-1 flex-col"
                : cn("rise-in mx-auto w-full p-1", fullscreen ? "max-w-none" : "max-w-[1400px]"),
            )}
          >
            {children}
          </div>
        </main>
      </div>
      {bare ? null : bottomBar}
    </div>
  );
}
