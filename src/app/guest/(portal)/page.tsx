import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  attachmentAction,
  commentAction,
  updateStatusAction,
} from "@/app/(app)/tasks/actions";
import { Countdown } from "@/components/countdown";
import { PriorityIcon, StatusChip } from "@/components/task-meta";
import { Button } from "@/components/ui/button";
import { auth } from "@/lib/auth";
import { FORM_DEFINITIONS, type FormType } from "@/lib/external/forms";
import {
  getGuestContext,
  listGuestSubmissions,
  listGuestTasks,
} from "@/lib/external/service";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Guest portal" };

const dt = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeZone: "Asia/Jakarta",
});

const SUBMISSION_META: Record<string, { label: string; className: string }> = {
  missing: { label: "Not started", className: "text-muted-foreground" },
  draft: { label: "Draft", className: "text-status-in-progress" },
  submitted: { label: "Submitted — in review", className: "text-status-todo" },
  accepted: { label: "Accepted", className: "text-status-done" },
  changes_requested: { label: "Changes requested", className: "text-status-blocked" },
};

const GUEST_STATUSES = ["todo", "in_progress", "in_review", "done"] as const;

export default async function GuestHome() {
  const session = await auth();
  if (!session?.user?.id) redirect("/guest/login");
  const context = await getGuestContext(session.user.id);
  if (!context) redirect("/guest/login");

  const [tasks, submissions] = await Promise.all([
    listGuestTasks(session.user.id, context.invite.eventId),
    listGuestSubmissions(session.user.id, context.invite.id),
  ]);
  const requestedForms = context.invite.requestedForms as FormType[];
  const submissionByType = new Map(submissions.map((s) => [s.type, s]));

  async function guestComment(formData: FormData) {
    "use server";
    await commentAction({}, formData);
  }
  async function guestAttach(formData: FormData) {
    "use server";
    await attachmentAction({}, formData);
  }

  return (
    <section className="flex flex-col gap-10">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold leading-tight tracking-tight">
          {context.eventName}
        </h1>
        <p className="text-sm text-muted-foreground">
          Collaborating with {context.divisionName}
        </p>
        <div className="flex flex-col gap-1 pt-2">
          <span className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
            To launch day
          </span>
          <Countdown target={context.showDate.toISOString()} className="text-2xl" />
        </div>
      </div>

      {/* requested forms */}
      {requestedForms.length > 0 ? (
        <div className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold">
            Requested forms
          </h2>
          <ul className="grid gap-3 sm:grid-cols-2">
            {requestedForms.map((type) => {
              const submission = submissionByType.get(type);
              const meta = SUBMISSION_META[submission?.status ?? "missing"];
              const definition = FORM_DEFINITIONS[type];
              const editable =
                !submission ||
                ["draft", "changes_requested"].includes(submission.status);
              return (
                <li
                  key={type}
                  className="flex flex-col gap-2 rounded-lg border bg-card p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="font-medium">{definition.title}</span>
                    <span className={cn("text-xs font-medium", meta.className)}>
                      {meta.label}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {definition.description}
                  </p>
                  {submission?.status === "changes_requested" &&
                  submission.reviewNote ? (
                    <p className="rounded-md border bg-muted/40 px-3 py-2 text-xs">
                      “{submission.reviewNote}”
                    </p>
                  ) : null}
                  <div>
                    <Link
                      href={`/guest/forms/${type}`}
                      className="text-xs font-medium uppercase tracking-wider underline-offset-4 hover:underline"
                    >
                      {editable ? "Open form ↗" : "View ↗"}
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {/* assigned tasks */}
      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">
          Your tasks
        </h2>
        {tasks.length === 0 ? (
          <p className="rounded-md border bg-card px-4 py-6 text-sm text-muted-foreground">
            Nothing assigned to you yet.
          </p>
        ) : (
          <ul className="flex flex-col gap-4">
            {tasks.map((task) => (
              <li
                key={task.id}
                className="flex flex-col gap-3 rounded-lg border bg-card p-4"
              >
                <div className="flex flex-wrap items-center gap-3">
                  <PriorityIcon priority={task.priority} />
                  <span className="min-w-0 flex-1 font-medium">{task.title}</span>
                  <StatusChip status={task.status} />
                  {task.dueDate ? (
                    <span className="text-xs tabular-nums text-muted-foreground">
                      due {dt.format(task.dueDate)}
                    </span>
                  ) : null}
                </div>
                {task.description ? (
                  <p className="text-sm text-muted-foreground">{task.description}</p>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  {GUEST_STATUSES.map((status) => (
                    <form action={updateStatusAction} key={status}>
                      <input type="hidden" name="taskId" value={task.id} />
                      <input type="hidden" name="status" value={status} />
                      <Button
                        type="submit"
                        size="sm"
                        variant={task.status === status ? "default" : "outline"}
                        disabled={task.status === status}
                      >
                        {status.replaceAll("_", " ")}
                      </Button>
                    </form>
                  ))}
                </div>
                <div className="flex flex-col gap-2 border-t pt-3 sm:flex-row sm:items-start">
                  <form action={guestComment} className="flex flex-1 gap-2">
                    <input type="hidden" name="taskId" value={task.id} />
                    <input
                      name="body"
                      placeholder="Leave an update…"
                      className="border-input h-9 flex-1 rounded-md border bg-transparent px-3 text-sm outline-none"
                    />
                    <Button type="submit" size="sm" variant="outline">
                      Send
                    </Button>
                  </form>
                  <form action={guestAttach} className="flex gap-2">
                    <input type="hidden" name="taskId" value={task.id} />
                    <input
                      type="file"
                      name="file"
                      className="w-48 text-xs file:mr-2 file:rounded-md file:border file:bg-transparent file:px-2 file:py-1 file:text-xs"
                    />
                    <Button type="submit" size="sm" variant="outline">
                      Upload
                    </Button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
