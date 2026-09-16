"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

// A file-manager context menu (EPIC-017 T-176).
//
// Right-click alone would strand two groups of people: anyone on a tablet or
// phone, where the gesture does not exist, and anyone navigating by keyboard.
// So the same menu opens from a "⋮" button on every row — which is exactly
// what Drive and Dropbox do, and for the same reason.

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  /** renders in the destructive colour and sits under a divider */
  danger?: boolean;
  disabled?: boolean;
}

export interface MenuPosition {
  x: number;
  y: number;
}

export function ContextMenu({
  position,
  items,
  onClose,
}: {
  position: MenuPosition | null;
  items: MenuItem[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!position) return;
    const away = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    // capture phase: a click anywhere closes the menu before it reaches
    // whatever is underneath, so the first click never both closes and acts
    document.addEventListener("mousedown", away, true);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", away, true);
      document.removeEventListener("keydown", key);
    };
  }, [position, onClose]);

  useEffect(() => {
    if (position) ref.current?.focus();
  }, [position]);

  // No `mounted` guard is needed: `position` is null until someone opens the
  // menu, so this never renders during SSR and cannot mismatch on hydration.
  if (!position || typeof document === "undefined") return null;

  // keep the menu on screen when opened near an edge
  const width = 208;
  const height = items.length * 34 + 12;
  const x = Math.min(position.x, window.innerWidth - width - 8);
  const y = Math.min(position.y, window.innerHeight - height - 8);

  return createPortal(
    <div
      ref={ref}
      role="menu"
      tabIndex={-1}
      style={{ top: Math.max(8, y), left: Math.max(8, x), width }}
      className="fixed z-50 flex flex-col rounded-md border bg-popover p-1 shadow-lg outline-none"
    >
      {items.map((item, index) => (
        <button
          key={item.label}
          role="menuitem"
          type="button"
          disabled={item.disabled}
          onClick={() => {
            onClose();
            item.onSelect();
          }}
          className={cn(
            "flex items-center gap-2 rounded px-2.5 py-1.5 text-left text-sm transition-colors",
            "hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none",
            "disabled:pointer-events-none disabled:opacity-40",
            item.danger && "text-destructive hover:bg-destructive/10",
            item.danger && index > 0 && "mt-1 border-t border-border pt-2",
          )}
        >
          {item.icon}
          {item.label}
        </button>
      ))}
    </div>,
    document.body,
  );
}

/** Tracks which row was right-clicked and where the menu should appear. */
export function useContextMenu<T>() {
  const [state, setState] = useState<{ target: T; position: MenuPosition } | null>(
    null,
  );
  return {
    target: state?.target ?? null,
    position: state?.position ?? null,
    openAt: (event: { clientX: number; clientY: number; preventDefault: () => void }, target: T) => {
      event.preventDefault();
      setState({ target, position: { x: event.clientX, y: event.clientY } });
    },
    /** for the "⋮" button: anchor under the element that was clicked */
    openNear: (element: HTMLElement, target: T) => {
      const box = element.getBoundingClientRect();
      setState({ target, position: { x: box.right - 200, y: box.bottom + 4 } });
    },
    close: () => setState(null),
  };
}
