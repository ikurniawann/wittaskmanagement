import { agentRoute } from "@/lib/agent/respond";
import { createApproval, listMyQueue, listMyRequests } from "@/lib/approvals/service";

/** GET /approvals — waiting for MY decision; ?mine=1 — ones I requested. */
export async function GET(request: Request) {
  return agentRoute(request, async ({ actor }) => {
    const url = new URL(request.url);
    return url.searchParams.get("mine")
      ? listMyRequests(actor)
      : listMyQueue(actor);
  });
}

/** POST { type, title, divisionId, amount?, description?, eventId? } */
export async function POST(request: Request) {
  return agentRoute(request, async ({ actor, keyName, msisdn }) => {
    const body = (await request.json().catch(() => null)) as {
      type?: string;
      title?: string;
      description?: string;
      amount?: number;
      divisionId?: string;
      eventId?: string;
    } | null;
    if (!body?.type || !body.title || !body.divisionId) {
      throw new Error("type, title and divisionId are required.");
    }
    const approval = await createApproval(actor, {
      type: body.type as never,
      title: body.title,
      description: body.description
        ? `${body.description}\n\n— via agent ${keyName} (wa:${msisdn})`
        : `— via agent ${keyName} (wa:${msisdn})`,
      amount: body.amount,
      divisionId: body.divisionId,
      eventId: body.eventId,
    });
    return { id: approval.id };
  });
}
