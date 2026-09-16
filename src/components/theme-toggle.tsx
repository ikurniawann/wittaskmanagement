"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Icon visibility is pure CSS (`dark:` variant), so server and client markup
// match and there is no hydration flash. `row` renders it as a workspace-menu
// line (WIT UI style, 2026-09-16); the default stays a round icon button.
export function ThemeToggle({
  variant = "icon",
  className,
}: {
  variant?: "icon" | "row";
  className?: string;
}) {
  const { resolvedTheme, setTheme } = useTheme();
  const flip = () => setTheme(resolvedTheme === "dark" ? "light" : "dark");

  if (variant === "row") {
    return (
      <button type="button" onClick={flip} className={cn(className)}>
        <Sun className="hidden dark:block" />
        <Moon className="dark:hidden" />
        <span className="dark:hidden">Dark mode</span>
        <span className="hidden dark:inline">Light mode</span>
      </button>
    );
  }

  return (
    <Button variant="ghost" size="icon" onClick={flip} aria-label="Toggle theme" className={className}>
      <Sun className="hidden size-4 dark:block" />
      <Moon className="size-4 dark:hidden" />
    </Button>
  );
}
