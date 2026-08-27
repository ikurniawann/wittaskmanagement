import { describe, expect, it } from "vitest";
import { publicChecklist, publicTaskRows, type InternalTaskRow } from "./public-view";

const NOW = new Date("2026-08-20T03:00:00Z");

function task(over: Partial<InternalTaskRow> = {}): InternalTaskRow {
  return {
    id: "t1",
    title: "Kirim proposal",
    status: "todo",
    priority: "medium",
    divisionId: "production",
    startDate: null,
    dueDate: new Date("2026-08-25T10:00:00Z"),
    restricted: false,
    ...over,
  };
}

describe("publicTaskRows", () => {
  it("NEVER includes a restricted task", () => {
    const rows = publicTaskRows(
      [task({ id: "open" }), task({ id: "secret", title: "Rahasia", restricted: true })],
      NOW,
    );
    expect(rows).toHaveLength(1);
    expect(rows.map((r) => r.title)).not.toContain("Rahasia");
  });

  it("carries no internal identifiers or people", () => {
    const [row] = publicTaskRows([task()], NOW);
    expect(row).not.toHaveProperty("id");
    expect(row).not.toHaveProperty("restricted");
    expect(Object.keys(row).sort()).toEqual(
      ["divisionId", "dueDate", "overdue", "priority", "startDate", "status", "title"].sort(),
    );
  });

  it("flags an overdue task, but not one that is done", () => {
    const [late] = publicTaskRows([task({ dueDate: new Date("2026-08-10T10:00:00Z") })], NOW);
    expect(late.overdue).toBe(true);
    const [finished] = publicTaskRows(
      [task({ dueDate: new Date("2026-08-10T10:00:00Z"), status: "done" })],
      NOW,
    );
    expect(finished.overdue).toBe(false);
  });

  it("does not call a task due today overdue", () => {
    const [row] = publicTaskRows([task({ dueDate: new Date("2026-08-20T16:00:00Z") })], NOW);
    expect(row.overdue).toBe(false);
  });

  it("sorts by deadline, sinking undated work to the bottom", () => {
    const rows = publicTaskRows(
      [
        task({ id: "c", title: "C", dueDate: null }),
        task({ id: "b", title: "B", dueDate: new Date("2026-09-01T00:00:00Z") }),
        task({ id: "a", title: "A", dueDate: new Date("2026-08-22T00:00:00Z") }),
      ],
      NOW,
    );
    expect(rows.map((r) => r.title)).toEqual(["A", "B", "C"]);
  });
});

describe("publicChecklist", () => {
  it("counts progress and drops everything but title/done/due", () => {
    const out = publicChecklist([
      { id: "i1", title: "Draf", done: true, startDate: null, dueDate: null },
      { id: "i2", title: "Kirim", done: false, startDate: null, dueDate: new Date("2026-08-25T00:00:00Z") },
    ]);
    expect(out).toMatchObject({ done: 1, total: 2, pct: 50 });
    // id joined the shape for the comment button; note nor startDate did not
    expect(Object.keys(out.items[0]).sort()).toEqual(["done", "dueDate", "id", "title"]);
  });

  it("reports no percentage for an empty checklist", () => {
    expect(publicChecklist([]).pct).toBeNull();
  });
});
