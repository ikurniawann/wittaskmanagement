import { agentRoute } from "@/lib/agent/respond";
import { createInvite, listInvites } from "@/lib/external/service";
import type { FormType } from "@/lib/external/forms";

/** GET /guests?eventId=… — external invites of one event. */
export async function GET(request: Request) {
  return agentRoute(request, async ({ actor }) => {
    const eventId = new URL(request.url).searchParams.get("eventId");
    if (!eventId) throw new Error("Pass ?eventId=…");
    return listInvites(actor, eventId);
  });
}

/**
 * POST { eventId, divisionId, email, name, requestedForms? } — invites an
 * external guest. The magic link comes back in the response for the agent to
 * relay; it is NOT messaged anywhere automatically.
 */
export async function POST(request: Request) {
  return agentRoute(request, async ({ actor }) => {
    const body = (await request.json().catch(() => null)) as {
      eventId?: string;
      divisionId?: string;
      email?: string;
      name?: string;
      requestedForms?: string[];
    } | null;
    if (!body?.eventId || !body.divisionId || !body.email || !body.name) {
      throw new Error("eventId, divisionId, email and name are required.");
    }
    const result = await createInvite(actor, {
      eventId: body.eventId,
      divisionId: body.divisionId,
      email: body.email,
      name: body.name,
      requestedForms: (body.requestedForms ?? []) as FormType[],
    });
    return result;
  });
}
