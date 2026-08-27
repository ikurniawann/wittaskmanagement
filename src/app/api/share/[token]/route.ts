import { NextResponse } from "next/server";
import { safeDownloadName } from "@/lib/dataroom/paths";
import {
  logShareAccess,
  resolveFileWithinFolderShare,
  resolveShare,
} from "@/lib/dataroom/share-service";
import { readSharePass, SHARE_COOKIE } from "@/lib/dataroom/share-session";
import { openVersion, parseRange, statVersion } from "@/lib/dataroom/storage";
import {
  watermarkDecision,
  watermarkImage,
  watermarkPdf,
  watermarkText,
} from "@/lib/dataroom/watermark";
import { getBranding } from "@/lib/org/branding";

// Bytes for an outside visitor (EPIC-018 T-181). The link is re-resolved on
// every request — expiry, revocation and the allowlist are never cached — so
// revoking one stops the next request even mid-session.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const url = new URL(request.url);
  const wantsDownload = url.searchParams.get("download") === "1";

  const cookie = request.headers
    .get("cookie")
    ?.split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${SHARE_COOKIE}=`))
    ?.slice(SHARE_COOKIE.length + 1);
  const pass = readSharePass(token, cookie ? decodeURIComponent(cookie) : undefined);

  const resolution = await resolveShare(token, {
    email: pass?.email ?? undefined,
    passcodeVerified: pass?.passcodeOk,
  });
  if (!resolution.ok) {
    // one shape for every refusal: nothing here confirms a file exists
    return NextResponse.json({ error: resolution.message }, { status: 404 });
  }
  // A folder link streams a file only after the file is proven to live inside
  // the shared folder; ?file= is the visitor's input, so it is checked, never
  // trusted. A missing or outside id is refused in the same shape as a dead
  // link, so probing ids reveals nothing.
  let share;
  if (resolution.kind === "folder") {
    const wanted = url.searchParams.get("file");
    const inner = wanted
      ? await resolveFileWithinFolderShare(resolution.share, wanted)
      : null;
    if (!inner) {
      return NextResponse.json({ error: "This document is unavailable." }, { status: 404 });
    }
    share = inner;
  } else {
    share = resolution.share;
  }

  if (wantsDownload && !share.allowDownload) {
    return NextResponse.json({ error: "Downloading is turned off." }, { status: 403 });
  }

  const stored = await statVersion(share.eventId, share.fileId, share.versionNo);
  if (!stored) {
    return NextResponse.json({ error: "This document is unavailable." }, { status: 410 });
  }

  await logShareAccess(share, wantsDownload ? "download" : "view");

  // A watermarked copy is built per request, so it cannot be streamed or
  // range-served: the bytes do not exist until they are stamped, and their
  // length differs from the stored file. Size is capped at creation time, so
  // "load it into memory" is a bounded promise rather than a hope.
  if (share.watermark) {
    const verdict = watermarkDecision(share.mimeType, stored.sizeBytes);
    if (verdict.ok) {
      const branding = await getBranding();
      const text = watermarkText({
        viewer: share.viewerEmail,
        orgName: branding.orgName,
        at: new Date(),
      });
      const original = Buffer.from(
        await new Response(openVersion(stored)).arrayBuffer(),
      );
      try {
        const stamped =
          verdict.kind === "pdf"
            ? await watermarkPdf(original, text)
            : await watermarkImage(original, text);
        return new NextResponse(new Uint8Array(stamped), {
          status: 200,
          headers: {
            "Content-Type": share.mimeType,
            "Content-Disposition": `${wantsDownload ? "attachment" : "inline"}; filename="${safeDownloadName(share.fileName)}"`,
            "Content-Length": String(stamped.byteLength),
            "Cache-Control": "private, no-store",
            "X-Robots-Tag": "noindex, nofollow",
          },
        });
      } catch (error) {
        // A document that refuses to be stamped (encrypted, malformed) must
        // NOT fall through to the unmarked original — the sender asked for a
        // traceable copy and would never know they did not get one.
        console.error("[dataroom] watermark failed:", error);
        return NextResponse.json(
          { error: "This document could not be prepared for viewing." },
          { status: 500 },
        );
      }
    }
  }

  const range = parseRange(request.headers.get("range"), stored.sizeBytes);
  if (range === "unsatisfiable") {
    return new NextResponse(null, {
      status: 416,
      headers: { "Content-Range": `bytes */${stored.sizeBytes}` },
    });
  }

  const headers: Record<string, string> = {
    "Content-Type": share.mimeType,
    "Content-Disposition": `${wantsDownload ? "attachment" : "inline"}; filename="${safeDownloadName(share.fileName)}"`,
    "Accept-Ranges": "bytes",
    // a shared document must never sit in a shared proxy cache
    "Cache-Control": "private, no-store",
    "X-Robots-Tag": "noindex, nofollow",
  };

  if (range) {
    headers["Content-Range"] = `bytes ${range.start}-${range.end}/${stored.sizeBytes}`;
    headers["Content-Length"] = String(range.end - range.start + 1);
    return new NextResponse(openVersion(stored, range), { status: 206, headers });
  }
  headers["Content-Length"] = String(stored.sizeBytes);
  return new NextResponse(openVersion(stored), { status: 200, headers });
}
