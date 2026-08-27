"use server";

import { cookies } from "next/headers";
import { issueSharePass, SHARE_COOKIE } from "@/lib/dataroom/share-session";
import { resolveSummaryShare } from "@/lib/summary-share/service";

export interface GateState {
  error?: string;
  needsPasscode?: boolean;
  needsEmail?: boolean;
  ok?: boolean;
}

/**
 * Same gate as the dataroom's, against the summary links. The pass cookie is
 * shared machinery: it is signed against the token, so one issued here can
 * never open a dataroom link and vice versa.
 */
export async function openSummaryAction(
  _prev: GateState,
  formData: FormData,
): Promise<GateState> {
  const token = String(formData.get("token") ?? "");
  const email = String(formData.get("email") ?? "").trim();
  const passcode = String(formData.get("passcode") ?? "");

  const resolution = await resolveSummaryShare(token, {
    email: email || undefined,
    passcode: passcode || undefined,
  });
  if (!resolution.ok) {
    return {
      error: resolution.message,
      needsPasscode: resolution.needsPasscode,
      needsEmail: resolution.needsEmail,
    };
  }

  const jar = await cookies();
  jar.set(SHARE_COOKIE, issueSharePass(token, resolution.viewerEmail, resolution.passcodeOk), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: `/`,
    maxAge: 2 * 60 * 60,
  });
  return { ok: true };
}
