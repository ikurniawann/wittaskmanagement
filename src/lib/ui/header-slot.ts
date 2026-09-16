"use client";

import { createContext, useContext } from "react";

// The header's left half is a slot pages fill with their title (Owner
// 2026-09-17: no empty strip above the page). AppFrame owns the element;
// PageHeader portals into it on md+ and renders inline on phones.
export const HeaderSlotContext = createContext<HTMLElement | null>(null);

export function useHeaderSlot() {
  return useContext(HeaderSlotContext);
}
