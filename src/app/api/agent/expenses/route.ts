import { agentRoute } from "@/lib/agent/respond";
import { createExpenseRequest } from "@/lib/budgets/service";

/**
 * POST { eventId, divisionId, title, amount, vendor?, justification?,
 *        budgetLineId? } — files the expense AND opens its approval chain,
 * exactly as the form does.
 */
export async function POST(request: Request) {
  return agentRoute(request, async ({ actor, keyName, msisdn }) => {
    const body = (await request.json().catch(() => null)) as {
      eventId?: string;
      divisionId?: string;
      budgetLineId?: string;
      title?: string;
      vendor?: string;
      amount?: number;
      justification?: string;
    } | null;
    if (!body?.eventId || !body.divisionId || !body.title || !body.amount) {
      throw new Error("eventId, divisionId, title and amount are required.");
    }
    const result = await createExpenseRequest(actor, {
      eventId: body.eventId,
      divisionId: body.divisionId,
      budgetLineId: body.budgetLineId,
      title: body.title,
      vendor: body.vendor,
      amount: body.amount,
      justification: body.justification
        ? `${body.justification} — via agent ${keyName} (wa:${msisdn})`
        : `via agent ${keyName} (wa:${msisdn})`,
    });
    return result;
  });
}
