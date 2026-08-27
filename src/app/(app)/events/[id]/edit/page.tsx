import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { sessionActor } from "@/lib/auth/session-actor";
import {
  getEvent,
  getEventPeople,
  listAssignablePeople,
} from "@/lib/events/service";
import { wibInputValue } from "@/lib/tasks/dates";
import { can } from "@/lib/permissions";
import { EditEventForm } from "./edit-event-form";

export const metadata: Metadata = { title: "Edit project" };

export default async function EditEventPage({
  params,
}: PageProps<"/events/[id]/edit">) {
  const actor = await sessionActor();
  if (!actor || !can(actor, "event.edit")) redirect("/events");

  const { id } = await params;
  const event = await getEvent(actor, id);
  if (!event) notFound();

  const [people, crew] = await Promise.all([
    listAssignablePeople(actor),
    getEventPeople(actor, id),
  ]);

  return (
    <section className="mx-auto flex w-full max-w-xl flex-col gap-8">
      <h1 className="text-3xl font-semibold tracking-tight">Edit project</h1>
      <EditEventForm
        event={{
          id: event.id,
          name: event.name,
          artists: event.artists,
          venue: event.venue,
          showDateInput: wibInputValue(event.showDate),
          color: event.color,
          hasPoster: Boolean(event.coverImagePath),
        }}
        people={people}
        picId={crew.pic?.id ?? null}
        memberIds={crew.members.map((m) => m.id)}
      />
    </section>
  );
}
