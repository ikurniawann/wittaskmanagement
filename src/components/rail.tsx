"use client";

import {
  ChevronDown,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Plus,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { EVENT_SUBPAGES, ICONS, type NavItem } from "@/components/nav-link";
import {
  getRailExpanded,
  getServerRailExpanded,
  setRailExpanded,
  subscribeRail,
} from "@/lib/ui/rail-store";
import { cn } from "@/lib/utils";

// The floating dark rail of the WIT UI style (Owner 2026-09-16): wordmark,
// one round accent create button, the nav as 44px tiles (active = accent
// tile with glow), the projects group when expanded, a workspace card whose
// menu holds profile / settings / theme / sign out, and a labelled collapse
// pill. Collapsed it is a 76px icon rail (tablets); expanded 240px.

export interface RailProject {
  id: string;
  name: string;
  health: "on_track" | "at_risk" | "critical";
  swatch: string;
}

export function useRailExpanded() {
  return useSyncExternalStore(subscribeRail, getRailExpanded, getServerRailExpanded);
}

function isActivePath(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** One nav tile. `expanded` shows the label; collapsed relies on the title. */
export function RailItem({
  item,
  expanded,
  onNavigate,
}: {
  item: NavItem;
  expanded: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const active = isActivePath(pathname, item.href);
  const Icon = ICONS[item.icon];
  const badge = item.badge && item.badge > 0 ? (item.badge > 99 ? "99+" : String(item.badge)) : null;

  return (
    <Link
      href={item.href}
      title={expanded ? undefined : item.label}
      aria-label={item.label}
      data-active={active}
      onClick={onNavigate}
      className={cn(
        "relative flex shrink-0 items-center rounded-[12px] text-on-ink-muted transition-colors hover:bg-white/10 hover:text-white data-[active=true]:bg-accent data-[active=true]:text-white data-[active=true]:shadow-glow [&_svg]:size-5",
        expanded ? "h-11 w-full gap-3 px-3" : "size-11 justify-center",
      )}
    >
      <Icon strokeWidth={active ? 2.4 : 2} />
      {expanded ? <span className="truncate text-sm font-semibold">{item.label}</span> : null}
      {badge ? (
        <span
          className={cn(
            "flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-white px-1 text-[10px] font-bold text-ink",
            expanded ? "ml-auto" : "absolute -right-1 -top-1 ring-2 ring-ink",
          )}
        >
          {badge}
        </span>
      ) : null}
    </Link>
  );
}

/** A project row with its sub-pages, shown only when the rail has labels. */
export function RailProjectLink({
  project,
  onNavigate,
}: {
  project: RailProject;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const href = `/events/${project.id}`;
  const active = isActivePath(pathname, href);
  const [manual, setManual] = useState<boolean | null>(null);
  const open = manual ?? active;

  return (
    <div className="flex flex-col">
      <div
        className={cn(
          "flex items-center rounded-[12px] pr-1 transition-colors",
          active ? "bg-white/10 text-white" : "text-on-ink-muted hover:bg-white/10 hover:text-white",
        )}
      >
        <Link
          href={href}
          onClick={onNavigate}
          className="flex min-w-0 flex-1 items-center gap-2.5 px-3 py-2 text-[0.8125rem] font-medium"
        >
          <span aria-hidden className={cn("size-2.5 shrink-0 rounded-[4px]", project.swatch)} />
          <span className="truncate">{project.name}</span>
          {project.health !== "on_track" ? (
            <span
              title={project.health === "critical" ? "Critical" : "At risk"}
              className={cn(
                "size-1.5 shrink-0 rounded-full",
                project.health === "at_risk" ? "bg-warning" : "bg-accent",
              )}
            />
          ) : null}
        </Link>
        <button
          type="button"
          aria-label={open ? `Collapse ${project.name}` : `Expand ${project.name}`}
          aria-expanded={open}
          onClick={() => setManual(!open)}
          className="rounded-lg p-1 opacity-70 hover:opacity-100"
        >
          <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} />
        </button>
      </div>
      {open ? (
        <div className="mb-1 ml-4 flex flex-col border-l border-white/10 pl-2">
          {EVENT_SUBPAGES.map((sub) => {
            const subHref = `${href}/${sub.path}`;
            const subActive =
              pathname.startsWith(subHref) ||
              ("also" in sub && sub.also.some((alt) => pathname.startsWith(`${href}/${alt}`)));
            return (
              <Link
                key={sub.path}
                href={subHref}
                onClick={onNavigate}
                className={cn(
                  "truncate rounded-[10px] px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wider transition-colors",
                  subActive ? "bg-white/10 text-white" : "text-on-ink-muted hover:text-white",
                )}
              >
                {sub.label}
              </Link>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

/** Workspace card at the foot of the rail; its menu is supplied by the server. */
/** Fixed round box so a photo or initials sits dead-centre at any size. */
export function AvatarTile({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-card [&_img]:size-full [&_img]:object-cover [&_span]:size-full [&_span]:rounded-none [&_span]:border-0",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function RailWorkspace({
  avatar,
  kicker,
  name,
  expanded,
  menu,
}: {
  /** the signed-in person's avatar (photo or initials) */
  avatar: ReactNode;
  kicker: string;
  name: string;
  expanded: boolean;
  menu: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  return (
    <div ref={ref} className={cn("relative", expanded ? "w-full" : "flex w-full justify-center")}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        title={expanded ? undefined : name}
        className={cn(
          "flex items-center rounded-[12px] border border-white/10 bg-ink-2 text-left transition-colors hover:bg-ink-3",
          expanded ? "w-full gap-3 p-2.5" : "size-11 justify-center border-transparent bg-transparent",
        )}
      >
        <AvatarTile className={cn(expanded ? "size-9 text-[11px]" : "size-11 text-xs ring-2 ring-white/15")}>
          {avatar}
        </AvatarTile>
        {expanded ? (
          <>
            <span className="flex min-w-0 flex-1 flex-col leading-tight">
              <span className="truncate text-[0.66rem] font-semibold text-on-ink-muted">{kicker}</span>
              <span className="truncate text-[0.78rem] font-bold text-white">{name}</span>
            </span>
            <ChevronDown className={cn("size-4 text-on-ink-muted transition-transform", open && "rotate-180")} />
          </>
        ) : null}
      </button>
      {open ? (
        <div
          role="menu"
          onClick={(e) => {
            if ((e.target as HTMLElement).closest("a,button")) setOpen(false);
          }}
          className={cn(
            "absolute z-50 w-56 rounded-[14px] border border-white/10 bg-ink-2 p-1.5 text-on-ink shadow-float animate-in fade-in-0 zoom-in-95",
            // expanded: above the card; collapsed: beside the rail, so a 224px
            // menu never hangs off the left edge of the screen
            expanded ? "bottom-full left-0 mb-2" : "bottom-0 left-full ml-3",
          )}
        >
          {menu}
        </div>
      ) : null}
    </div>
  );
}

/** A row inside the workspace menu — links and the sign-out form share it. */
export const railMenuRowClass =
  "flex h-10 w-full items-center gap-2.5 rounded-[10px] px-3 text-sm font-medium text-on-ink-muted transition-colors hover:bg-white/10 hover:text-white [&_svg]:size-4";

export function Rail({
  short,
  product,
  items,
  projects,
  createHref,
  createLabel,
  avatar,
  userName,
  workspaceMenu,
}: {
  short: string;
  product: string;
  items: NavItem[];
  projects: RailProject[];
  createHref?: string;
  createLabel?: string;
  avatar: ReactNode;
  userName: string;
  workspaceMenu: ReactNode;
}) {
  const expanded = useRailExpanded();

  return (
    <aside
      className={cn(
        "flex h-full flex-col rounded-[18px] bg-ink py-4 text-on-ink shadow-float transition-[width] duration-200",
        expanded ? "w-60 px-3" : "w-[4.75rem] items-center",
      )}
    >
      <Link
        href="/"
        className={cn(
          "flex h-11 shrink-0 items-center rounded-[12px] bg-white/5",
          expanded ? "w-full gap-3 px-3" : "size-11 justify-center",
        )}
        title={`${short} ${product}`}
      >
        <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-accent text-[11px] font-black text-white">
          {short.slice(0, 1)}
        </span>
        {expanded ? (
          <span className="truncate text-sm font-bold tracking-tight">
            {short}
            <span className="text-accent">.</span>{" "}
            <span className="font-medium text-on-ink-muted">{product}</span>
          </span>
        ) : null}
      </Link>

      {createHref ? (
        <Link
          href={createHref}
          title={createLabel}
          className={cn(
            "mt-4 flex h-11 shrink-0 items-center rounded-full bg-accent text-white shadow-glow transition hover:-translate-y-px hover:bg-accent-strong",
            expanded ? "w-full justify-center gap-2 px-4 text-sm font-semibold" : "size-11 justify-center",
          )}
        >
          <Plus className="size-5" />
          {expanded ? createLabel : null}
        </Link>
      ) : null}

      <nav
        className={cn(
          "mt-4 flex min-h-0 w-full flex-1 flex-col gap-1 overflow-y-auto [scrollbar-width:none]",
          !expanded && "items-center",
        )}
      >
        {items.map((item) => (
          <RailItem key={item.href} item={item} expanded={expanded} />
        ))}
        {expanded && projects.length > 0 ? (
          <div className="mt-3 flex flex-col gap-1">
            <span className="px-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-on-ink-muted">
              Projects
            </span>
            {projects.map((p) => (
              <RailProjectLink key={p.id} project={p} />
            ))}
          </div>
        ) : null}
      </nav>

      <div className={cn("mt-3 shrink-0", expanded ? "w-full" : "flex w-full justify-center")}>
        <RailWorkspace avatar={avatar} kicker={`${short} ${product}`} name={userName} expanded={expanded} menu={workspaceMenu} />
      </div>

      <button
        type="button"
        onClick={() => setRailExpanded(!expanded)}
        aria-label={expanded ? "Collapse menu" : "Expand menu"}
        className={cn(
          "mt-3 flex h-10 shrink-0 items-center justify-center rounded-[12px] border border-white/10 text-xs font-semibold text-on-ink-muted transition-colors hover:bg-white/10 hover:text-white",
          expanded ? "w-full gap-2" : "size-10",
        )}
      >
        {expanded ? (
          <>
            <ChevronsLeft className="size-4" /> Collapse menu
          </>
        ) : (
          <ChevronsRight className="size-4" />
        )}
      </button>
    </aside>
  );
}
