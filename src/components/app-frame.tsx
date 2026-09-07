"use client";

import { usePathname } from "next/navigation";
import { useSyncExternalStore, type ReactNode } from "react";
import { getPlayActive, subscribePlayActive } from "@/lib/play/active-store";
import { cn } from "@/lib/utils";

// Route-aware shell frame (Owner 2026-08-07): a few screens get a fullscreen
// canvas — the main sidebar hides and the content well widens. Navigation
// stays reachable via the hamburger sheet (see MobileNav, which shows itself
// on desktop for fullscreen routes).
//
// The dataroom joined them (Owner 2026-08-11): a file manager competes with
// the sidebar for the same left column, and two nested trees side by side is
// exactly what makes people lose their place.
const FULLSCREEN_ROUTES = [/^\/assistant/, /^\/events\/[^/]+\/dataroom/, /^\/play/];

// Routes whose content IS the viewport (a WebGL canvas): no content padding
// and no entrance animation, otherwise the canvas gets a 24px frame and a
// fade on every navigation (EPIC-024 T-240).
const BARE_ROUTES = [/^\/play/];
export function isBareRoute(pathname: string): boolean {
  return BARE_ROUTES.some((route) => route.test(pathname));
}

/**
 * The ONE answer to "does this route hide the main sidebar?". MobileNav used
 * to keep its own hardcoded copy and, exactly as such copies do, it drifted:
 * the dataroom went fullscreen here and the burger never appeared there.
 */
export function isFullscreenRoute(pathname: string): boolean {
  return FULLSCREEN_ROUTES.some((route) => route.test(pathname));
}
export function AppFrame({
  sidebar,
  header,
  children,
}: {
  sidebar: ReactNode;
  header: ReactNode;
  children: ReactNode;
}) {
  const pathname = usePathname();
  // while the Play canvas is mounted (even under the task peek modal) the frame
  // keeps the canvas layout — see src/lib/play/active-store.ts
  const playActive = useSyncExternalStore(subscribePlayActive, getPlayActive, () => false);
  const fullscreen = isFullscreenRoute(pathname) || playActive;
  const bare = isBareRoute(pathname) || playActive;

  return (
    <div className="flex min-h-svh">
      {fullscreen ? null : sidebar}
      <div className="flex min-w-0 flex-1 flex-col">
        {header}
        <main
          className={cn(
            "w-full flex-1",
            bare ? "flex flex-col" : "px-4 py-6 sm:px-6",
            fullscreen ? "mx-auto max-w-none" : "mx-auto max-w-[1400px]",
          )}
        >
          {/* keyed on the route so the entrance replays on navigation: <main>
              itself survives a client-side transition, so without this the
              animation would only ever run on a full page load */}
          <div key={pathname} className={bare ? "flex min-h-0 flex-1 flex-col" : "rise-in"}>
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
