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

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  /** a plain string, or parts when the turn carries images (EPIC-016 T-162) */
  content: string | ContentPart[] | null;
  /** an assistant turn that asked for tools */
  tool_calls?: ToolCall[];
  /** a tool result turn */
  tool_call_id?: string;
}

export interface ToolSupport {
  tools: readonly unknown[];
  /** executes one call; must never throw — return { error } instead */
  run: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  /** rounds of tool use before the model must answer; guards against loops */
  maxRounds?: number;
}

export { aiConfigured } from "./provider";

/**
 * Streams assistant text chunks. Throws (with the provider's error message)
 * on a non-OK response so the route can surface a readable failure.
 *
 * With `tools`, this runs the tool loop (Owner 2026-09-06): the model may
 * answer a turn with tool calls instead of text; those are executed, their
 * results appended as tool messages, and the model is asked again — up to
 * maxRounds — until it produces text, which is streamed as before. Text that
 * arrives alongside a tool call (some providers narrate) is streamed too.
 */
export async function* streamChat(
  messages: ChatMessage[],
  toolSupport?: ToolSupport,
): AsyncGenerator<string> {
  const config = await resolveAiConfig();
  const convo: ChatMessage[] = [...messages];
  const maxRounds = toolSupport?.maxRounds ?? 6;

  for (let round = 0; round <= maxRounds; round++) {
    const lastRound = round === maxRounds;
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: config.model,
        messages: convo,
        stream: true,
        // on the final permitted round the model must answer in words
        ...(toolSupport && !lastRound
          ? { tools: toolSupport.tools, tool_choice: "auto" }
          : {}),
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

    // accumulate tool calls by index: providers stream the name once and the
    // arguments in fragments
    const pending = new Map<number, ToolCall>();
    let sawText = false;
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let finished = false;
    while (!finished) {
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
        if (payload === "[DONE]") {
          finished = true;
          break;
        }
        try {
          const parsed = JSON.parse(payload) as {
            choices?: Array<{
              delta?: {
                content?: string | null;
                tool_calls?: Array<{
                  index: number;
                  id?: string;
                  function?: { name?: string; arguments?: string };
                }>;
              };
            }>;
          };
          const delta = parsed.choices?.[0]?.delta;
          if (delta?.content) {
            sawText = true;
            yield delta.content;
          }
          for (const tc of delta?.tool_calls ?? []) {
            const cur = pending.get(tc.index) ?? {
              id: "",
              type: "function" as const,
              function: { name: "", arguments: "" },
            };
            if (tc.id) cur.id = tc.id;
            if (tc.function?.name) cur.function.name += tc.function.name;
            if (tc.function?.arguments) cur.function.arguments += tc.function.arguments;
            pending.set(tc.index, cur);
          }
        } catch {
          // partial frame — will complete on the next read
        }
      }
    }

    if (pending.size === 0 || !toolSupport) return; // a normal text answer

    // run every requested tool, then go around again with the results
    const calls = [...pending.entries()].sort((a, b) => a[0] - b[0]).map(([, c]) => c);
    convo.push({ role: "assistant", content: sawText ? null : null, tool_calls: calls });
    for (const call of calls) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(call.function.arguments || "{}") as Record<string, unknown>;
      } catch {
        args = {};
      }
      const result = await toolSupport.run(call.function.name, args);
      convo.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(result).slice(0, 60_000),
      });
    }
  }
}
