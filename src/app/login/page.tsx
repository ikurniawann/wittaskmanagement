import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/logo";
import { UserAvatar } from "@/components/task-meta";
import { Button, buttonVariants } from "@/components/ui/button";
import { auth, signOut } from "@/lib/auth";
import { LoginForm } from "./login-form";
import { getBranding } from "@/lib/org/branding";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage() {
  const branding = await getBranding();
  const session = await auth();

  // Already signed in? Say so instead of silently redirecting — switching
  // accounts was invisible before (Owner got stuck "unable to log in").
  if (session?.user) {
    return (
      <div className="flex min-h-svh flex-col items-center justify-center px-4">
        <div className="flex w-full max-w-sm flex-col gap-8">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/reddie-logo.png"
            alt="Reddie"
            className="mx-auto h-10 w-auto"
          />
          <Logo short={branding.orgShortName} product={branding.productName} className="text-sm" />
          <div className="flex flex-col gap-4 rounded-lg border bg-card p-5">
            <div className="flex items-center gap-3">
              <UserAvatar
                name={session.user.name ?? "?"}
                className="size-9 text-xs"
              />
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-sm font-medium">
                  {session.user.name}
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  {session.user.email} · {session.user.role}
                </span>
              </div>
            </div>
            <p className="text-sm text-muted-foreground">
              You are already signed in with this account.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link href="/my-tasks" className={buttonVariants({ size: "sm" })}>
                Continue ↗
              </Link>
              <form
                action={async () => {
                  "use server";
                  await signOut({ redirectTo: "/login" });
                }}
              >
                <Button type="submit" size="sm" variant="outline">
                  Sign out & switch account
                </Button>
              </form>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-svh flex-col items-center justify-center px-4">
      <div className="flex w-full max-w-sm flex-col gap-10">
        <div className="flex flex-col gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/reddie-logo.png"
            alt="Reddie"
            className="mx-auto h-10 w-auto"
          />
          <Logo short={branding.orgShortName} product={branding.productName} className="text-sm" />
          <h1 className="text-2xl font-semibold tracking-tight">
            Sign in
          </h1>
          <p className="text-sm text-muted-foreground">
            Staff access. External collaborators receive a magic link by email.
          </p>
        </div>
        <LoginForm />
      </div>
    </div>
  );
}
