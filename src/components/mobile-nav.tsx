"use client";

import { Menu } from "lucide-react";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { EventNavLink, NavLink, type NavItem } from "@/components/nav-link";
import { Button } from "@/components/ui/button";
import { isFullscreenRoute } from "@/components/app-frame";
import { cn } from "@/lib/utils";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

export function MobileNav({
  items,
  events,
  orgShortName,
  productName,
}: {
  items: NavItem[];
  events: Array<{
    id: string;
    name: string;
    health: "on_track" | "at_risk" | "critical";
    swatch: string;
  }>;
  orgShortName: string;
  productName: string;
}) {
  const [open, setOpen] = useState(false);
  // fullscreen routes hide the main sidebar (see AppFrame) — the hamburger
  // then serves desktop too, so navigation stays one click away
  const pathname = usePathname();
  const fullscreen = isFullscreenRoute(pathname);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className={cn(!fullscreen && "md:hidden")}
            aria-label="Menu"
          >
            <Menu className="size-4" />
          </Button>
        }
      />
      <SheetContent side="left" className="w-64 p-0">
        <SheetHeader className="shrink-0 border-b px-4 py-3">
          <SheetTitle className="text-left text-sm font-semibold uppercase tracking-[0.2em]">
            {orgShortName} <span className="text-muted-foreground">{productName}</span>
          </SheetTitle>
        </SheetHeader>
        {/* The panel is a fixed-height flex column (h-full), so this list has
            to own the scrolling: without min-h-0 a flex child refuses to
            shrink below its content and the overflow simply spills out of the
            panel — with the page behind it scroll-locked, the menu reads as
            frozen (Owner 2026-08-18). overscroll-contain stops a flick at the
            end of the list from scrolling the page underneath. */}
        <div
          className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
          onClick={(e) => {
            if ((e.target as HTMLElement).closest("a")) setOpen(false);
          }}
        >
          <nav className="flex flex-col gap-0.5">
            {items.map((item) => (
              <NavLink key={item.href} item={item} />
            ))}
          </nav>
          {events.length > 0 ? (
            <div className="flex flex-col gap-1">
              <span className="px-2.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                Projects
              </span>
              {events.map((event) => (
                <EventNavLink
                  key={event.id}
                  href={`/events/${event.id}`}
                  name={event.name}
                  health={event.health}
                  swatch={event.swatch}
                />
              ))}
            </div>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
