import { SummaryShareButton } from "@/app/(app)/summary-share/summary-share-button";
import { SubtaskCommentButton } from "@/components/subtask-comment-button";
import {
  commentCountByItem,
  unreadByItem,
} from "@/lib/subtask-comments/service";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AttachmentView } from "@/components/attachment-view";
import { CommentBody } from "@/components/comment-body";
import { LabelChip } from "@/components/label-chip";
import { PriorityPicker } from "@/components/priority-picker";
import { Segmented } from "@/components/segmented";
import {
  AvatarStack,
  PriorityIcon,
  StatusChip,
  UserAvatar,
} from "@/components/task-meta";
import { Button } from "@/components/ui/button";
import { LABEL_COLORS } from "@/lib/label-colors";
import { Input } from "@/components/ui/input";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { profiles } from "@/db/schema";
import { sessionActor } from "@/lib/auth/session-actor";
import { can } from "@/lib/permissions";
import {
  getTaskDetail,
  listDivisionMemberOptions,
} from "@/lib/tasks/service";
import {
  checklistAddAction,
  checklistDeleteAction,
  checklistToggleAction,
  labelAddAction,
  labelRemoveAction,
  watchAction,
} from "../actions";
import { AssigneeManager } from "./assignee-manager";
import { LeadPicker } from "./lead-picker";
import { StatusButtons } from "./status-buttons";
import { AttachmentForm } from "./attachment-form";
import { ChecklistItemDialog } from "./checklist-item-dialog";
import { CommentForm } from "./comment-form";
import { DependencySection } from "./dependency-section";
import { DescriptionEditor } from "./description-editor";
import { EditTaskForm } from "./edit-form";
import { PriorityInline } from "./priority-inline";

const dt = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Jakarta",
});
const dtShort = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  timeZone: "Asia/Jakarta",
});

