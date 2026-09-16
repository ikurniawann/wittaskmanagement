"use client";

import { Plus } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { ICONS, type NavItem } from "@/components/nav-link";
import { cn } from "@/lib/utils";

// Phone navigation of the WIT UI style (2026-09-16): a floating ink bar with
// four destinations, the round accent create button in the middle, and a
// Menu slot that opens the full drawer. The rail is hidden below `md`.
export function BottomBar({
  items,
  createHref,
  createLabel,
  menu,
}: {
  /** at most four */
  items: NavItem[];
  createHref?: string;
  createLabel?: string;
  /** optional last slot (a drawer trigger); the header burger covers phones already */
  menu?: ReactNode;
}) {
  const pathname = usePathname();
  const [a, b, c, d] = items;
  const slot = (item?: NavItem) => {
    if (!item) return <span className="size-11" />;
    const Icon = ICONS[item.icon];
    const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
    return (
      <Link
        key={item.href}
        href={item.href}
        aria-label={item.label}
        data-active={active}
        className="relative flex size-11 items-center justify-center rounded-[12px] text-on-ink-muted transition-colors data-[active=true]:bg-accent data-[active=true]:text-white data-[active=true]:shadow-glow [&_svg]:size-5"
      >
        <Icon strokeWidth={active ? 2.4 : 2} />
        {item.badge && item.badge > 0 ? (
          <span className="absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-white px-1 text-[10px] font-bold text-ink ring-2 ring-ink">
            {item.badge > 99 ? "99+" : item.badge}
          </span>
        ) : null}
      </Link>
    );
  };

  return (
    <nav
      aria-label="Primary"
      className={cn(
        "fixed inset-x-3 z-40 flex h-[68px] items-center justify-between rounded-[18px] bg-ink px-3 text-on-ink shadow-float md:hidden print:hidden",
        "bottom-[max(0.75rem,env(safe-area-inset-bottom))]",
      )}
    >
      {slot(a)}
      {slot(b)}
      {createHref ? (
        <Link
          href={createHref}
          aria-label={createLabel ?? "Create"}
          className="flex size-12 items-center justify-center rounded-full bg-accent text-white shadow-glow active:scale-95"
        >
          <Plus className="size-6" />
        </Link>
      ) : (
        <span className="size-12" />
      )}
      {slot(c)}
      {slot(d)}
      {menu ?? null}
    </nav>
  );
}
