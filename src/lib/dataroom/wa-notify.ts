import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { dataroomFolders, eventPeople, events, profiles } from "@/db/schema";
import { env } from "@/lib/env";
import { sendWhatsApp } from "@/lib/whatsapp";
import { getWaTemplate } from "@/lib/whatsapp/template-store";
import { firstName, renderTemplate } from "@/lib/whatsapp/templates";

// Tells a project's people that something landed in their document room
// (Owner 2026-08-28).
//
// Recipients are the project's OWN roster (event_people), not everyone in the
// divisions attached to it: every division is attached to every project here,
// so the division route would text the whole company on every upload. The
// roster is the list somebody deliberately put on this project.
//
// Fails soft, like every other notification path: a file that reached the disk
// must not be rolled back because a message could not be delivered.

/** Folder trail from the room's root, e.g. "Marketing Kit / Tumbler". */
async function folderPath(eventId: string, folderId: string): Promise<string> {
  const rows = await db
    .select({
      id: dataroomFolders.id,
      parentId: dataroomFolders.parentId,
      name: dataroomFolders.name,
    })
    .from(dataroomFolders)
    .where(eq(dataroomFolders.eventId, eventId));
  const byId = new Map(rows.map((r) => [r.id, r]));

  const parts: string[] = [];
  const guard = new Set<string>();
  let cursor: string | null = folderId;
  while (cursor && !guard.has(cursor)) {
    guard.add(cursor); // a broken parent chain must not spin here
    const node = byId.get(cursor);
    if (!node) break;
    parts.unshift(node.name);
    cursor = node.parentId;
  }
  return parts.join(" / ") || "the document room";
}

export async function notifyDataroomUpload(input: {
  eventId: string;
  folderId: string;
  fileName: string;
  /** display name of whoever uploaded — a guest's email is fine */
  uploadedBy: string;
  /** never text the person who just did it */
  skipProfileId?: string | null;
}): Promise<void> {
  try {
    const [event] = await db
      .select({ name: events.name })
      .from(events)
      .where(eq(events.id, input.eventId))
      .limit(1);
    if (!event) return;

    const roster = await db
      .select({ userId: eventPeople.userId })
      .from(eventPeople)
      .where(eq(eventPeople.eventId, input.eventId));
    const ids = roster
      .map((r) => r.userId)
      .filter((id) => id !== input.skipProfileId);
    if (ids.length === 0) return;

    const people = await db
      .select({
        id: profiles.id,
        name: profiles.name,
        phone: profiles.phone,
      })
      .from(profiles)
      .where(
        and(
          inArray(profiles.id, ids),
          eq(profiles.whatsappNotifications, true),
          eq(profiles.isActive, true),
        ),
      );

    const [body, folder] = await Promise.all([
      getWaTemplate("dataroom_uploaded"),
      folderPath(input.eventId, input.folderId),
    ]);
    const url = `${env.APP_URL}/events/${input.eventId}/dataroom`;

    for (const person of people) {
      if (!person.phone) continue;
      await sendWhatsApp({
        to: person.phone,
        text: renderTemplate(body, {
          name: firstName(person.name),
          event: event.name,
          file: input.fileName,
          folder,
          by: input.uploadedBy,
          url,
        }),
      });
    }
  } catch (error) {
    console.error("[whatsapp] dataroom upload notice failed:", error);
  }
}
