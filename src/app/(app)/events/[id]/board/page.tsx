import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { KanbanBoard } from "@/components/kanban-board";
import { NewTaskDialog } from "@/components/new-task-dialog";
import { sessionActor } from "@/lib/auth/session-actor";
import { getEvent, listEventDivisions } from "@/lib/events/service";
import { can } from "@/lib/permissions";
import { canRestrictTask, subjectOf } from "@/lib/tasks/visibility";
import {
  listBoardTasks,
  listEventTasks,
  listLabels,
  listMembersForDivisions,
} from "@/lib/tasks/service";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";

export const metadata: Metadata = { title: "Board" };

export default async function BoardPage({
  params,
  searchParams,
}: PageProps<"/events/[id]/board">) {
  const actor = await sessionActor();
  if (!actor) redirect("/login");

  const { id } = await params;
  const event = await getEvent(actor, id);
  if (!event) notFound();

  // board tabs = the divisions ACTIVE ON THIS EVENT, intersected with what
  // the actor may see; "all" combines every visible division in one board
  const eventDivisionList = await listEventDivisions(actor, id);
  const visibleDivisions = eventDivisionList.filter((d) =>
    can(actor, "task.viewDivision", { divisionId: d.id }),
  );
  if (visibleDivisions.length === 0) redirect(`/events/${id}`);

  const sp = await searchParams;
  const requested = typeof sp.division === "string" ? sp.division : undefined;
  const allMode =
    requested === "all" || (!requested && visibleDivisions.length > 1);
  const division = allMode
    ? null
    : (visibleDivisions.find((d) => d.id === requested) ?? visibleDivisions[0]);

  const divisionName = new Map(visibleDivisions.map((d) => [d.id, d.name]));
  const creatableDivisions = visibleDivisions.filter((d) =>
    can(actor, "task.create", { divisionId: d.id }),
  );

  const [tasks, memberRows, labels] = await Promise.all([
    allMode
      ? listEventTasks(actor, id)
      : listBoardTasks(actor, id, division!.id),
    listMembersForDivisions(creatableDivisions.map((d) => d.id)),
    listLabels(),
  ]);
  const { getDependencyBadges } = await import("@/lib/tasks/dependency-engine");
  const depBadges = await getDependencyBadges(tasks);

  const createOptions = creatableDivisions.map((d) => ({
    id: d.id,
    name: d.name,
    members: memberRows
      .filter((m) => m.divisionId === d.id)
      .map((m) => ({ id: m.id, name: m.name })),
  }));

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <PageHeader title={<>{allMode ? "All departments board" : `${division!.name} board`}</>} />
        {createOptions.length > 0 ? (
          <NewTaskDialog
            canRestrictIn={createOptions
              .filter((d) => canRestrictTask(subjectOf(actor), d.id))
              .map((d) => d.id)}
            eventId={id}
            divisions={
              allMode
                ? createOptions
                : createOptions.filter((d) => d.id === division!.id)
            }
            labels={labels}
          />
        ) : null}
      </div>

      <nav className="flex flex-wrap gap-2">
        {visibleDivisions.length > 1 ? (
          <Link
            href={`/events/${id}/board?division=all`}
            className={cn(
              "rounded-sm border px-2.5 py-1 text-[11px] uppercase tracking-wider",
              allMode
                ? "border-foreground font-semibold"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            All departments
          </Link>
        ) : null}
        {visibleDivisions.map((d) => (
          <Link
            key={d.id}
            href={`/events/${id}/board?division=${d.id}`}
            className={cn(
              "rounded-sm border px-2.5 py-1 text-[11px] uppercase tracking-wider",
              !allMode && d.id === division!.id
                ? "border-foreground font-semibold"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {d.name}
          </Link>
        ))}
      </nav>

      <KanbanBoard
        tasks={tasks.map((t) => ({
          id: t.id,
          title: t.title,
          status: t.status,
          priority: t.priority,
          dueDate: t.dueDate?.toISOString() ?? null,
          assignees: t.assignees,
          labels: t.labels,
          divisionName: allMode ? divisionName.get(t.divisionId) : undefined,
          dep: depBadges.get(t.id),
        }))}
      />
    </section>
  );
}
