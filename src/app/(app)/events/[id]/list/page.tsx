import { ShareOpensBadge } from "@/components/share-opens-badge";
import { shareOpensByTask } from "@/lib/summary-share/service";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { Lock } from "lucide-react";
import { DependencyBadge } from "@/components/dependency-badge";
import { LabelChip } from "@/components/label-chip";
import {
  AvatarStack,
  PriorityIcon,
  StatusDot,
  STATUS_TEXT,
} from "@/components/task-meta";
import { NewTaskDialog } from "@/components/new-task-dialog";
import { canRestrictTask, subjectOf } from "@/lib/tasks/visibility";
import { StatusDropGroup, TaskDragRow } from "./list-dnd";
import { GridView } from "./grid-view";
import { ListViewToggle } from "@/components/list-view-toggle";
import { sessionActor } from "@/lib/auth/session-actor";
import { getEvent, listEventDivisions } from "@/lib/events/service";
import { listDivisions } from "@/lib/org/service";
import { can, PermissionError } from "@/lib/permissions";
import {
  deleteFilter,
  listEventTasks,
  listLabels,
  listMembersForDivisions,
  listSavedFilters,
  saveFilter,
  TASK_STATUS_ORDER,
  type ListFilters,
  type TaskStatus,
} from "@/lib/tasks/service";
import { ListControls } from "./list-controls";

export const metadata: Metadata = { title: "Task list" };

const dt = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  timeZone: "Asia/Jakarta",
});

type SortKey = "due" | "priority" | "title" | "created";

const PRIORITY_RANK = { urgent: 0, high: 1, medium: 2, low: 3 } as const;

