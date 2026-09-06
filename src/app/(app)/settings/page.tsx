import { cn } from "@/lib/utils";
import { IntegrationsPanel } from "./integrations-panel";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { profiles } from "@/db/schema";
import { sessionActor } from "@/lib/auth/session-actor";
import { can } from "@/lib/permissions";
import { PreferencesForm } from "./preferences-form";

export const metadata: Metadata = { title: "Settings" };

// T-100: self-service notification & digest preferences.
export default async function SettingsPage({
  searchParams,
}: PageProps<"/settings">) {
  const actor = await sessionActor();
  if (!actor) redirect("/login");

  const [me] = await db
    .select({
      name: profiles.name,
      email: profiles.email,
      passwordHash: profiles.passwordHash,
      emailNotifications: profiles.emailNotifications,
      whatsappNotifications: profiles.whatsappNotifications,
      dailyDigest: profiles.dailyDigest,
      weeklyDigest: profiles.weeklyDigest,
      phone: profiles.phone,
    })
    .from(profiles)
    .where(eq(profiles.id, actor.id))
    .limit(1);
  if (!me) redirect("/login");

  // The Integrations tab changes what the WHOLE organisation sees, so it is
  // only offered to someone who may manage the org. The action behind it
  // checks the same right again: a hidden tab is not a permission.
  const canManageOrg = can(actor, "org.manage");
  const sp = await searchParams;
  const tab = canManageOrg && sp.tab === "integrations" ? "integrations" : "preferences";

  const integrations = canManageOrg
    ? await (async () => {
        const { INTEGRATIONS, integrationStates } = await import(
          "@/lib/integrations/service"
        );
        const states = await integrationStates();
        return INTEGRATIONS.map((i) => ({ ...i, enabled: states[i.key] }));
      })()
    : [];

  return (
    <section className="flex flex-col gap-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-3xl font-semibold tracking-tight">
          Settings
        </h1>
        <p className="text-sm text-muted-foreground">
          Notifications and digests — your name and password live in your{" "}
          <a href="/profile" className="underline underline-offset-4">profile</a>.
        </p>
      </div>

      {canManageOrg ? (
        <div className="flex w-fit rounded-md border p-0.5 text-sm">
          {(
            [
              ["preferences", "Preferences"],
              ["integrations", "Integrations"],
            ] as const
          ).map(([key, label]) => (
            <a
              key={key}
              href={`/settings${key === "preferences" ? "" : "?tab=integrations"}`}
              className={cn(
                "rounded px-3 py-1 transition-colors",
                tab === key
                  ? "bg-accent font-medium"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </a>
          ))}
        </div>
      ) : null}

      {tab === "integrations" ? (
        <IntegrationsPanel rows={integrations} />
      ) : (
      <PreferencesForm
        initial={{
          emailNotifications: me.emailNotifications,
          whatsappNotifications: me.whatsappNotifications,
          dailyDigest: me.dailyDigest,
          weeklyDigest: me.weeklyDigest,
          phone: me.phone ?? "",
        }}
        showWeekly={can(actor, "dashboard.view")}
      />
      )}
    </section>
  );
}