// Shared between the full page and the peek drawer (T-111).
export async function TaskDetailPanel({
  taskId,
  compact = false,
}: {
  taskId: string;
  compact?: boolean;
}) {
  const actor = await sessionActor();
  if (!actor) redirect("/login");

  const task = await getTaskDetail(actor, taskId);
  if (!task) notFound();

  const canEdit = can(actor, "task.edit", { divisionId: task.divisionId });
  const canAssign = can(actor, "task.assign", { divisionId: task.divisionId });
  const canMove =
    canEdit || can(actor, "task.updateAssigned", { isAssigned: task.isAssigned });

  const members = await listDivisionMemberOptions(task.divisionId);
  // the team's own side of every sub-task conversation
  // the Actor carries rights, not a display name — read it from the profile
  const [me] = await db
    .select({ name: profiles.name })
    .from(profiles)
    .where(eq(profiles.id, actor.id))
    .limit(1);
  const reader = { kind: "member" as const, profileId: actor.id, name: me?.name ?? "Team" };
  const [commentUnread, commentTotals] = await Promise.all([
    unreadByItem(task.id, reader),
    commentCountByItem(task.id),
  ]);
  const watching = task.watcherIds.includes(actor.id);

  return (
    <section className="flex w-full flex-col gap-7">
      <div className="flex flex-col gap-2">
        {!compact ? (
          <Link
            href={`/events/${task.eventId}/board?division=${task.divisionId}`}
            className="text-xs uppercase tracking-wider text-muted-foreground hover:text-foreground"
          >
            ← {task.event?.name ?? "Project"} · board
          </Link>
        ) : (
          <span className="text-xs uppercase tracking-wider text-muted-foreground">
            {task.event?.name} · {task.divisionId}
          </span>
        )}
        <div className="flex items-start justify-between gap-4">
          <h1
            className={
              compact
                ? "text-xl font-semibold leading-tight tracking-tight"
                : "text-3xl font-semibold leading-tight tracking-tight"
            }
          >
            {task.title}
          </h1>
          <div className="flex items-center gap-2">
            {canEdit && !task.restricted ? (
              <SummaryShareButton
                kind="task"
                targetId={task.id}
                targetName={task.title}
                label="Share"
                className="mr-1"
              />
            ) : null}
            {canEdit ? (
              <EditTaskForm
                task={{
                  id: task.id,
                  title: task.title,
                  description: task.description,
                  priority: task.priority,
                  startDate: task.startDate?.toISOString() ?? null,
                  dueDate: task.dueDate?.toISOString() ?? null,
                  recurrence: task.recurrence,
                }}
              />
            ) : null}
            <form action={watchAction}>
              <input type="hidden" name="taskId" value={task.id} />
              <Button variant="ghost" size="sm" type="submit">
                {watching ? "Unwatch" : "Watch"}
              </Button>
            </form>
          </div>
        </div>
        <p className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <StatusChip status={task.status} />
          {canEdit ? (
            <PriorityInline
              taskId={task.id}
              priority={task.priority as "low" | "medium" | "high" | "urgent"}
            />
          ) : (
            <PriorityIcon priority={task.priority} withLabel />
          )}
          {task.dueDate ? <span>due {dt.format(task.dueDate)} WIB</span> : null}
          {task.recurrence !== "none" ? <span>repeats {task.recurrence}</span> : null}
          <AvatarStack users={task.assignees} />
        </p>
      </div>

      {/* status */}
      <StatusButtons taskId={task.id} current={task.status} canMove={canMove} />

      {/* description — wide, always available (Owner request) */}
      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">
          Description
        </h2>
        <DescriptionEditor
          taskId={task.id}
          description={task.description}
          canEdit={canEdit}
        />
      </div>

      {/* assignees — popover manager (Owner request) */}
      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">
          Lead / PIC
        </h2>
        <LeadPicker
          taskId={task.id}
          members={members.map((m) => ({ id: m.id, name: m.name }))}
          leadId={task.leadId}
          canAssign={canAssign}
        />
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">
          Assignees
        </h2>
        <AssigneeManager
          taskId={task.id}
          members={members.map((m) => ({ id: m.id, name: m.name }))}
          assignedIds={task.assignees.map((a) => a.id)}
          canAssign={canAssign}
        />
      </div>

      {/* checklist with progress (Owner request) */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold">
            Checklist
          </h2>
          {task.checklist.length > 0 ? (
            <>
              <span className="text-xs tabular-nums text-muted-foreground">
                {task.checklist.filter((i) => i.done).length}/
                {task.checklist.length}
              </span>
              <div className="h-1.5 max-w-48 flex-1 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-status-done transition-all duration-300"
                  style={{
                    width: `${Math.round(
                      (task.checklist.filter((i) => i.done).length /
                        task.checklist.length) *
                        100,
                    )}%`,
                  }}
                />
              </div>
            </>
          ) : null}
        </div>
        <ul className="flex flex-col divide-y rounded-md border">
          {task.checklist.length === 0 ? (
            <li className="px-3 py-3 text-xs text-muted-foreground">
              No checklist items yet.
            </li>
          ) : (
            task.checklist.map((item) => {
              const overdue =
                !item.done && item.dueDate !== null && item.dueDate < new Date();
              return (
                <li
                  key={item.id}
                  className="flex flex-wrap items-center gap-2.5 px-3 py-2"
                >
                  <form action={checklistToggleAction} className="flex">
                    <input type="hidden" name="itemId" value={item.id} />
                    <input type="hidden" name="taskId" value={task.id} />
                    <button
                      type="submit"
                      disabled={!canMove}
                      aria-label={item.done ? "Mark undone" : "Mark done"}
                      className={
                        "flex size-4.5 items-center justify-center rounded-full border transition-all disabled:pointer-events-none " +
                        (item.done
                          ? "border-status-done bg-status-done text-background"
                          : "hover:border-foreground/50")
                      }
                    >
                      {item.done ? (
                        <span className="text-[10px] leading-none">✓</span>
                      ) : null}
                    </button>
                  </form>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span
                      className={
                        "text-sm " +
                        (item.done ? "text-muted-foreground line-through" : "")
                      }
                    >
                      {item.title}
                    </span>
                    {item.note ? (
                      <span className="line-clamp-2 text-xs text-muted-foreground">
                        {item.note}
                      </span>
                    ) : null}
                  </span>
                  {canMove ? (
                    <ChecklistItemDialog
                      taskId={task.id}
                      item={{
                        id: item.id,
                        title: item.title,
                        note: item.note,
                        startDate: item.startDate?.toISOString() ?? null,
                        dueDate: item.dueDate?.toISOString() ?? null,
                        priority: item.priority,
                      }}
                    />
                  ) : null}
                  <SubtaskCommentButton
                    itemId={item.id}
                    itemTitle={item.title}
                    unread={commentUnread.get(item.id) ?? 0}
                    total={commentTotals.get(item.id) ?? 0}
                  />
                  {item.priority ? <PriorityIcon priority={item.priority} /> : null}
                  {item.startDate || item.dueDate ? (
                    <span
                      className={
                        "text-[11px] tabular-nums " +
                        (overdue ? "text-priority-urgent" : "text-muted-foreground")
                      }
                    >
                      {item.startDate ? dtShort.format(item.startDate) : "…"}
                      {" → "}
                      {item.dueDate ? dtShort.format(item.dueDate) : "…"}
                    </span>
                  ) : null}
                  {canMove ? (
                    <form action={checklistDeleteAction}>
                      <input type="hidden" name="itemId" value={item.id} />
                      <input type="hidden" name="taskId" value={task.id} />
                      <button
                        type="submit"
                        aria-label={`Delete ${item.title}`}
                        className="text-xs text-muted-foreground transition-colors hover:text-destructive"
                      >
                        ×
                      </button>
                    </form>
                  ) : null}
                </li>
              );
            })
          )}
        </ul>
        {canMove ? (
          <form
            action={checklistAddAction}
            className="flex flex-col gap-2.5 rounded-md border bg-muted/30 p-3"
          >
            <input type="hidden" name="taskId" value={task.id} />
            <Input
              name="title"
              required
              placeholder="Add checklist item…"
              className="h-8 text-xs"
            />
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex flex-col gap-1">
                <span className="text-[9px] uppercase tracking-[0.2em] text-muted-foreground">
                  Start
                </span>
                <Input name="startDate" type="date" className="h-8 w-36 text-xs" />
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-[9px] uppercase tracking-[0.2em] text-muted-foreground">
                  Due
                </span>
                <Input name="dueDate" type="date" className="h-8 w-36 text-xs" />
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-[9px] uppercase tracking-[0.2em] text-muted-foreground">
                  Priority
                </span>
                <PriorityPicker allowEmpty compact defaultValue="" />
              </div>
              <Button type="submit" size="sm" variant="outline">
                Add item
              </Button>
            </div>
          </form>
        ) : null}
      </div>

      {/* labels */}
      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">Labels</h2>
        <div className="flex flex-wrap items-center gap-2">
          {task.labels.map((label) => (
            <form action={labelRemoveAction} key={label.id} className="inline-flex">
              <input type="hidden" name="taskId" value={task.id} />
              <input type="hidden" name="labelId" value={label.id} />
              <button
                type="submit"
                disabled={!canEdit}
                title={canEdit ? "Remove label" : undefined}
                className="transition-opacity hover:opacity-70 disabled:pointer-events-none"
              >
                <LabelChip name={`${label.name}${canEdit ? " ×" : ""}`} color={label.color} />
              </button>
            </form>
          ))}
          {canEdit ? (
            <form action={labelAddAction} className="flex items-center gap-2">
              <input type="hidden" name="taskId" value={task.id} />
              <Input name="name" placeholder="Add label…" className="h-8 w-32 text-xs" />
              <Segmented
                name="color"
                defaultValue="blue"
                options={Object.entries(LABEL_COLORS).map(([key, meta]) => ({
                  value: key,
                  label: meta.label,
                  icon: (
                    <span
                      aria-hidden
                      className="size-2 rounded-full"
                      style={{ backgroundColor: meta.dot }}
                    />
                  ),
                }))}
              />
              <Button type="submit" size="sm" variant="outline">
                Add
              </Button>
            </form>
          ) : null}
        </div>
      </div>

      {/* dependencies (EPIC-012: cross-division/event + external waits) */}
      <DependencySection
        taskId={task.id}
        taskEventId={task.eventId}
        canEdit={canEdit}
        blockers={task.blockers}
        dependents={task.dependents}
        externalDeps={task.externalDeps.map((dep) => ({
          id: dep.id,
          label: dep.label,
          party: dep.party,
          resolvedAt: dep.resolvedAt ? dep.resolvedAt.toISOString() : null,
        }))}
      />

      {/* attachments */}
      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">
          Attachments
        </h2>
        <ul className="flex flex-col gap-1 text-sm">
          {task.attachments.map((a) => (
            <li key={a.id}>
              <a href={`/api/files/${a.path}`} className="hover:underline" download={a.fileName}>
                {a.fileName}{" "}
                <span className="text-xs text-muted-foreground">
                  ({Math.ceil(a.size / 1024)} KB)
                </span>
              </a>
            </li>
          ))}
        </ul>
        {canMove ? <AttachmentForm taskId={task.id} /> : null}
      </div>

      {/* comments */}
      <div className="flex flex-col gap-4 border-t pt-6">
        <h2 className="text-sm font-semibold">
          Comments
        </h2>
        <ul className="flex flex-col gap-4">
          {task.comments.map(({ comment, authorName, mentionNames }) => (
            <li key={comment.id} className="flex gap-2.5">
              <UserAvatar
                name={authorName ?? "?"}
                className="mt-0.5 size-7 text-[10px]"
              />
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">
                    {authorName ?? "Unknown"}
                  </span>{" "}
                  · {dt.format(comment.createdAt)} WIB
                </span>
                <CommentBody body={comment.body} mentionNames={mentionNames} />
                {comment.attachmentPath ? (
                  <AttachmentView
                    path={comment.attachmentPath}
                    name={comment.attachmentName}
                  />
                ) : null}
              </div>
            </li>
          ))}
        </ul>
        <CommentForm
          taskId={task.id}
          mentionOptions={members.map((m) => ({ id: m.id, name: m.name }))}
        />
      </div>
    </section>
  );
}
