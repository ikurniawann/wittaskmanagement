import { CircleUserRound, LogOut, Plus, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { AppFrame } from "@/components/app-frame";
import { BottomBar } from "@/components/bottom-bar";
import { CommandPalette } from "@/components/command-palette";
import { Logo } from "@/components/logo";
import { MobileNav } from "@/components/mobile-nav";
import { type NavItem } from "@/components/nav-link";
import { NotificationsBell } from "@/components/notifications-bell";
import { Rail, railMenuRowClass, type RailProject } from "@/components/rail";
import { UserAvatar } from "@/components/task-meta";
import { ThemeToggle } from "@/components/theme-toggle";
import { buttonVariants } from "@/components/ui/button";
import { auth, signOut } from "@/lib/auth";
import { sessionActor } from "@/lib/auth/session-actor";
import { listActiveEvents } from "@/lib/events/service";
import { eventColorClass } from "@/lib/events/colors";
import { getBranding } from "@/lib/org/branding";
import { can } from "@/lib/permissions";
import { cn } from "@/lib/utils";

// WIT UI style shell (Owner 2026-09-16, ~/Desktop/uiwit): floating dark rail
// on the left (icon rail on tablets, labels on desktop), a light header with
// the search pill, the one primary action, a numbered bell and the avatar
// pill; on phones the rail becomes a floating bottom bar plus a drawer.
// Content scrolls independently inside <main>.
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
      ? [{ href: "/assistant", label: branding.assistantName, icon: "assistant" as const }]
      : []),
    ...(actor && can(actor, "org.manage")
      ? [{ href: "/admin", label: "Admin", icon: "admin" as const }]
      : []),
  ];

  const projects: RailProject[] =
    actor && can(actor, "event.view")
      ? (await listActiveEvents(actor)).map((e) => ({
          id: e.id,
          name: e.name,
          health: e.health,
          swatch: eventColorClass(e.id, e.color),
        }))
      : [];

  const canCreate = Boolean(actor && can(actor, "event.create"));
  const createHref = canCreate ? "/events/new" : undefined;
  const createLabel = "New project";

  const signOutForm = (
    <form
      action={async () => {
        "use server";
        await signOut({ redirectTo: "/login" });
      }}
    >
      <button type="submit" className={railMenuRowClass}>
        <LogOut /> Sign out
      </button>
    </form>
  );

  // Profile, settings, theme and sign-out live in the workspace menu (and at
  // the foot of the phone drawer), not as rail items.
  const workspaceMenu = (
    <>
      {session?.user ? (
        <Link href="/profile" className={cn(railMenuRowClass, "h-auto py-2")}>
          <UserAvatar name={session.user.name ?? "?"} src={avatarPath} className="size-7 text-[10px]" />
          <span className="flex min-w-0 flex-col leading-tight">
            <span className="truncate text-sm font-semibold text-white">{session.user.name}</span>
            <span className="truncate text-[10px] uppercase tracking-wider text-on-ink-muted">
              {session.user.role}
            </span>
          </span>
        </Link>
      ) : null}
      <Link href="/profile" className={railMenuRowClass}>
        <CircleUserRound /> Profile
      </Link>
      <Link href="/settings" className={railMenuRowClass}>
        <SlidersHorizontal /> Settings
      </Link>
      <ThemeToggle variant="row" className={railMenuRowClass} />
      {signOutForm}
    </>
  );

  const sidebar = (
    <Rail
      short={branding.orgShortName}
      product={branding.productName}
      items={items}
      projects={projects}
      createHref={createHref}
      createLabel={createLabel}
      workspaceMenu={workspaceMenu}
    />
  );

  const drawer = (variant: "header" | "bar") => (
    <MobileNav
      variant={variant}
      items={items}
      projects={projects}
      orgShortName={branding.orgShortName}
      productName={branding.productName}
      footer={workspaceMenu}
    />
  );

  const header = (
    <header className="flex h-14 shrink-0 items-center gap-2 sm:gap-3 print:hidden">
      {/* the drawer button shows on phones, and on desktop for fullscreen routes */}
      {drawer("header")}
      <Logo short={branding.orgShortName} product={branding.productName} className="text-[13px] md:hidden" />
      {session?.user ? (
        <>
          <div className="ml-auto hidden w-full max-w-sm md:mr-auto md:ml-6 md:block">
            <CommandPalette variant="pill" />
          </div>
          <div className="ml-auto md:hidden">
            <CommandPalette variant="icon" />
          </div>
          {createHref ? (
            <Link
              href={createHref}
              className={cn(buttonVariants({ variant: "primary" }), "hidden sm:inline-flex")}
            >
              <Plus /> {createLabel}
            </Link>
          ) : null}
          <NotificationsBell />
          <Link
            href="/profile"
            title="Your profile"
            className="flex h-11 shrink-0 items-center gap-2.5 rounded-full bg-card pl-1.5 pr-1.5 shadow-card transition-colors hover:bg-surface-2 xl:pr-3"
          >
            <UserAvatar name={session.user.name ?? "?"} src={avatarPath} className="size-8 text-[11px]" />
            <span className="hidden min-w-0 flex-col leading-tight xl:flex">
              <span className="max-w-[10rem] truncate text-xs font-semibold">{session.user.name}</span>
              <span className="max-w-[10rem] truncate text-[10px] text-muted-foreground">
                {session.user.email}
              </span>
            </span>
          </Link>
        </>
      ) : null}
    </header>
  );

  // phone bar: the four most-used destinations; everything else is in the drawer
  const barItems = items.filter((i) => ["/my-tasks", "/events", "/timeline", "/dashboard"].includes(i.href));
  const bottomBar = (
    <BottomBar items={barItems} createHref={createHref} createLabel={createLabel} menu={drawer("bar")} />
  );

  return (
    <AppFrame sidebar={sidebar} header={header} bottomBar={bottomBar}>
      {children}
    </AppFrame>
  );
}
