// Folder-share scoping (EPIC-018 follow-up, Owner 2026-08-27).
//
// A folder link lets an outsider browse ONE folder and everything nested
// under it. The question every request has to answer is "is this thing
// actually inside the shared folder?" — get that wrong and a link to one
// folder quietly opens the whole room. It is pure tree maths, so it lives
// here with its own tests rather than inline in a query.
//
// The tree is read from dataroom_folders (id, parentId). parentId = null is a
// top-level folder in the event's room.

export interface FolderNode {
  id: string;
  parentId: string | null;
  name: string;
}

/**
 * Every folder at or below `rootId`, root included.
 *
 * Walks DOWNWARD from the root rather than upward from each candidate: a
 * corrupted parent chain (a cycle, or a row pointing at a deleted parent)
 * then simply yields a smaller set instead of looping forever or, worse,
 * escaping upward into folders that were never shared. `seen` makes the
 * cycle case terminate.
 */
export function collectSubtreeIds(
  rootId: string,
  folders: FolderNode[],
): Set<string> {
  const childrenOf = new Map<string, string[]>();
  for (const f of folders) {
    if (f.parentId === null) continue;
    const list = childrenOf.get(f.parentId) ?? [];
    list.push(f.id);
    childrenOf.set(f.parentId, list);
  }

  const seen = new Set<string>([rootId]);
  const queue = [rootId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const child of childrenOf.get(current) ?? []) {
      if (seen.has(child)) continue;
      seen.add(child);
      queue.push(child);
    }
  }
  return seen;
}

/** Is `folderId` the shared root, or nested somewhere under it? */
export function isWithinSubtree(
  rootId: string,
  folderId: string | null,
  folders: FolderNode[],
): boolean {
  if (folderId === null) return false;
  return collectSubtreeIds(rootId, folders).has(folderId);
}

/**
 * Trail from the shared root down to `folderId`, for the breadcrumb.
 *
 * Returns null when `folderId` is not inside the subtree — the caller treats
 * that exactly like "not found", so a guessed id reveals nothing about
 * whether it exists elsewhere in the room.
 */
export function breadcrumb(
  rootId: string,
  folderId: string,
  folders: FolderNode[],
): FolderNode[] | null {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const trail: FolderNode[] = [];
  const guard = new Set<string>();

  let cursor: string | null = folderId;
  while (cursor !== null) {
    if (guard.has(cursor)) return null; // cycle
    guard.add(cursor);
    const node: FolderNode | undefined = byId.get(cursor);
    if (!node) return null;
    trail.unshift(node);
    if (cursor === rootId) return trail;
    cursor = node.parentId;
  }
  return null; // walked out of the tree without meeting the root
}
