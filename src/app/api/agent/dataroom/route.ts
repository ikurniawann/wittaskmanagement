import { agentRoute } from "@/lib/agent/respond";
import { listFolders } from "@/lib/dataroom/service";

// Dataroom listing for agents (EPIC-023 extension, Owner 2026-08-21).
// The folder set comes from listFolders — the ONE place dataroom visibility
// is decided (sealed/division/event/organisation) — and the file query below
// is then constrained to exactly those folder ids, so this route can never
// show a file whose folder the person may not see.
export async function GET(request: Request) {
  return agentRoute(request, async ({ actor }) => {
    const url = new URL(request.url);
    const eventId = url.searchParams.get("eventId");
    if (!eventId) throw new Error("Pass ?eventId=…");

    const folders = await listFolders(actor, eventId);
    if (folders.length === 0) return { folders: [] };

    const { db } = await import("@/db");
    const { dataroomFiles } = await import("@/db/schema");
    const { and, asc, eq, inArray, isNull } = await import("drizzle-orm");
    const rows = await db
      .select({
        id: dataroomFiles.id,
        folderId: dataroomFiles.folderId,
        name: dataroomFiles.name,
        currentVersion: dataroomFiles.currentVersion,
        updatedAt: dataroomFiles.updatedAt,
      })
      .from(dataroomFiles)
      .where(
        and(
          eq(dataroomFiles.eventId, eventId),
          inArray(dataroomFiles.folderId, folders.map((f) => f.id)),
          isNull(dataroomFiles.trashedAt),
        ),
      )
      .orderBy(asc(dataroomFiles.name));

    const byFolder = new Map<string, typeof rows>();
    for (const row of rows) {
      const list = byFolder.get(row.folderId) ?? [];
      list.push(row);
      byFolder.set(row.folderId, list);
    }
    return {
      folders: folders.map((folder) => ({
        id: folder.id,
        name: folder.name,
        parentId: folder.parentId,
        visibility: folder.visibility,
        canUpload: folder.canUpload,
        canManage: folder.canManage,
        files: (byFolder.get(folder.id) ?? []).map((f) => ({
          id: f.id,
          name: f.name,
          version: f.currentVersion,
          updatedAt: f.updatedAt,
        })),
      })),
    };
  });
}
