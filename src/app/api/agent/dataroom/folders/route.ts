import { agentRoute } from "@/lib/agent/respond";
import { createFolder } from "@/lib/dataroom/service";
import type { Visibility } from "@/lib/dataroom/access";

const VISIBILITIES = ["sealed", "division", "event", "organisation"] as const;

/** POST { eventId, name, parentId?, visibility?, divisionId? } */
export async function POST(request: Request) {
  return agentRoute(request, async ({ actor }) => {
    const body = (await request.json().catch(() => null)) as {
      eventId?: string;
      name?: string;
      parentId?: string | null;
      visibility?: string;
      divisionId?: string | null;
    } | null;
    if (!body?.eventId || !body.name) {
      throw new Error("eventId and name are required.");
    }
    if (body.visibility && !VISIBILITIES.includes(body.visibility as never)) {
      throw new Error(`visibility must be one of: ${VISIBILITIES.join(", ")}.`);
    }
    const { id } = await createFolder(actor, {
      eventId: body.eventId,
      name: body.name,
      parentId: body.parentId ?? null,
      visibility: body.visibility as Visibility | undefined,
      divisionId: body.divisionId ?? null,
    });
    return { id };
  });
}
