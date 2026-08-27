import { agentRoute } from "@/lib/agent/respond";
import {
  createDivision,
  deleteDivision,
  listDivisions,
  renameDivision,
} from "@/lib/org/service";

export async function GET(request: Request) {
  return agentRoute(request, async () => listDivisions());
}

/** POST { name } — create; { id, name } — rename; { id, delete: true } — delete. */
export async function POST(request: Request) {
  return agentRoute(request, async ({ actor }) => {
    const body = (await request.json().catch(() => null)) as {
      id?: string;
      name?: string;
      delete?: boolean;
    } | null;
    if (!body) throw new Error("A JSON body is required.");
    if (body.delete) {
      if (!body.id) throw new Error("id is required to delete.");
      await deleteDivision(actor, body.id);
      return { deleted: true };
    }
    if (body.id) {
      if (!body.name) throw new Error("name is required to rename.");
      await renameDivision(actor, body.id, body.name);
      return { renamed: true };
    }
    if (!body.name) throw new Error("name is required.");
    const division = await createDivision(actor, body.name);
    return { id: division.id };
  });
}
