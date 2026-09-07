// Tiny external store: "is the Play canvas mounted right now?". The app frame
// reads it so the fullscreen/bare layout stays put while the task peek modal
// (an intercepted /tasks/[id] route) sits on top of the office — without it
// the sidebar and content padding would snap back the moment the URL changes.
// Client-only; never imports three.js.
let active = false;
const listeners = new Set<() => void>();

export function setPlayActive(v: boolean): void {
  if (active === v) return;
  active = v;
  listeners.forEach((l) => l());
}
export function getPlayActive(): boolean {
  return active;
}
export function subscribePlayActive(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
