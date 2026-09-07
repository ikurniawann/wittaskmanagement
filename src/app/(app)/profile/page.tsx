import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { divisionMembers, divisions, profiles } from "@/db/schema";
import { AvatarUploader } from "./avatar-uploader";
import { sessionActor } from "@/lib/auth/session-actor";
import { PlayProgress } from "@/components/play-progress";
import { ProfileForm } from "./profile-form";

export const metadata: Metadata = { title: "Profile" };

// Your own account (Owner 2026-08-12), reached from the user block at the
// bottom of the sidebar. Always and only the signed-in user's row — the id
// comes from the session, so there is nothing here to point at anyone else.
export default async function ProfilePage() {
  const actor = await sessionActor();
  if (!actor) redirect("/login");

  const [me] = await db
    .select({
      name: profiles.name,
      email: profiles.email,
      role: profiles.role,
      avatarPath: profiles.avatarPath,
      passwordHash: profiles.passwordHash,
    })
    .from(profiles)
    .where(eq(profiles.id, actor.id))
    .limit(1);
  if (!me) redirect("/login");

  const memberships = await db
    .select({ name: divisions.name, role: divisionMembers.role })
    .from(divisionMembers)
    .innerJoin(divisions, eq(divisionMembers.divisionId, divisions.id))
    .where(eq(divisionMembers.userId, actor.id));

  return (
    <section className="flex flex-col gap-8">
      <PlayProgress userId={actor.id} />
      <div className="flex items-center gap-4">
        <AvatarUploader name={me.name} avatarPath={me.avatarPath} />
        <div className="flex flex-col gap-0.5">
          <h1 className="text-3xl font-semibold tracking-tight">{me.name}</h1>
          <p className="text-sm text-muted-foreground">
            {me.role}
            {memberships.length > 0
              ? ` · ${memberships.map((m) => `${m.name}${m.role === "head" ? " (head)" : ""}`).join(", ")}`
              : ""}
          </p>
        </div>
      </div>

      <ProfileForm
        initial={{ name: me.name, email: me.email }}
        hasPassword={me.passwordHash !== null}
      />

      <p className="text-xs text-muted-foreground">
        Notification and digest choices live in{" "}
        <a href="/settings" className="underline underline-offset-4">Settings</a>.
      </p>
    </section>
  );
}
