import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { sessionActor } from "@/lib/auth/session-actor";
import { can } from "@/lib/permissions";
import { SwaggerView } from "./swagger-view";

export const metadata: Metadata = { title: "API docs" };

// Swagger UI over the Agent API (Owner 2026-09-07). Admin-only like the key
// management it belongs to; "Try it out" runs against this very instance
// with the key and phone the reader pastes into Authorize.
export default async function ApiDocsPage() {
  const actor = await sessionActor();
  if (!actor || !can(actor, "org.manage")) redirect("/my-tasks");

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-3xl font-semibold tracking-tight">API docs</h1>
        <p className="text-sm text-muted-foreground">
          The Agent API, endpoint by endpoint. Press <span className="font-medium">Authorize</span>,
          paste an agent key from Admin and the WhatsApp number the agent should act for, then try
          any call live against this instance.
        </p>
      </div>
      <SwaggerView specUrl="/api/openapi" />
    </section>
  );
}
