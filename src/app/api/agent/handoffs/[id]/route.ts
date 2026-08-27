import { agentRoute } from "@/lib/agent/respond";
import { decideHandoff } from "@/lib/tasks/service";

/** POST { accept: true | false } — receiving division's decision. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return agentRoute(request, async ({ actor }) => {
    const { id } = await params;
    const body = (await request.json().catch(() => null)) as { accept?: boolean } | null;
    if (typeof body?.accept !== "boolean") {
      throw new Error("Pass { accept: true } or { accept: false }.");
    }
    await decideHandoff(actor, id, body.accept);
    return { decided: body.accept ? "accepted" : "declined" };
  });
}
