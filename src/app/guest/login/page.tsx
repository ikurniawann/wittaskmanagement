import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { signIn } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { getBranding } from "@/lib/org/branding";

export const metadata: Metadata = { title: "Guest access" };

// Magic-link landing (T-071). The link is a GET; the actual sign-in happens
// on the button POST so email scanners never consume a session.
export default async function GuestLoginPage({
  searchParams,
}: PageProps<"/guest/login">) {
  const branding = await getBranding();
  const sp = await searchParams;
  const token = typeof sp.token === "string" ? sp.token : "";
  const failed = sp.error === "1";

  async function continueAction(formData: FormData) {
    "use server";
    const ip =
      (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ??
      "unknown";
    if (!rateLimit(`guest-login:${ip}`, 10, 10 * 60_000)) {
      redirect("/guest/login?error=1");
    }
    try {
      await signIn("guest-token", {
        token: String(formData.get("token") ?? ""),
        redirectTo: "/guest",
      });
    } catch (error) {
      if (error instanceof AuthError) {
        redirect("/guest/login?error=1");
      }
      throw error; // NEXT_REDIRECT on success
    }
  }

  return (
    <div className="flex min-h-svh flex-col items-center justify-center px-4">
      <div className="flex w-full max-w-sm flex-col gap-8">
        <Logo short={branding.orgShortName} product={branding.productName} className="text-sm" />
        {failed ? (
          <div className="flex flex-col gap-2 rounded-card bg-card shadow-card p-5">
            <h1 className="text-lg font-semibold">Link tidak valid</h1>
            <p className="text-sm text-muted-foreground">
              This invite link is invalid, expired, or has been revoked. Ask
              your contact at the organisation to send a new one.
            </p>
          </div>
        ) : token ? (
          <form action={continueAction} className="flex flex-col gap-4 rounded-card bg-card shadow-card p-5">
            <input type="hidden" name="token" value={token} />
            <h1 className="text-lg font-semibold">Welcome</h1>
            <p className="text-sm text-muted-foreground">
              You&apos;ve been invited to collaborate on an event. No
              password needed — continue with your personal link.
            </p>
            <Button type="submit">Enter the portal ↗</Button>
          </form>
        ) : (
          <div className="flex flex-col gap-2 rounded-card bg-card shadow-card p-5">
            <h1 className="text-lg font-semibold">Missing invite link</h1>
            <p className="text-sm text-muted-foreground">
              Open the invite link from your email to access the portal.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
