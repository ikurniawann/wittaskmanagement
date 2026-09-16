// Expanded/collapsed state of the floating rail (WIT UI style, 2026-09-16).
// A tiny external store so the rail can read it with useSyncExternalStore:
// the server renders the collapsed rail, the client re-renders from
// localStorage without a setState-in-effect, and every mounted rail (drawer,
// desktop) sees the same value.

const KEY = "wit.rail.expanded";
const listeners = new Set<() => void>();

export function getRailExpanded(): boolean {
  try {
    const stored = localStorage.getItem(KEY);
    if (stored !== null) return stored === "1";
    // first visit: labels on wide screens, icons on tablets
    return window.matchMedia("(min-width: 1280px)").matches;
  } catch {
    return false;
  }
}

export const getServerRailExpanded = () => false;

export function setRailExpanded(value: boolean) {
  try {
    localStorage.setItem(KEY, value ? "1" : "0");
  } catch {
    // private mode — the choice just does not persist
  }
  listeners.forEach((l) => l());
}

export function subscribeRail(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}
