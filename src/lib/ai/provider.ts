import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { appSettings } from "@/db/schema";
import { logActivity } from "@/lib/activity";
import { env } from "@/lib/env";
import { assertCan, type Actor } from "@/lib/permissions";

// Which model provider the assistant talks to, set from Settings →
// Integrations (Owner 2026-09-06). Until now the key lived only in the server
// environment, which meant an SSH session and a redeploy to change it — and a
// message telling an admin to "set OPENAI_API_KEY and redeploy" is not
// something an admin can act on from a phone.
//
// Every provider here speaks the OpenAI Chat Completions shape, so switching
// is a base URL and a model name; DeepSeek is compatible out of the box and
// "custom" covers anything else that is.
//
// The key is stored in app_settings the way the Tessera and Megatix tokens
// already are. It is WRITE-ONLY from the outside: nothing returns it, the UI
// sees its last four characters, and the audit log records that it changed
// and never what it changed to.

export type AiProviderKey = "openai" | "deepseek" | "custom";

export interface AiProviderSpec {
  key: AiProviderKey;
  name: string;
  /** "" for custom: the admin supplies it */
  baseUrl: string;
  defaultModel: string;
}

export const AI_PROVIDERS: readonly AiProviderSpec[] = [
  { key: "openai", name: "OpenAI", baseUrl: "https://api.openai.com/v1", defaultModel: "gpt-5.6" },
  { key: "deepseek", name: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", defaultModel: "deepseek-chat" },
  { key: "custom", name: "Custom (OpenAI-compatible)", baseUrl: "", defaultModel: "" },
];

const KEYS = {
  provider: "ai_provider",
  baseUrl: "ai_base_url",
  model: "ai_model",
  apiKey: "ai_api_key",
} as const;

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Normalise a base URL: https only, no trailing slash, no path traversal. */
export function normaliseBaseUrl(raw: string): string {
  const clean = raw.trim().replace(/\/+$/, "");
  let url: URL;
  try {
    url = new URL(clean);
  } catch {
    throw new Error("The base URL is not a valid URL.");
  }
  if (url.protocol !== "https:") {
    // a key sent over plain http is a key handed to the network
    throw new Error("The base URL must start with https://.");
  }
  return clean;
}

export interface ResolvedAiConfig {
  provider: AiProviderKey;
  providerName: string;
  baseUrl: string;
  model: string;
  apiKey: string;
  /** where the key came from — shown to the admin, never the key itself */
  source: "settings" | "env" | "none";
}

/**
 * What the assistant should use right now. Settings win; the server
 * environment is the fallback so an install configured the old way keeps
 * working; with neither, the assistant is off.
 *
 * Never throws: a database wobble must read as "not configured", not as a
 * crash in the middle of a chat.
 */
export async function resolveAiConfig(): Promise<ResolvedAiConfig> {
  let stored: Partial<Record<keyof typeof KEYS, string>> = {};
  try {
    const rows = await db
      .select()
      .from(appSettings)
      .where(inArray(appSettings.key, Object.values(KEYS)));
    for (const row of rows) {
      const k = (Object.keys(KEYS) as Array<keyof typeof KEYS>).find(
        (name) => KEYS[name] === row.key,
      );
      if (k) stored[k] = str(row.value);
    }
  } catch {
    stored = {};
  }

  if (stored.apiKey) {
    const provider = (AI_PROVIDERS.find((p) => p.key === stored.provider) ?? AI_PROVIDERS[0]);
    return {
      provider: provider.key,
      providerName: provider.name,
      baseUrl: stored.baseUrl || provider.baseUrl || AI_PROVIDERS[0].baseUrl,
      model: stored.model || provider.defaultModel || env.OPENAI_MODEL,
      apiKey: stored.apiKey,
      source: "settings",
    };
  }
  if (env.OPENAI_API_KEY.length > 0) {
    return {
      provider: "openai",
      providerName: "OpenAI",
      baseUrl: AI_PROVIDERS[0].baseUrl,
      model: env.OPENAI_MODEL,
      apiKey: env.OPENAI_API_KEY,
      source: "env",
    };
  }
  return {
    provider: "openai",
    providerName: "OpenAI",
    baseUrl: AI_PROVIDERS[0].baseUrl,
    model: env.OPENAI_MODEL,
    apiKey: "",
    source: "none",
  };
}

export async function aiConfigured(): Promise<boolean> {
  return (await resolveAiConfig()).apiKey.length > 0;
}

/** What the Settings panel shows. The key itself is not in here. */
export interface AiSettingsView {
  provider: AiProviderKey;
  baseUrl: string;
  model: string;
  hasKey: boolean;
  keyTail: string | null;
  source: ResolvedAiConfig["source"];
}

export async function getAiSettingsView(actor: Actor): Promise<AiSettingsView> {
  assertCan(actor, "org.manage");
  const c = await resolveAiConfig();
  return {
    provider: c.provider,
    baseUrl: c.baseUrl,
    model: c.model,
    hasKey: c.apiKey.length > 0,
    keyTail: c.apiKey.length >= 4 ? c.apiKey.slice(-4) : null,
    source: c.source,
  };
}

async function writeSetting(key: string, value: string) {
  await db
    .insert(appSettings)
    .values({ key, value })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });
}

