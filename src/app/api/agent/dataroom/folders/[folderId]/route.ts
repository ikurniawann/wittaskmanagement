import { agentRoute } from "@/lib/agent/respond";
import { deleteFolder, moveFolder, renameFolder } from "@/lib/dataroom/service";

/** PATCH { name? } and/or { parentId? } — rename and/or move. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ folderId: string }> },
) {
  return agentRoute(request, async ({ actor }) => {
    const { folderId } = await params;
    const body = (await request.json().catch(() => null)) as {
      name?: string;
      parentId?: string | null;
    } | null;
    if (!body) throw new Error("A JSON body is required.");
    const changed: string[] = [];
    if (body.name !== undefined) {
      await renameFolder(actor, folderId, body.name);
      changed.push("name");
    }
    if (body.parentId !== undefined) {
      await moveFolder(actor, folderId, body.parentId);
      changed.push("parentId");
    }
    if (changed.length === 0) throw new Error("Pass name and/or parentId.");
    return { changed };
  });
}

/** Refuses a non-empty folder — emptying it must be a human's decision. */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ folderId: string }> },
) {
  return agentRoute(request, async ({ actor }) => {
    const { folderId } = await params;
    await deleteFolder(actor, folderId);
    return { deleted: true };
  });
}
