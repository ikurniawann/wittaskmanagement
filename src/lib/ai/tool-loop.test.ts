import { afterEach, describe, expect, it, vi } from "vitest";

// The tool loop in streamChat (Owner 2026-09-06): a turn that comes back as
// tool_calls must run the tool, feed the result back, and only then stream
// the words. Fetch is faked with the SSE frames a provider actually sends.

vi.mock("./provider", () => ({
  resolveAiConfig: async () => ({
    baseUrl: "https://ai.test/v1",
    apiKey: "k",
    model: "m",
    provider: "custom",
  }),
  aiConfigured: async () => true,
}));

import { streamChat, type ChatMessage } from "./openai";

function sse(frames: unknown[]): Response {
  const body = [...frames.map((f) => `data: ${JSON.stringify(f)}\n`), "data: [DONE]\n"].join("\n");
  return new Response(body, { status: 200 });
}

afterEach(() => vi.unstubAllGlobals());

describe("streamChat tool loop", () => {
  it("executes a streamed tool call and answers from its result", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      requests.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      if (requests.length === 1) {
        // name once, arguments in two fragments — the way OpenAI streams it
        return sse([
          { choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "list_tasks", arguments: '{"eventId":' } }] } }] },
          { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"ev-1"}' } }] } }] },
        ]);
      }
      return sse([
        { choices: [{ delta: { content: "Ada 2 task: " } }] },
        { choices: [{ delta: { content: "Stage dan Sound." } }] },
      ]);
    });
    vi.stubGlobal("fetch", fetchMock);

    const run = vi.fn(async () => ({ rows: [{ title: "Stage" }, { title: "Sound" }] }));
    const messages: ChatMessage[] = [{ role: "user", content: "task apa saja?" }];
    let out = "";
    for await (const chunk of streamChat(messages, { tools: [{ type: "function" }], run })) out += chunk;

    expect(out).toBe("Ada 2 task: Stage dan Sound.");
    expect(run).toHaveBeenCalledWith("list_tasks", { eventId: "ev-1" });
    // second request carries the assistant tool_calls turn and the tool result
    const second = requests[1].messages as ChatMessage[];
    expect(second.at(-2)).toMatchObject({ role: "assistant", tool_calls: [{ id: "call_1" }] });
    expect(second.at(-1)).toMatchObject({ role: "tool", tool_call_id: "call_1" });
    expect(JSON.parse(second.at(-1)!.content as string)).toEqual({ rows: [{ title: "Stage" }, { title: "Sound" }] });
    // tools offered on every non-final round
    expect(requests[0]).toHaveProperty("tools");
    expect(requests[0]).toHaveProperty("tool_choice", "auto");
    // the caller's array is left untouched
    expect(messages).toHaveLength(1);
  });

  it("streams plain text unchanged when no tool is requested", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => sse([{ choices: [{ delta: { content: "hi" } }] }])));
    let out = "";
    for await (const c of streamChat([{ role: "user", content: "x" }])) out += c;
    expect(out).toBe("hi");
  });

  it("stops offering tools on the last round so the model must answer", async () => {
    let n = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_u: string, init: RequestInit) => {
        n++;
        const body = JSON.parse(String(init.body)) as { tools?: unknown };
        if (body.tools) {
          return sse([{ choices: [{ delta: { tool_calls: [{ index: 0, id: `c${n}`, function: { name: "search", arguments: "{}" } }] } }] }]);
        }
        return sse([{ choices: [{ delta: { content: "final" } }] }]);
      }),
    );
    let out = "";
    for await (const c of streamChat([{ role: "user", content: "x" }], { tools: [{}], run: async () => ({}), maxRounds: 2 })) out += c;
    expect(out).toBe("final");
    expect(n).toBe(3); // 2 tool rounds + the forced text round
  });
});