// Plane-style list (Owner request): grouped by status with counts, free sort.
export default async function TaskListPage({
  params,
  searchParams,
}: PageProps<"/events/[id]/list">) {
  const actor = await sessionActor();
  if (!actor) redirect("/login");

  const { id } = await params;
  const event = await getEvent(actor, id);
  if (!event) notFound();

  const sp = await searchParams;
  const str = (key: string) =>
    typeof sp[key] === "string" && sp[key] ? (sp[key] as string) : undefined;

  const view = str("view") === "grid" ? "grid" : "list";
  const sort = (str("sort") as SortKey) ?? "due";
  const dir = str("dir") === "desc" ? "desc" : "asc";
  const filters: ListFilters = {
    priority: str("priority") as ListFilters["priority"],
    divisionId: str("division"),
    status: str("status") as TaskStatus | undefined,
  };

  const [tasks, divisions, saved, eventDivisionList, labels, shareOpens] =
    await Promise.all([
    listEventTasks(actor, id, {
      priority: filters.priority,
      divisionId: filters.divisionId,
    }),
    listDivisions(),
    listSavedFilters(actor),
    listEventDivisions(actor, id),
    listLabels(),
      shareOpensByTask(actor, id),
  ]);
  const divisionName = new Map(divisions.map((d) => [d.id, d.name]));

  // divisions the actor may create tasks in, with their members
  const creatableDivisions = eventDivisionList.filter((d) =>
    can(actor, "task.create", { divisionId: d.id }),
  );
  const memberRows = await listMembersForDivisions(
    creatableDivisions.map((d) => d.id),
  );
  const createOptions = creatableDivisions.map((d) => ({
    id: d.id,
    name: d.name,
    members: memberRows
      .filter((m) => m.divisionId === d.id)
      .map((m) => ({ id: m.id, name: m.name })),
  }));

  const sorted = [...tasks].sort((a, b) => {
    let cmp = 0;
    if (sort === "due") {
      cmp =
        (a.dueDate?.getTime() ?? Infinity) - (b.dueDate?.getTime() ?? Infinity);
    } else if (sort === "priority") {
      cmp = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    } else if (sort === "title") {
      cmp = a.title.localeCompare(b.title);
    } else {
      cmp = a.createdAt.getTime() - b.createdAt.getTime();
    }
    return dir === "desc" ? -cmp : cmp;
  });

  const groups = (
    filters.status ? [filters.status] : TASK_STATUS_ORDER
  ).map((status) => ({
    status,
    items: sorted.filter((t) => t.status === status),
  }));

  const { getDependencyBadges } = await import("@/lib/tasks/dependency-engine");
  const depBadges = await getDependencyBadges(sorted);


  async function saveFilterAction(formData: FormData) {
    "use server";
    const actorInner = await sessionActor();
    if (!actorInner) throw new PermissionError("task.viewDivision");
    const name = String(formData.get("name") ?? "").trim();
    if (!name) return;
    await saveFilter(actorInner, name, {
      priority:
        (String(formData.get("priority") ?? "") as ListFilters["priority"]) ||
        undefined,
      divisionId: String(formData.get("division") ?? "") || undefined,
      status: (String(formData.get("status") ?? "") as TaskStatus) || undefined,
    });
    revalidatePath(`/events/${id}/list`);
  }

  async function deleteFilterAction(formData: FormData) {
    "use server";
    const actorInner = await sessionActor();
    if (!actorInner) throw new PermissionError("task.viewDivision");
    await deleteFilter(actorInner, String(formData.get("filterId")));
    revalidatePath(`/events/${id}/list`);
  }

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            Task list
          </h1>
        </div>
        <div className="flex items-center gap-2">
          {/* outside the create gate: someone who may only read still
              chooses how they read */}
          <ListViewToggle basePath={`/events/${id}/list`} active={view} />
          {createOptions.length > 0 ? (
          <NewTaskDialog
            canRestrictIn={createOptions
              .filter((d) => canRestrictTask(subjectOf(actor), d.id))
              .map((d) => d.id)}
            eventId={id}
            divisions={createOptions}
            defaultDivisionId={filters.divisionId}
            labels={labels}
          />
          ) : null}
        </div>
      </div>

      {/* Plane-style compact toolbar: filters & display behind popovers */}
      <ListControls
        basePath={`/events/${id}/list`}
        params={{
          sort,
          dir,
          division: filters.divisionId,
          priority: filters.priority,
        }}
        divisions={divisions.map((d) => ({ id: d.id, name: d.name }))}
        savedViews={saved.map((f) => {
          const p = f.params as ListFilters;
          const q = new URLSearchParams();
          if (p.status) q.set("status", p.status);
          if (p.priority) q.set("priority", p.priority);
          if (p.divisionId) q.set("division", p.divisionId);
          return {
            id: f.id,
            name: f.name,
            href: `/events/${id}/list?${q.toString()}`,
          };
        })}
        saveAction={saveFilterAction}
        deleteAction={deleteFilterAction}
      />

      {view === "grid" ? (
        <GridView
          tasks={sorted.map((task) => ({
            id: task.id,
            title: task.title,
            status: task.status,
            priority: task.priority,
            dueDate: task.dueDate ? task.dueDate.toISOString() : null,
            divisionId: task.divisionId,
            leadId: task.leadId,
            assignees: task.assignees,
            canEdit: can(actor, "task.edit", { divisionId: task.divisionId }),
            shareOpens: shareOpens.get(task.id) ?? null,
          }))}
          divisionName={Object.fromEntries(divisionName)}
          people={Object.fromEntries(
            createOptions.map((d) => [d.id, d.members]),
          )}
        />
      ) : (
      /* status groups, Plane-style */
      <div className="flex flex-col gap-5">
        {groups.map(({ status, items }) => (
          <StatusDropGroup key={status} status={status}>
            <div className="flex items-center gap-2.5 px-1">
              <StatusDot status={status} className="size-2.5" />
              <h2 className="text-sm font-semibold">{STATUS_TEXT[status]}</h2>
              <span className="rounded-full bg-muted px-2 text-[11px] tabular-nums text-muted-foreground">
                {items.length}
              </span>
            </div>
            {items.length === 0 ? (
              <p className="rounded-md border border-dashed px-4 py-3 text-xs text-muted-foreground">
                No tasks.
              </p>
            ) : (
              <ul className="flex flex-col divide-y rounded-md border bg-card elev">
                {items.map((task) => (
                  <TaskDragRow key={task.id} taskId={task.id}>
                    <Link
                      href={`/tasks/${task.id}`}
                      className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm transition-colors hover:bg-accent/50"
                    >
                      <PriorityIcon priority={task.priority} />
                      <span className="min-w-0 flex-1 truncate font-medium">
                        {task.title}
                      </span>
                      {task.restricted ? (
                        // whoever can see this row is entitled to; the mark is
                        // so its own division knows it is not on show
                        <Lock
                          className="size-3.5 shrink-0 text-muted-foreground"
                          aria-label="Kept inside its division"
                        />
                      ) : null}
                      {task.labels.map((label) => (
                        <LabelChip
                          key={label.id}
                          name={label.name}
                          color={label.color}
                          className="hidden sm:inline-flex"
                        />
                      ))}
                      {depBadges.has(task.id) ? (
                        <DependencyBadge {...depBadges.get(task.id)!} />
                      ) : null}
                      {shareOpens.has(task.id) ? (
                        <ShareOpensBadge {...shareOpens.get(task.id)!} />
                      ) : null}
                      <span className="hidden text-xs text-muted-foreground md:block">
                        {divisionName.get(task.divisionId)}
                      </span>
                      <AvatarStack users={task.assignees} />
                      <span className="w-14 text-right text-xs tabular-nums text-muted-foreground">
                        {task.dueDate ? dt.format(task.dueDate) : "—"}
                      </span>
                    </Link>
                  </TaskDragRow>
                ))}
              </ul>
            )}
          </StatusDropGroup>
        ))}
      </div>
      )}
    </section>
  );
}
