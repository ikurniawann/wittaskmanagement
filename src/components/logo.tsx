import Link from "next/link";
import { cn } from "@/lib/utils";

// Wordmark with the accent period (WIT UI style, 2026-09-16), no icon. Both halves come
// from the installation's branding settings (src/lib/org/branding.ts) so the
// app carries the installing organisation's name, not ours.
export function Logo({
  short,
  product,
  className,
}: {
  short: string;
  product: string;
  className?: string;
}) {
  return (
    <Link
      href="/"
      className={cn("select-none font-bold leading-none tracking-tight", className)}
    >
      {short}
      <span className="text-accent">.</span>
      <span className="font-medium text-muted-foreground"> {product}</span>
    </Link>
  );
}
