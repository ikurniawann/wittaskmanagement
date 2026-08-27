import { agentRoute } from "@/lib/agent/respond";
import { getBranding, updateBranding } from "@/lib/org/branding";

export async function GET(request: Request) {
  return agentRoute(request, async () => getBranding());
}

/** PATCH { orgName?, orgShortName?, productName?, assistantName? } */
export async function PATCH(request: Request) {
  return agentRoute(request, async ({ actor }) => {
    const body = (await request.json().catch(() => null)) as {
      orgName?: string;
      orgShortName?: string;
      productName?: string;
      assistantName?: string;
    } | null;
    if (!body) throw new Error("A JSON body is required.");
    await updateBranding(actor, body);
    return { updated: true };
  });
}
