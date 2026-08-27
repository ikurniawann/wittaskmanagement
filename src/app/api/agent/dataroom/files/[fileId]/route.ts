import { NextResponse } from "next/server";
import { AgentAuthError, authenticateAgent } from "@/lib/agent/auth";
import { agentRoute } from "@/lib/agent/respond";
import { moveFile, openForDownload, renameFile, trashFile } from "@/lib/dataroom/service";
import { safeDownloadName } from "@/lib/dataroom/paths";
import { openVersion, statVersion } from "@/lib/dataroom/storage";
import { PermissionError } from "@/lib/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET — the bytes, streamed. Not wrapped in agentRoute because the success
 * path is a file stream, not JSON. openForDownload both resolves and LOGS the
 * read in one step, so an agent download is as recorded as a browser one.
 * PermissionError maps to 404, not 403 — telling someone a file exists but is
 * closed to them is itself a disclosure.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ fileId: string }> },
) {
  let actor;
  try {
    ({ actor } = await authenticateAgent(request));
  } catch (error) {
    if (error instanceof AgentAuthError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    throw error;
  }

  const { fileId } = await params;
  let opened;
  try {
    opened = await openForDownload(actor, fileId);
  } catch (error) {
    if (error instanceof PermissionError) {
      return NextResponse.json({ ok: false, error: "Not found." }, { status: 404 });
    }
    throw error;
  }
  if (!opened) return NextResponse.json({ ok: false, error: "Not found." }, { status: 404 });

  const stored = await statVersion(
    opened.file.eventId,
    opened.file.id,
    opened.version.versionNo,
  );
  if (!stored) {
    return NextResponse.json(
      { ok: false, error: "The entry exists but its bytes are missing from storage." },
      { status: 410 },
    );
  }
  return new Response(openVersion(stored), {
    headers: {
      "content-type": opened.version.mimeType || "application/octet-stream",
      "content-length": String(stored.sizeBytes),
      "content-disposition": `attachment; filename="${safeDownloadName(opened.file.name)}"`,
      "cache-control": "private, no-store",
    },
  });
}

/** PATCH { name? } and/or { folderId? } — rename and/or move. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ fileId: string }> },
) {
  return agentRoute(request, async ({ actor }) => {
    const { fileId } = await params;
    const body = (await request.json().catch(() => null)) as {
      name?: string;
      folderId?: string;
    } | null;
    if (!body) throw new Error("A JSON body is required.");
    const changed: string[] = [];
    if (body.name !== undefined) {
      await renameFile(actor, fileId, body.name);
      changed.push("name");
    }
    if (body.folderId !== undefined) {
      if (!body.folderId) throw new Error("folderId cannot be empty.");
      await moveFile(actor, fileId, body.folderId);
      changed.push("folderId");
    }
    if (changed.length === 0) throw new Error("Pass name and/or folderId.");
    return { changed };
  });
}

/**
 * DELETE — moves to trash, never a hard delete: the bytes stay recoverable
 * for the retention window. An agent told to "delete everything" by an
 * injected message must leave a road back.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ fileId: string }> },
) {
  return agentRoute(request, async ({ actor }) => {
    const { fileId } = await params;
    await trashFile(actor, fileId);
    return { trashed: true, note: "Recoverable from trash during the retention window." };
  });
}
