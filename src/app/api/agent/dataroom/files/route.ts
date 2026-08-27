import { agentRoute } from "@/lib/agent/respond";
import { uploadFile } from "@/lib/dataroom/service";

// Agent upload (EPIC-023 extension). Same contract as /api/dataroom/upload —
// a raw PUT with the file as the body, metadata in the query string — because
// multipart is buffered before the handler runs, and a large upload must hit
// the quota check while STREAMING, not after filling memory. Quota, disk
// floor, versioning and the access log all come from the same uploadFile the
// app itself uses.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

export async function PUT(request: Request) {
  return agentRoute(request, async ({ actor, keyName }) => {
    const url = new URL(request.url);
    const folderId = url.searchParams.get("folderId") ?? "";
    const name = url.searchParams.get("name") ?? "";
    const replaceFileId = url.searchParams.get("replaceFileId") ?? undefined;
    if (!folderId || !name) {
      throw new Error("Pass ?folderId=… and ?name=… in the query string.");
    }
    const declaredSize = Number(request.headers.get("content-length") ?? 0);
    if (!Number.isFinite(declaredSize) || declaredSize <= 0) {
      throw new Error("That file is empty — send the bytes as the request body.");
    }
    if (!request.body) throw new Error("No file was sent.");

    const result = await uploadFile(actor, {
      folderId,
      name,
      declaredSize,
      mimeType: request.headers.get("x-file-type") ?? undefined,
      body: request.body,
      replaceFileId,
    });
    void keyName; // uploads are attributed to the acting user; the access
    // log carries the identity, and the file itself needs no suffix
    return result;
  });
}
