import { agentRoute } from "@/lib/agent/respond";
import { addBudgetLine, eventBudgetRollup, listEventExpenses } from "@/lib/budgets/service";

/** GET /budget?eventId=… — rollup + expenses of one event. */
export async function GET(request: Request) {
  return agentRoute(request, async ({ actor }) => {
    const eventId = new URL(request.url).searchParams.get("eventId");
    if (!eventId) throw new Error("Pass ?eventId=…");
    const [rollup, expenses] = await Promise.all([
      eventBudgetRollup(actor, eventId),
      listEventExpenses(actor, eventId),
    ]);
    return { rollup, expenses };
  });
}

/** POST { eventId, divisionId, name, plannedAmount } — a budget line. */
export async function POST(request: Request) {
  return agentRoute(request, async ({ actor }) => {
    const body = (await request.json().catch(() => null)) as {
      eventId?: string;
      divisionId?: string;
      name?: string;
      plannedAmount?: number;
    } | null;
    if (!body?.eventId || !body.divisionId || !body.name || !body.plannedAmount) {
      throw new Error("eventId, divisionId, name and plannedAmount are required.");
    }
    const line = await addBudgetLine(actor, {
      eventId: body.eventId,
      divisionId: body.divisionId,
      name: body.name,
      plannedAmount: body.plannedAmount,
    });
    return { id: line.id };
  });
}
