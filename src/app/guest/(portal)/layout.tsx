import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { Logo } from "@/components/logo";
import { UserAvatar } from "@/components/task-meta";
import { Button } from "@/components/ui/button";
import { auth, signOut } from "@/lib/auth";
import { getGuestContext } from "@/lib/external/service";
import { getBranding } from "@/lib/org/branding";

// Guest portal frame (T-072): minimal shell, no internal navigation.
// Scope is re-validated here on every request — a revoked/expired invite
// drops the guest out immediately.
export default async function GuestLayout({
  children,
}: {
  children: ReactNode;
}) {
  const branding = await getBranding();
  const session = await auth();
  if (!session?.user?.id) redirect("/guest/login");
  if (session.user.role !== "external") redirect("/my-tasks");

  const context = await getGuestContext(session.user.id);
  if (!context) {
    return (
      <div className="flex min-h-svh flex-col items-center justify-center gap-6 px-4">
        <Logo short={branding.orgShortName} product={branding.productName} className="text-sm" />
        <div className="flex max-w-sm flex-col gap-3 rounded-card bg-card shadow-card p-5">
          <h1 className="text-lg font-semibold">Access ended</h1>
          <p className="text-sm text-muted-foreground">
            Your invite has expired or been revoked. Contact your liaison
            if you still need access.
          </p>
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/guest/login" });
            }}
          >
            <Button variant="outline" size="sm" type="submit">
              Sign out
            </Button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-svh flex-col">
      <header className="border-b">
        <div className="mx-auto flex h-14 w-full max-w-4xl items-center justify-between gap-4 px-4">
          <div className="flex min-w-0 items-center gap-3">
            <Logo short={branding.orgShortName} product={branding.productName} className="text-[13px]" />
            <span className="hidden text-xs text-muted-foreground sm:block">
              {context.eventName} · {context.divisionName}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <UserAvatar name={session.user.name ?? "?"} className="size-7 text-[10px]" />
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/guest/login" });
              }}
            >
              <Button variant="ghost" size="sm" type="submit" className="text-xs">
                Out
              </Button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8">{children}</main>
    </div>
  );
}
