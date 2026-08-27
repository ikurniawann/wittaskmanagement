import { NextResponse } from "next/server";
import { readSharePass, SHARE_COOKIE } from "@/lib/dataroom/share-session";
import { uploadFromShare } from "@/lib/summary-share/service";

// Guest uploads through a progress link (Owner 2026-08-27).
//
// Every check runs here, on this request: uploadFromShare re-resolves the
// token, confirms the link still carries allowUpload and that the sub-task
// belongs to it. Nothing is trusted from the page that rendered the form.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const url = new URL(request.url);
  const checklistItemId = url.searchParams.get("item") ?? "";
  const name = url.searchParams.get("name") ?? "";
  const declaredSize = Number(request.headers.get("content-length") ?? 0);

  if (!checklistItemId || !name) {
    return NextResponse.json({ error: "Nothing to upload." }, { status: 400 });
  }
  if (!request.body) {
    return NextResponse.json({ error: "Nothing to upload." }, { status: 400 });
  }

  const cookie = request.headers
    .get("cookie")
    ?.split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${SHARE_COOKIE}=`))
    ?.slice(SHARE_COOKIE.length + 1);
  const pass = readSharePass(token, cookie ? decodeURIComponent(cookie) : undefined);

  try {
    const result = await uploadFromShare(
      token,
      { email: pass?.email ?? undefined, passcodeVerified: pass?.passcodeOk },
      {
        checklistItemId,
        name,
        declaredSize,
        mimeType: request.headers.get("content-type") ?? undefined,
        body: request.body,
      },
    );
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    // one shape for every refusal: nothing here says whether the link, the
    // sub-task or the quota was the reason
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Upload failed." },
      { status: 400 },
    );
  }
}
