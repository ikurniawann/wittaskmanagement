"use client";

import { Bell } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface NotificationItem {
  id: string;
  title: string;
  href: string;
  readAt: string | null;
  createdAt: string;
}

// Live bell (T-037): EventSource to /api/notifications/stream.
export function NotificationsBell() {
  const [unread, setUnread] = useState(0);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const source = new EventSource("/api/notifications/stream");
    source.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as {
          unread: number;
          items: NotificationItem[];
        };
        setUnread(data.unread);
        setItems(data.items);
      } catch {
        // ignore malformed frames
      }
    };
    return () => source.close();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && unread > 0) {
      await fetch("/api/notifications/read", { method: "POST" });
      setUnread(0);
    }
  };

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        aria-label={`Notifications${unread > 0 ? ` (${unread} unread)` : ""}`}
        onClick={toggle}
        className="relative flex size-11 items-center justify-center rounded-full bg-card text-foreground shadow-card transition-colors hover:bg-surface-2 active:scale-95"
      >
        <Bell className="size-5" />
        {unread > 0 ? (
          <span className="absolute -right-1 -top-1 flex h-[19px] min-w-[19px] items-center justify-center rounded-full border-2 border-surface bg-accent px-1 text-[10.5px] font-bold text-white">
            {unread > 99 ? "99+" : unread}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute right-0 top-13 z-50 w-80 max-w-[calc(100vw-2rem)] rounded-card bg-card p-2 shadow-float animate-in fade-in-0 zoom-in-95">
          {items.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-muted-foreground">
              No notifications yet.
            </p>
          ) : (
            <ul className="flex max-h-96 flex-col overflow-y-auto">
              {items.map((item) => (
                <li key={item.id}>
                  <Link
                    href={item.href || "#"}
                    onClick={() => setOpen(false)}
                    className={cn(
                      "block rounded-xl px-3 py-2 text-xs hover:bg-surface-2",
                      item.readAt ? "text-muted-foreground" : "font-medium",
                    )}
                  >
                    {item.title}
                    <span className="mt-0.5 block text-[10px] text-muted-foreground">
                      {new Date(item.createdAt).toLocaleString("en-GB", {
                        timeZone: "Asia/Jakarta",
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