export async function saveAiSettings(
  actor: Actor,
  input: { provider: AiProviderKey; baseUrl: string; model: string; apiKey: string },
): Promise<void> {
  assertCan(actor, "org.manage");
  const spec = AI_PROVIDERS.find((p) => p.key === input.provider);
  if (!spec) throw new Error("Unknown provider.");

  const baseUrl = normaliseBaseUrl(input.baseUrl || spec.baseUrl);
  const model = input.model.trim() || spec.defaultModel;
  if (!model) throw new Error("A model name is required.");

  await writeSetting(KEYS.provider, spec.key);
  await writeSetting(KEYS.baseUrl, baseUrl);
  await writeSetting(KEYS.model, model);
  // an empty key field means "keep the one already stored" — the field is
  // never pre-filled, so a save that only changed the model must not wipe it
  const newKey = input.apiKey.trim();
  if (newKey) await writeSetting(KEYS.apiKey, newKey);

  await logActivity({
    actorId: actor.id,
    action: "ai.settings_update",
    entity: "org:ai",
    // the key is deliberately absent from this record
    detail: { provider: spec.key, baseUrl, model, keyChanged: Boolean(newKey) },
  });
}

export async function clearAiKey(actor: Actor): Promise<void> {
  assertCan(actor, "org.manage");
  await db.delete(appSettings).where(eq(appSettings.key, KEYS.apiKey));
  await logActivity({ actorId: actor.id, action: "ai.key_removed", entity: "org:ai" });
}

/**
 * One tiny non-streaming completion, so an admin learns whether the key,
 * URL and model actually work together before anyone tries to chat. The
 * provider's own error text is returned; the key never is.
 */
export async function testAiConnection(actor: Actor): Promise<{ ok: boolean; message: string }> {
  assertCan(actor, "org.manage");
  const c = await resolveAiConfig();
  if (!c.apiKey) return { ok: false, message: "No API key is set." };
  try {
    const res = await fetch(`${c.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${c.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: c.model,
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 1,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (res.ok) return { ok: true, message: `${c.providerName} answered with model “${c.model}”.` };
    let detail = `HTTP ${res.status}`;
    try {
      const j = (await res.json()) as { error?: { message?: string } };
      detail = j.error?.message ?? detail;
    } catch {
      // keep the status
    }
    return { ok: false, message: `${c.providerName} refused: ${detail}` };
  } catch (e) {
    return { ok: false, message: `Could not reach ${c.baseUrl}: ${e instanceof Error ? e.message : "network error"}` };
  }
}
