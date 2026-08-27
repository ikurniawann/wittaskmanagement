import { agentRoute } from "@/lib/agent/respond";
import { addComment } from "@/lib/tasks/service";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return agentRoute(request, async ({ actor, keyName }) => {
    const { id } = await params;
    const body = (await request.json().catch(() => null)) as { body?: string } | null;
    const text = body?.body?.trim();
    if (!text) throw new Error("body is required.");
    // the suffix keeps a human-typed comment distinguishable from a relayed
    // one in the timeline, without a schema change
    await addComment(actor, id, `${text}\n\n_— via ${keyName}_`);
    return { posted: true };
  });
}
