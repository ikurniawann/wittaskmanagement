import { describe, expect, it } from "vitest";
import { breadcrumb, collectSubtreeIds, isWithinSubtree, type FolderNode } from "./folder-tree";

//  root
//   ├── a
//   │    └── a1
//   └── b
//  outside  (a separate top-level folder, never shared)
const TREE: FolderNode[] = [
  { id: "root", parentId: null, name: "Root" },
  { id: "a", parentId: "root", name: "A" },
  { id: "a1", parentId: "a", name: "A1" },
  { id: "b", parentId: "root", name: "B" },
  { id: "outside", parentId: null, name: "Outside" },
  { id: "outside-child", parentId: "outside", name: "Outside child" },
];

describe("collectSubtreeIds", () => {
  it("includes the root and every descendant, at any depth", () => {
    expect(collectSubtreeIds("root", TREE)).toEqual(new Set(["root", "a", "a1", "b"]));
  });

  it("never reaches a sibling branch", () => {
    const ids = collectSubtreeIds("root", TREE);
    expect(ids.has("outside")).toBe(false);
    expect(ids.has("outside-child")).toBe(false);
  });

  it("a leaf shares only itself", () => {
    expect(collectSubtreeIds("a1", TREE)).toEqual(new Set(["a1"]));
  });

  it("terminates on a cycle instead of hanging", () => {
    const cyclic: FolderNode[] = [
      { id: "x", parentId: "y", name: "X" },
      { id: "y", parentId: "x", name: "Y" },
    ];
    expect(collectSubtreeIds("x", cyclic)).toEqual(new Set(["x", "y"]));
  });
});

describe("isWithinSubtree", () => {
  it("accepts the root itself and a nested folder", () => {
    expect(isWithinSubtree("root", "root", TREE)).toBe(true);
    expect(isWithinSubtree("root", "a1", TREE)).toBe(true);
  });

  it("REFUSES a folder outside the shared branch", () => {
    expect(isWithinSubtree("root", "outside", TREE)).toBe(false);
    expect(isWithinSubtree("root", "outside-child", TREE)).toBe(false);
  });

  it("refuses the parent of the shared folder — a link never opens upward", () => {
    expect(isWithinSubtree("a", "root", TREE)).toBe(false);
  });

  it("refuses an unknown id and a null", () => {
    expect(isWithinSubtree("root", "does-not-exist", TREE)).toBe(false);
    expect(isWithinSubtree("root", null, TREE)).toBe(false);
  });
});

describe("breadcrumb", () => {
  it("runs from the shared root down to the folder", () => {
    expect(breadcrumb("root", "a1", TREE)?.map((f) => f.id)).toEqual(["root", "a", "a1"]);
  });

  it("is just the root when the folder IS the root", () => {
    expect(breadcrumb("root", "root", TREE)?.map((f) => f.id)).toEqual(["root"]);
  });

  it("returns null for a folder outside the subtree, revealing nothing", () => {
    expect(breadcrumb("root", "outside-child", TREE)).toBeNull();
  });

  it("returns null rather than looping on a cycle", () => {
    const cyclic: FolderNode[] = [
      { id: "x", parentId: "y", name: "X" },
      { id: "y", parentId: "x", name: "Y" },
    ];
    expect(breadcrumb("root", "x", cyclic)).toBeNull();
  });
});
