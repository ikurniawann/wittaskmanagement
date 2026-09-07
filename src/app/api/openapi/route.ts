import { NextResponse } from "next/server";
import { agentOpenApi } from "@/lib/agent/openapi";
import { sessionActor } from "@/lib/auth/session-actor";
import { can } from "@/lib/permissions";

// The machine-readable Agent API description, for signed-in admins only: it
// spells out the credential scheme and every endpoint, which is exactly what
// an integrator needs and nobody else should browse. Rendered at /api-docs.
export async function GET(request: Request) {
  const actor = await sessionActor();
  if (!actor || !can(actor, "org.manage")) {
    return NextResponse.json({ error: "Admins only." }, { status: 403 });
  }
  // behind nginx + the tunnel the request URL is the container's, so the
  // public origin comes from the forwarded headers
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const proto = request.headers.get("x-forwarded-proto") ?? "https";
  const servers = host ? [{ url: `${proto}://${host}/api/agent` }] : agentOpenApi.servers;
  return NextResponse.json(
    { ...agentOpenApi, servers },
    { headers: { "Cache-Control": "no-store" } },
  );
}
