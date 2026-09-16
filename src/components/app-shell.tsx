import { CircleUserRound, LogOut, Plus, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { AppFrame } from "@/components/app-frame";
import { BottomBar } from "@/components/bottom-bar";
import { CommandPalette } from "@/components/command-palette";
import { MobileNav } from "@/components/mobile-nav";
import { type NavItem } from "@/components/nav-link";
import { NotificationsBell } from "@/components/notifications-bell";
import { AvatarTile, Rail, railMenuRowClass, type RailProject } from "@/components/rail";
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

  const userName = session?.user?.name ?? "?";
  const avatarNode = <UserAvatar name={userName} src={avatarPath} className="size-full" />;

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
        <Link
          href="/profile"
          className="mb-1 flex flex-row items-center gap-3 rounded-xl px-2.5 py-2 transition-colors hover:bg-white/10"
        >
          <AvatarTile className="size-10 text-xs">{avatarNode}</AvatarTile>
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
      tagline={branding.tagline}
      items={items}
      projects={projects}
      avatar={avatarNode}
      userName={userName}
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
      tagline={branding.tagline}
      footer={workspaceMenu}
    />
  );

  const header = (
    <header className="flex h-14 shrink-0 items-center gap-2 sm:gap-3 print:hidden">
      {/* the drawer button shows on phones, and on desktop for fullscreen routes */}
      {drawer("header")}
      {/* eslint-disable-next-line @next/next/no-img-element -- static asset */}
      <img src="/logowit.png" alt={`${branding.orgShortName} ${branding.productName}`} className="h-5 w-auto md:hidden" />
      {session?.user ? (
        <>
          {/* phones have no rail, so the search rides the header there; the
              rail's instance owns ⌘K on larger screens */}
          <div className="ml-auto md:hidden">
            <CommandPalette variant="icon" hotkey={false} />
          </div>
          <span className="ml-auto hidden md:block" />
          {createHref ? (
            <Link
              href={createHref}
              className={cn(buttonVariants({ variant: "primary" }), "hidden sm:inline-flex")}
            >
              <Plus /> {createLabel}
            </Link>
          ) : null}
          <NotificationsBell />
        </>
      ) : null}
    </header>
  );

  // phone bar: the four most-used destinations; everything else is in the drawer
  const barItems = items.filter((i) => ["/my-tasks", "/events", "/timeline", "/dashboard"].includes(i.href));
  const bottomBar = <BottomBar items={barItems} createHref={createHref} createLabel={createLabel} />;

  return (
    <AppFrame sidebar={sidebar} header={header} bottomBar={bottomBar}>
      {children}
    </AppFrame>
  );
}
