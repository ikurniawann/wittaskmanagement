import { agentRoute } from "@/lib/agent/respond";

// Identity probe: the first call an agent should make. Answers "who am I
// acting for and what may they do", so the agent can shape its replies
// instead of discovering permissions by failing.
export async function GET(request: Request) {
  return agentRoute(request, async ({ actor, keyName, msisdn }) => {
    const { db } = await import("@/db");
    const { profiles } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    const [me] = await db
      .select({ name: profiles.name, email: profiles.email })
      .from(profiles)
      .where(eq(profiles.id, actor.id))
      .limit(1);
    return {
      userId: actor.id,
      name: me?.name ?? null,
      role: actor.role,
      memberships: actor.memberships,
      actingVia: { key: keyName, phone: msisdn },
    };
  });
}
