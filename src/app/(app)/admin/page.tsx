import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { sessionActor } from "@/lib/auth/session-actor";
import { listDivisions, listUsersWithMemberships } from "@/lib/org/service";
import { can } from "@/lib/permissions";
import { getBranding } from "@/lib/org/branding";
import { BrandingForm } from "./branding-form";
import { WhatsAppGateway } from "./whatsapp-gateway";
import { AgentKeysCard } from "./agent-keys-card";
import { MegatixPanel } from "./megatix-panel";
import { DivisionsCard } from "./divisions-card";
import { AdminTabs } from "./admin-tabs";

export const metadata: Metadata = { title: "Admin" };

export default async function AdminPage() {
  const actor = await sessionActor();
  if (!actor || !can(actor, "org.manage")) redirect("/my-tasks");

  const [users, divisions, branding] = await Promise.all([
    listUsersWithMemberships(),
    listDivisions(),
    getBranding(),
  ]);
  const divisionStats = await (async () => {
    const { db } = await import("@/db");
    const { divisionMembers, tasks } = await import("@/db/schema");
    const { eq, sql } = await import("drizzle-orm");
    const members = await db
      .select({ divisionId: divisionMembers.divisionId, count: sql<number>`count(*)::int` })
      .from(divisionMembers)
      .groupBy(divisionMembers.divisionId);
    const taskRows = await db
      .select({ divisionId: tasks.divisionId, count: sql<number>`count(*)::int` })
      .from(tasks)
      .groupBy(tasks.divisionId);
    void eq;
    return {
      members: new Map(members.map((m) => [m.divisionId, m.count])),
      tasks: new Map(taskRows.map((t) => [t.divisionId, t.count])),
    };
  })();

  const { getMegatixStatus } = await import("@/lib/megatix/client");
  const { listAgentKeys } = await import("@/lib/agent/auth");
  // Tessera's admin panel was removed at the Owner's request (2026-08-27):
  // no token was ever stored, the org sells through Megatix, and a box asking
  // for a hand-copied token that expires in five days is worse than absent.
  // The channel itself is untouched in src/lib/tessera — restoring the panel
  // is re-adding this one component.
  const [megatix, agentKeys] = await Promise.all([
    getMegatixStatus(actor),
    listAgentKeys(actor),
  ]);

  return (
    <section className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-semibold tracking-tight">Admin</h1>
          <p className="text-sm text-muted-foreground">
            Manage users, divisions, and org-wide settings.
          </p>
        </div>
        <div className="flex items-center gap-4">
        <Link
          href="/admin/storage"
          className="text-xs font-medium uppercase tracking-wider text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          Storage ↗
        </Link>
        <Link
          href="/admin/audit"
          className="text-xs font-medium uppercase tracking-wider text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          Audit log ↗
        </Link>
        </div>
      </div>

      <BrandingForm
        orgName={branding.orgName}
        orgShortName={branding.orgShortName}
        productName={branding.productName}
        assistantName={branding.assistantName}
      />

      <WhatsAppGateway />


      <MegatixPanel
        configured={megatix.configured}
        email={megatix.email}
        baseUrl={megatix.baseUrl}
        savedAt={megatix.savedAt}
        tokenValidUntil={megatix.tokenValidUntil}
        tokenLive={megatix.tokenLive}
        lastOkAt={megatix.lastOkAt}
        lastError={megatix.lastError}
        unreadableSample={megatix.unreadableSample}
      />

      <AgentKeysCard
        keys={agentKeys.map((k) => ({
          id: k.id,
          name: k.name,
          tokenTail: k.tokenTail,
          createdAt: k.createdAt.toISOString(),
          lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
          revokedAt: k.revokedAt?.toISOString() ?? null,
        }))}
      />

      <DivisionsCard
        divisions={divisions.map((d) => ({
          id: d.id,
          name: d.name,
          memberCount: divisionStats.members.get(d.id) ?? 0,
          taskCount: divisionStats.tasks.get(d.id) ?? 0,
        }))}
      />

      <AdminTabs
        actorRole={actor.role}
        users={users.map((u) => ({
          id: u.id,
          name: u.name,
          email: u.email,
          role: u.role,
          isActive: u.isActive,
          phone: u.phone,
          whatsappNotifications: u.whatsappNotifications,
          memberships: u.memberships.map((m) => ({
            divisionId: m.divisionId,
            role: m.role,
          })),
        }))}
        divisions={divisions.map((d) => ({ id: d.id, name: d.name }))}
      />
    </section>
  );
}
