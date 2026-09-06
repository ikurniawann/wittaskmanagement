import { resolveAiConfig } from "./provider";

// Thin Chat Completions client (EPIC-014). Plain fetch — no SDK dependency;
// we only need streaming chat. Which provider, URL, model and key to use is
// decided by resolveAiConfig() (Settings first, env as the fallback), so
// this file knows nothing about where any of it came from.

/**
 * A multimodal message part. Images are sent as data: URLs so nothing has to
 * be publicly reachable — the assistant's uploads live behind auth.
 */
export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  /** a plain string, or parts when the turn carries images (EPIC-016 T-162) */
  content: string | ContentPart[];
}

export { aiConfigured } from "./provider";

/** Streams assistant text chunks. Throws (with OpenAI's error message) on a
 *  non-OK response so the route can surface a readable failure. */
export async function* streamChat(
  messages: ChatMessage[],
): AsyncGenerator<string> {
  const config = await resolveAiConfig();
  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      stream: true,
    }),
  });

  if (!response.ok || !response.body) {
    let detail = `${response.status}`;
    try {
      const parsed = (await response.json()) as {
        error?: { message?: string };
      };
      detail = parsed.error?.message ?? detail;
    } catch {
      // keep the status code
    }
    throw new Error(`${config.providerName} request failed: ${detail}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    // SSE frames are newline-delimited "data: {...}" lines
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (payload === "[DONE]") return;
      try {
        const parsed = JSON.parse(payload) as {
          choices?: Array<{ delta?: { content?: string } }>;
        };
        const chunk = parsed.choices?.[0]?.delta?.content;
        if (chunk) yield chunk;
      } catch {
        // partial frame — will complete on the next read
      }
    }
  }
}
