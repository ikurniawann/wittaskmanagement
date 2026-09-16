"use client";

import { Menu, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { BrandHead, RailItem, RailProjectLink, type RailProject } from "@/components/rail";
import { type NavItem } from "@/components/nav-link";
import { isFullscreenRoute } from "@/components/app-frame";
import { cn } from "@/lib/utils";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

// The full navigation as a dark drawer (WIT UI style, 2026-09-16). Opened from
// the phone bottom bar's Menu slot, from the header on fullscreen routes
// (where the rail is hidden), and it reuses the rail's own tiles so the two
// never drift apart.
export function MobileNav({
  items,
  projects,
  orgShortName,
  productName,
  tagline,
  variant = "header",
  footer,
}: {
  items: NavItem[];
  projects: RailProject[];
  orgShortName: string;
  productName: string;
  tagline: string;
  /** `header` = round white icon button (shown < md, and on fullscreen routes); `bar` = bottom-bar slot */
  variant?: "header" | "bar";
  /** rendered at the foot of the drawer (profile row, sign out) */
  footer?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const fullscreen = isFullscreenRoute(pathname);
  const close = () => setOpen(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          variant === "bar" ? (
            <button
              type="button"
              aria-label="Menu"
              className="flex size-11 items-center justify-center rounded-[12px] text-on-ink-muted transition-colors hover:bg-white/10 hover:text-white"
            >
              <Menu className="size-5" />
            </button>
          ) : (
            <button
              type="button"
              aria-label="Menu"
              className={cn(
                "flex size-11 items-center justify-center rounded-full bg-card text-foreground shadow-card active:scale-95",
                !fullscreen && "md:hidden",
              )}
            >
              <Menu className="size-5" />
            </button>
          )
        }
      />
      <SheetContent
        side="left"
        showCloseButton={false}
        className="w-72 rounded-r-[18px] border-0 bg-ink p-0 text-on-ink"
      >
        <div className="flex h-14 shrink-0 items-center justify-between px-4">
          <SheetTitle className="min-w-0" title={`${orgShortName} ${productName}`}>
            <BrandHead product={productName} tagline={tagline} />
          </SheetTitle>
          <button
            type="button"
            aria-label="Close menu"
            onClick={close}
            className="flex size-9 items-center justify-center rounded-[10px] text-on-ink-muted hover:bg-white/10 hover:text-white"
          >
            <X className="size-4" />
          </button>
        </div>
        {/* min-h-0 so the list owns the scrolling inside the fixed-height panel */}
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <nav className="flex flex-col gap-1">
            {items.map((item) => (
              <RailItem key={item.href} item={item} expanded onNavigate={close} />
            ))}
          </nav>
          {projects.length > 0 ? (
            <div className="flex flex-col gap-1">
              <span className="px-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-on-ink-muted">
                Projects
              </span>
              {projects.map((p) => (
                <RailProjectLink key={p.id} project={p} onNavigate={close} />
              ))}
            </div>
          ) : null}
          {footer ? <div className="mt-auto flex flex-col gap-1 border-t border-white/10 pt-3">{footer}</div> : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
