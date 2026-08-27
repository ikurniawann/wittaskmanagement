import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { dataroomFolders, eventPeople, events, profiles, tasks } from "@/db/schema";
import { env } from "@/lib/env";
import { sendWhatsApp } from "@/lib/whatsapp";
import { getWaTemplate } from "@/lib/whatsapp/template-store";
import { firstName, renderTemplate } from "@/lib/whatsapp/templates";

// Tells ONE person that something landed in a project's document room
// (Owner 2026-08-28).
//
// One, not the whole roster. The gateway is a linked personal device, not a
// business API: fanning a message out to eight people on every upload is
// exactly the pattern that gets a number restricted, and this install has
// already seen "error 463: account restricted" once.
//
// Who that one person is depends on what the file was filed against:
//   • uploaded against a sub-task  -> that task's Lead/PIC
//   • uploaded straight into a folder -> the project's PIC
// with the project PIC as the fallback either way, and nobody at all if the
// only candidate is the person who just uploaded — they already know.
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
  /** when the file was filed against a sub-task — routes to that task's lead */
  taskId?: string | null;
}): Promise<void> {
  try {
    const [event] = await db
      .select({ name: events.name })
      .from(events)
      .where(eq(events.id, input.eventId))
      .limit(1);
    if (!event) return;

    // the task's lead first, when the upload had a task behind it
    let recipientId: string | null = null;
    if (input.taskId) {
      const [task] = await db
        .select({ leadId: tasks.leadId })
        .from(tasks)
        .where(eq(tasks.id, input.taskId))
        .limit(1);
      recipientId = task?.leadId ?? null;
    }
    if (!recipientId) {
      const [pic] = await db
        .select({ userId: eventPeople.userId })
        .from(eventPeople)
        .where(
          and(eq(eventPeople.eventId, input.eventId), eq(eventPeople.role, "pic")),
        )
        .limit(1);
      recipientId = pic?.userId ?? null;
    }
    if (!recipientId || recipientId === input.skipProfileId) return;

    const people = await db
      .select({
        id: profiles.id,
        name: profiles.name,
        phone: profiles.phone,
      })
      .from(profiles)
      .where(
        and(
          eq(profiles.id, recipientId),
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
