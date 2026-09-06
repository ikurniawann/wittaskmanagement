import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

// Where-am-I trail (Owner 2026-08-31: "jangan sampai user kehilangan arah").
//
// The last crumb is the page you are on and is not a link; everything before
// it is an ancestor you can climb to. Kept deliberately plain — the h1 below
// it carries the page's real name, so this only has to answer "inside what?".

export interface Crumb {
  label: string;
  /** omitted on the current page */
  href?: string;
}

export function Breadcrumb({ items, className }: { items: Crumb[]; className?: string }) {
  return (
    <nav
      aria-label="Breadcrumb"
      className={cn(
        "flex flex-wrap items-center gap-1 text-xs text-muted-foreground",
        className,
      )}
    >
      {items.map((item, i) => {
        const last = i === items.length - 1;
        return (
          <span key={`${item.label}-${i}`} className="flex min-w-0 items-center gap-1">
            {i > 0 ? <ChevronRight aria-hidden className="size-3 shrink-0" /> : null}
            {last || !item.href ? (
              <span
                aria-current={last ? "page" : undefined}
                className={cn("truncate", last && "font-medium text-foreground")}
              >
                {item.label}
              </span>
            ) : (
              <Link
                href={item.href}
                className="truncate underline-offset-4 transition-colors hover:text-foreground hover:underline"
              >
                {item.label}
              </Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}
