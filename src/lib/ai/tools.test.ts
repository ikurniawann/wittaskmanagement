import { describe, expect, it, vi } from "vitest";

// Argument validation and the never-throw contract of runAssistantTool —
// the services themselves are covered by their own suites.
vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/lib/tasks/service", () => ({
  listEventTasks: vi.fn(async () => { throw new Error("Forbidden"); }),
  getTaskDetail: vi.fn(async () => null),
  listMyTasks: vi.fn(async () => []),
}));
vi.mock("@/lib/events/service", () => ({ listActiveEvents: vi.fn(), listEventDivisions: vi.fn(), listEventPeople: vi.fn() }));
vi.mock("@/lib/search/service", () => ({ globalSearch: vi.fn(async () => ({ hits: 1 })) }));
vi.mock("@/lib/dataroom/service", () => ({ listFilesForAssistant: vi.fn() }));
vi.mock("@/lib/subtask-comments/service", () => ({ listThread: vi.fn() }));

import { ASSISTANT_TOOLS, runAssistantTool } from "./tools";

const actor = { id: "u1", role: "owner", memberships: [] } as never;

describe("runAssistantTool", () => {
  it("rejects a missing required argument with a readable error", async () => {
    expect(await runAssistantTool(actor, "list_tasks", {})).toEqual({ error: "eventId is required" });
    expect(await runAssistantTool(actor, "get_task", {})).toEqual({ error: "taskId is required" });
    expect(await runAssistantTool(actor, "search", { query: "a" })).toEqual({ error: "query too short" });
  });
  it("turns a service refusal into { error } instead of throwing", async () => {
    expect(await runAssistantTool(actor, "list_tasks", { eventId: "ev" })).toEqual({ error: "Forbidden" });
    expect(await runAssistantTool(actor, "get_task", { taskId: "t" })).toEqual({ error: "task not found or not visible to you" });
  });
  it("names an unknown tool", async () => {
    expect(await runAssistantTool(actor, "drop_tables", {})).toEqual({ error: "unknown tool drop_tables" });
  });
  it("declares every tool the executor handles, read-only names only", () => {
    const names = ASSISTANT_TOOLS.map((t) => t.function.name);
    expect(names).toEqual(["list_projects", "list_tasks", "get_task", "my_tasks", "search", "list_documents", "list_people", "subtask_conversation"]);
    expect(names.some((n) => /create|update|delete|set/.test(n))).toBe(false);
  });
});
