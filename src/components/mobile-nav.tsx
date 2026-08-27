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
        <SheetHeader className="border-b px-4 py-3">
          <SheetTitle className="text-left text-sm font-semibold uppercase tracking-[0.2em]">
            {orgShortName} <span className="text-muted-foreground">{productName}</span>
          </SheetTitle>
        </SheetHeader>
        <div
          className="flex flex-col gap-4 p-3"
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
