import { agentRoute } from "@/lib/agent/respond";
import { decide, getApprovalDetail } from "@/lib/approvals/service";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return agentRoute(request, async ({ actor }) => {
    const { id } = await params;
    const detail = await getApprovalDetail(actor, id);
    if (!detail) throw new Error("Approval not found.");
    return detail;
  });
}

/**
 * POST { decision: "approved" | "rejected", comment }
 * Comment is REQUIRED here even where the app makes it optional: a decision
 * taken from a chat window needs its reasoning written down.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return agentRoute(request, async ({ actor, keyName }) => {
    const { id } = await params;
    const body = (await request.json().catch(() => null)) as {
      decision?: string;
      comment?: string;
    } | null;
    if (body?.decision !== "approved" && body?.decision !== "rejected") {
      throw new Error('decision must be "approved" or "rejected".');
    }
    const comment = body.comment?.trim();
    if (!comment) throw new Error("A comment explaining the decision is required.");
    await decide(actor, id, body.decision, `${comment} — via ${keyName}`);
    return { decided: body.decision };
  });
}
