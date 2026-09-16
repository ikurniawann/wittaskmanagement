import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { appSettings } from "@/db/schema";
import { logActivity } from "@/lib/activity";
import { assertCan, type Actor } from "@/lib/permissions";

// Installation branding. The app ships unbranded: whoever installs it sets
// their own organisation name, and every surface (sidebar, PWA manifest,
// emails, PDF reports, AI prompt) reads from here instead of a hardcoded
// string. Follows the same app_settings accessor pattern as getThresholds().

export interface Branding {
  /** full organisation name, e.g. "Acme Productions" */
  orgName: string;
  /** short lockup shown in the sidebar, e.g. "ACME" */
  orgShortName: string;
  /** what the product itself is called after the org name */
  productName: string;
  /** second line under the product name in the rail head (Owner 2026-09-17) */
  tagline: string;
  /**
   * What the AI assistant is called in the sidebar, page title and its own
   * introduction. Configurable rather than hardcoded (Owner 2026-08-10):
   * RVC calls it "Kintsugi Intelligence", but the open-source default has to
   * stay generic for whoever installs it.
   */
  assistantName: string;
}

export const DEFAULT_BRANDING: Branding = {
  orgName: "Your Organisation",
  orgShortName: "ORG",
  productName: "Backstage",
  tagline: "Task & Reminder",
  assistantName: "AI Assistant",
};

function str(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const clean = value.replaceAll('"', "").trim();
  return clean.length > 0 ? clean : fallback;
}

export async function getBranding(): Promise<Branding> {
  // env provides the first-boot defaults so a fresh install is already
  // branded before anyone opens the admin screen
  const envDefaults: Branding = {
    orgName: process.env.ORG_NAME?.trim() || DEFAULT_BRANDING.orgName,
    orgShortName:
      process.env.ORG_SHORT_NAME?.trim() || DEFAULT_BRANDING.orgShortName,
    productName:
      process.env.PRODUCT_NAME?.trim() || DEFAULT_BRANDING.productName,
    tagline: process.env.PRODUCT_TAGLINE?.trim() || DEFAULT_BRANDING.tagline,
    assistantName:
      process.env.ASSISTANT_NAME?.trim() || DEFAULT_BRANDING.assistantName,
  };

  try {
    const rows = await db
      .select()
      .from(appSettings)
      .where(
        inArray(appSettings.key, [
          "org_name",
          "org_short_name",
          "product_name",
          "product_tagline",
          "assistant_name",
        ]),
      );
    const byKey = new Map(rows.map((r) => [r.key, r.value]));
    return {
      orgName: str(byKey.get("org_name"), envDefaults.orgName),
      orgShortName: str(byKey.get("org_short_name"), envDefaults.orgShortName),
      productName: str(byKey.get("product_name"), envDefaults.productName),
      tagline: str(byKey.get("product_tagline"), envDefaults.tagline),
      assistantName: str(
        byKey.get("assistant_name"),
        envDefaults.assistantName,
      ),
    };
  } catch {
    // never let branding take a page down (e.g. during first boot before
    // migrations have run) — fall back to env/defaults
    return envDefaults;
  }
}

/** "Acme Productions Backstage" — used in emails, PDFs, AI prompt. */
export function fullName(branding: Branding): string {
  return `${branding.orgName} ${branding.productName}`.trim();
}

export async function updateBranding(
  actor: Actor,
  input: Partial<Branding>,
): Promise<void> {
  assertCan(actor, "org.manage");
  const entries: Array<[string, string]> = [];
  if (input.orgName !== undefined) entries.push(["org_name", input.orgName.trim()]);
  if (input.orgShortName !== undefined)
    entries.push(["org_short_name", input.orgShortName.trim()]);
  if (input.productName !== undefined)
    entries.push(["product_name", input.productName.trim()]);
  if (input.tagline !== undefined)
    entries.push(["product_tagline", input.tagline.trim()]);
  if (input.assistantName !== undefined)
    entries.push(["assistant_name", input.assistantName.trim()]);

  for (const [key, value] of entries) {
    if (!value) continue; // empty input means "keep current"
    await db
      .insert(appSettings)
      .values({ key, value })
      .onConflictDoUpdate({
        target: appSettings.key,
        set: { value, updatedAt: new Date() },
      });
  }
  await logActivity({
    actorId: actor.id,
    action: "org.branding_update",
    entity: "org:branding",
    detail: Object.fromEntries(entries),
  });
}
