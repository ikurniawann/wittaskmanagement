import Link from "next/link";
import type { ReactNode } from "react";
import { AppFrame } from "@/components/app-frame";
import { CommandPalette } from "@/components/command-palette";
import { Logo } from "@/components/logo";
import { MobileNav } from "@/components/mobile-nav";
import { EventNavLink, NavLink, type NavItem } from "@/components/nav-link";
import { NotificationsBell } from "@/components/notifications-bell";
import { UserAvatar } from "@/components/task-meta";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { auth, signOut } from "@/lib/auth";
import { sessionActor } from "@/lib/auth/session-actor";
import { listActiveEvents } from "@/lib/events/service";
import { eventColorClass } from "@/lib/events/colors";
import { getBranding } from "@/lib/org/branding";
import { can } from "@/lib/permissions";

// Plane-style shell (T-110): fixed left sidebar (nav + events + user block),
// slim top bar on mobile. Content scrolls independently.
export async function AppShell({ children }: { children: ReactNode }) {
  const session = await auth();
  const actor = session?.user?.id ? await sessionActor() : null;

  const branding = await getBranding();

  // the session carries id+role only; the avatar lives on the profile row
  const avatarPath = actor
    ? await (async () => {
        const { db } = await import("@/db");
        const { profiles } = await import("@/db/schema");
        const { eq } = await import("drizzle-orm");
        const [row] = await db
          .select({ avatarPath: profiles.avatarPath })
          .from(profiles)
          .where(eq(profiles.id, actor.id))
          .limit(1);
        return row?.avatarPath ?? null;
      })()
    : null;

  const playEnabled = actor
    ? await (async () => {
        const { isPlayEnabled } = await import("@/lib/play/settings");
        return isPlayEnabled();
      })()
    : false;

  const timelineCounts = actor
    ? await (async () => {
        const { getUnreadCounts } = await import("@/lib/timeline/service");
        return getUnreadCounts(actor);
      })()
    : { timeline: 0, mentions: 0 };

  const items: NavItem[] = [
    { href: "/my-tasks", label: "My Tasks", icon: "my-tasks" },
    { href: "/events", label: "Projects", icon: "events" },
    { href: "/calendar", label: "Calendar", icon: "calendar" },
    {
      href: "/timeline",
      label: "Timeline",
      icon: "timeline",
      badge: timelineCounts.timeline + timelineCounts.mentions,
    },
    { href: "/approvals", label: "Approvals", icon: "approvals" },
    ...(actor && can(actor, "page.use")
      ? [{ href: "/pages", label: "Pages", icon: "pages" as const }]
      : []),
    { href: "/dashboard", label: "Dashboard", icon: "dashboard" },
    // Backstage Play (EPIC-024): the entry appears only while the org flag is
    // on AND the person may enter; the page re-checks both.
    ...(actor && playEnabled && can(actor, "play.view")
      ? [{ href: "/play", label: "Play", icon: "play" as const }]
      : []),
    ...(actor && can(actor, "ai.assistant")
      ? [
          {
            href: "/assistant",
            label: branding.assistantName,
            icon: "assistant" as const,
          },
        ]
      : []),
    ...(actor && can(actor, "org.manage")
      ? [{ href: "/admin", label: "Admin", icon: "admin" as const }]
      : []),
    { href: "/settings", label: "Settings", icon: "settings" },
  ];

  const events =
    actor && can(actor, "event.view")
      ? (await listActiveEvents(actor)).map((e) => ({
          id: e.id,
          name: e.name,
          health: e.health,
          swatch: eventColorClass(e.id, e.color),
        }))
      : [];

  const sidebar = (
    <aside className="sticky top-0 hidden h-svh w-60 shrink-0 flex-col border-r bg-sidebar md:flex print:!hidden">
        <div className="flex h-14 items-center border-b px-4">
          <Logo short={branding.orgShortName} product={branding.productName} className="text-[13px]" />
        </div>
        <div className="flex flex-1 flex-col gap-5 overflow-y-auto p-3">
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
        {session?.user ? (
          <div className="flex items-center gap-2 border-t p-3">
            {/* the block itself opens the profile; Out stays its own button */}
            <Link
              href="/profile"
              className="flex min-w-0 flex-1 items-center gap-2 rounded-md p-1 -m-1 transition-colors hover:bg-accent/40"
              title="Your profile"
            >
            <UserAvatar
              name={session.user.name ?? "?"}
              src={avatarPath}
              className="size-7 text-[10px]"
            />
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-xs font-medium">
                {session.user.name}
              </span>
              <span className="truncate text-[10px] uppercase tracking-wider text-muted-foreground">
                {session.user.role}
              </span>
            </div>
            </Link>
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/login" });
              }}
            >
              <Button
                variant="ghost"
                size="sm"
                type="submit"
                className="text-xs text-muted-foreground"
              >
                Out
              </Button>
            </form>
          </div>
        ) : null}
      </aside>
  );

  const header = (
    <header className="sticky top-0 z-40 flex h-14 items-center justify-between gap-3 border-b bg-background/95 px-4 backdrop-blur sm:px-6 print:hidden">
      <div className="flex items-center gap-2">
        <MobileNav
          // mobile has no sidebar user block, so Profile rides the menu there
          items={[
            ...items,
            { href: "/profile", label: "Profile", icon: "profile" as const },
          ]}
          events={events}
          orgShortName={branding.orgShortName}
          productName={branding.productName}
        />
        <Logo short={branding.orgShortName} product={branding.productName} className="text-[13px] md:hidden" />
      </div>
      <div className="flex items-center gap-1.5">
        {session?.user ? <CommandPalette /> : null}
        {session?.user ? <NotificationsBell /> : null}
        <ThemeToggle />
      </div>
    </header>
  );

  return (
    <AppFrame sidebar={sidebar} header={header}>
      {children}
    </AppFrame>
  );
}
