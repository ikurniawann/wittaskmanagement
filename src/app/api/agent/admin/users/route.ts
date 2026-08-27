import { agentRoute } from "@/lib/agent/respond";
import { listUsersWithMemberships } from "@/lib/org/service";
import { assertCan } from "@/lib/permissions";

/**
 * GET /admin/users — org.manage only. Fields are mapped EXPLICITLY: the
 * service row carries the password hash, and a spread here would ship it to
 * whatever chat window asked.
 */
export async function GET(request: Request) {
  return agentRoute(request, async ({ actor }) => {
    assertCan(actor, "org.manage");
    const users = await listUsersWithMemberships();
    return users.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      phone: u.phone,
      isActive: u.isActive,
      whatsappNotifications: u.whatsappNotifications,
      memberships: u.memberships.map((m) => ({
        divisionId: m.divisionId,
        role: m.role,
      })),
    }));
  });
}
