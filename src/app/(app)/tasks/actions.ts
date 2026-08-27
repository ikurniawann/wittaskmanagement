"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { sessionActor } from "@/lib/auth/session-actor";
import { PermissionError } from "@/lib/permissions";
import {
  addAttachment,
  addChecklistItem,
  addComment,
  deleteChecklistItem,
  addDependency,
  addExternalDependency,
  deleteExternalDependency,
  removeDependency,
  setExternalDependencyResolved,
  setTaskLead,
  addLabelToTask,
  assignUser,
  createTask,
  decideHandoff,
  removeLabelFromTask,
  requestHandoff,
  toggleChecklistItem,
  toggleWatch,
  unassignUser,
  updateChecklistItem,
  updateStatus,
  updateTaskFields,
  type TaskStatus,
} from "@/lib/tasks/service";
import { saveFileUpload } from "@/lib/uploads";

export interface TaskActionState {
  error?: string;
}

async function requireActor() {
  const actor = await sessionActor();
  if (!actor) throw new PermissionError("task.viewDivision");
  return actor;
}

function friendly(error: unknown): TaskActionState {
  if (error instanceof PermissionError) return { error: "Not allowed." };
  if (error instanceof Error) return { error: error.message };
  throw error;
}

export async function createTaskAction(
  _prev: TaskActionState,
  formData: FormData,
): Promise<TaskActionState> {
  let taskId: string;
  try {
    const actor = await requireActor();
    const startRaw = String(formData.get("startDate") ?? "");
    const dueRaw = String(formData.get("dueDate") ?? "");
    const task = await createTask(actor, {
      eventId: String(formData.get("eventId")),
      divisionId: String(formData.get("divisionId")),
      title: String(formData.get("title") ?? "").trim(),
      description: String(formData.get("description") ?? ""),
      priority: (String(formData.get("priority")) || "medium") as
        | "low"
        | "medium"
        | "high"
        | "urgent",
      startDate: startRaw ? new Date(startRaw) : undefined,
      dueDate: dueRaw ? new Date(dueRaw) : undefined,
      recurrence: (String(formData.get("recurrence")) || "none") as
        | "none"
        | "daily"
        | "weekly"
        | "monthly",
      leadId: String(formData.get("leadId") ?? "") || undefined,
      restricted: formData.get("restricted") === "on",
      assigneeIds: formData.getAll("assignees").map(String).filter(Boolean),
      labelIds: formData.getAll("labels").map(String).filter(Boolean),
      newLabel: String(formData.get("newLabelName") ?? "").trim()
        ? {
            name: String(formData.get("newLabelName")),
            color: String(formData.get("newLabelColor") || "slate"),
          }
        : undefined,
    });
    taskId = task.id;
  } catch (error) {
    return friendly(error);
  }
  revalidatePath("/my-tasks");
  redirect(`/tasks/${taskId}`);
}

/**
 * Status via drag-and-drop on the list page (Owner 2026-08-12). Returns the
 * error instead of throwing, so a refused drop — a sealed task, a division
 * the actor cannot edit — surfaces as a toast rather than a dead gesture.
 */
export async function setStatusAction(
  _prev: TaskActionState,
  formData: FormData,
): Promise<TaskActionState> {
  try {
    const actor = await requireActor();
    const taskId = String(formData.get("taskId"));
    const status = String(formData.get("status"));
    await updateStatus(actor, taskId, status as TaskStatus);
    revalidatePath(`/tasks/${taskId}`);
    revalidatePath("/my-tasks");
    return {};
  } catch (error) {
    return friendly(error);
  }
}

export async function updateStatusAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const taskId = String(formData.get("taskId"));
  await updateStatus(actor, taskId, String(formData.get("status")) as TaskStatus);
  revalidatePath(`/tasks/${taskId}`);
  revalidatePath("/my-tasks");
}

/**
 * Priority alone, editable in place (Owner 2026-08-12). Not routed through
 * updateFieldsAction, which writes every field it is given — called with only
 * a priority it would blank the title and description.
 */
export async function setPriorityAction(
  _prev: TaskActionState,
  formData: FormData,
): Promise<TaskActionState> {
  try {
    const actor = await requireActor();
    const taskId = String(formData.get("taskId"));
    const priority = String(formData.get("priority"));
    if (!["low", "medium", "high", "urgent"].includes(priority)) {
      return { error: "Unknown priority." };
    }
    await updateTaskFields(actor, taskId, {
      priority: priority as "low" | "medium" | "high" | "urgent",
    });
    revalidatePath(`/tasks/${taskId}`);
    return {};
  } catch (error) {
    return friendly(error);
  }
}

/**
 * One narrow action per cell for the grid (Owner 2026-08-12). Deliberately
 * NOT routed through updateFieldsAction, which writes every field it is
 * given: called with a single cell's value it would blank the rest of the
 * task. Each returns its error instead of throwing, so a refused edit
 * becomes a toast in the cell rather than a dead click.
 */
export async function setDueDateAction(
  _prev: TaskActionState,
  formData: FormData,
): Promise<TaskActionState> {
  try {
    const actor = await requireActor();
    const taskId = String(formData.get("taskId"));
    const raw = String(formData.get("dueDate") ?? "").trim();
    await updateTaskFields(actor, taskId, {
      dueDate: raw ? new Date(raw) : null,
    });
    revalidatePath(`/tasks/${taskId}`);
    return {};
  } catch (error) {
    return friendly(error);
  }
}

export async function setTitleAction(
  _prev: TaskActionState,
  formData: FormData,
): Promise<TaskActionState> {
  try {
    const actor = await requireActor();
    const taskId = String(formData.get("taskId"));
    const title = String(formData.get("title") ?? "").trim();
    if (!title) return { error: "A task needs a title." };
    await updateTaskFields(actor, taskId, { title });
    revalidatePath(`/tasks/${taskId}`);
    return {};
  } catch (error) {
    return friendly(error);
  }
}

/** Grid variant: the drawer's setLeadAction throws on refusal, which is
 *  right for a form submit and wrong for a cell — this one reports. */
export async function setLeadCellAction(
  _prev: TaskActionState,
  formData: FormData,
): Promise<TaskActionState> {
  try {
    const actor = await requireActor();
    const taskId = String(formData.get("taskId"));
    const userId = String(formData.get("userId") ?? "").trim();
    await setTaskLead(actor, taskId, userId || null);
    revalidatePath(`/tasks/${taskId}`);
    return {};
  } catch (error) {
    return friendly(error);
  }
}

export async function updateFieldsAction(
  _prev: TaskActionState,
  formData: FormData,
): Promise<TaskActionState> {
  try {
    const actor = await requireActor();
    const taskId = String(formData.get("taskId"));
    const startRaw = String(formData.get("startDate") ?? "");
    const dueRaw = String(formData.get("dueDate") ?? "");
    await updateTaskFields(actor, taskId, {
      title: String(formData.get("title") ?? "").trim(),
      description: String(formData.get("description") ?? ""),
      priority: String(formData.get("priority")) as
        | "low"
        | "medium"
        | "high"
        | "urgent",
      startDate: startRaw ? new Date(startRaw) : null,
      dueDate: dueRaw ? new Date(dueRaw) : null,
      recurrence: String(formData.get("recurrence")) as
        | "none"
        | "daily"
        | "weekly"
        | "monthly",
    });
    revalidatePath(`/tasks/${taskId}`);
    return {};
  } catch (error) {
    return friendly(error);
  }
}

export async function assignAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const taskId = String(formData.get("taskId"));
  await assignUser(actor, taskId, String(formData.get("userId")));
  revalidatePath(`/tasks/${taskId}`);
}

export async function unassignAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const taskId = String(formData.get("taskId"));
  await unassignUser(actor, taskId, String(formData.get("userId")));
  revalidatePath(`/tasks/${taskId}`);
}

export async function watchAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const taskId = String(formData.get("taskId"));
  await toggleWatch(actor, taskId);
  revalidatePath(`/tasks/${taskId}`);
}

export async function checklistAddAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const taskId = String(formData.get("taskId"));
  const title = String(formData.get("title") ?? "").trim();
  if (title) {
    const startRaw = String(formData.get("startDate") ?? "");
    const dueRaw = String(formData.get("dueDate") ?? "");
    const priorityRaw = String(formData.get("priority") ?? "");
    await addChecklistItem(actor, taskId, {
      title,
      startDate: startRaw ? new Date(`${startRaw}T00:00:00+07:00`) : undefined,
      dueDate: dueRaw ? new Date(`${dueRaw}T23:59:59+07:00`) : undefined,
      priority: priorityRaw
        ? (priorityRaw as "low" | "medium" | "high" | "urgent")
        : undefined,
    });
  }
  revalidatePath(`/tasks/${taskId}`);
}

export async function checklistUpdateAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const taskId = String(formData.get("taskId"));
  const startRaw = String(formData.get("startDate") ?? "");
  const dueRaw = String(formData.get("dueDate") ?? "");
  const priorityRaw = String(formData.get("priority") ?? "");
  await updateChecklistItem(actor, String(formData.get("itemId")), {
    title: String(formData.get("title") ?? ""),
    note: String(formData.get("note") ?? ""),
    startDate: startRaw ? new Date(`${startRaw}T00:00:00+07:00`) : null,
    dueDate: dueRaw ? new Date(`${dueRaw}T23:59:59+07:00`) : null,
    priority: priorityRaw
      ? (priorityRaw as "low" | "medium" | "high" | "urgent")
      : null,
  });
  revalidatePath(`/tasks/${taskId}`);
}

export async function taskDescriptionAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const taskId = String(formData.get("taskId"));
  await updateTaskFields(actor, taskId, {
    description: String(formData.get("description") ?? ""),
  });
  revalidatePath(`/tasks/${taskId}`);
}

export async function checklistDeleteAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const taskId = String(formData.get("taskId"));
  await deleteChecklistItem(actor, String(formData.get("itemId")));
  revalidatePath(`/tasks/${taskId}`);
}

export async function checklistToggleAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  await toggleChecklistItem(actor, String(formData.get("itemId")));
  revalidatePath(`/tasks/${String(formData.get("taskId"))}`);
}

export async function labelAddAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const taskId = String(formData.get("taskId"));
  await addLabelToTask(
    actor,
    taskId,
    String(formData.get("name") ?? ""),
    String(formData.get("color") || "slate"),
  );
  revalidatePath(`/tasks/${taskId}`);
}

export async function labelRemoveAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const taskId = String(formData.get("taskId"));
  await removeLabelFromTask(actor, taskId, String(formData.get("labelId")));
  revalidatePath(`/tasks/${taskId}`);
}

export async function dependencyAddAction(
  _prev: TaskActionState,
  formData: FormData,
): Promise<TaskActionState> {
  try {
    const actor = await requireActor();
    const taskId = String(formData.get("taskId"));
    await addDependency(actor, taskId, String(formData.get("dependsOnTaskId")));
    revalidatePath(`/tasks/${taskId}`);
    return {};
  } catch (error) {
    return friendly(error);
  }
}

export async function setLeadAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const taskId = String(formData.get("taskId"));
  const userId = String(formData.get("userId") ?? "");
  await setTaskLead(actor, taskId, userId || null);
  revalidatePath(`/tasks/${taskId}`);
}

export async function dependencyRemoveAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const taskId = String(formData.get("taskId"));
  await removeDependency(actor, taskId, String(formData.get("dependsOnTaskId")));
  revalidatePath(`/tasks/${taskId}`);
}

export async function externalDepAddAction(
  _prev: TaskActionState,
  formData: FormData,
): Promise<TaskActionState> {
  try {
    const actor = await requireActor();
    const taskId = String(formData.get("taskId"));
    await addExternalDependency(actor, {
      taskId,
      label: String(formData.get("label") ?? ""),
      party: String(formData.get("party") ?? ""),
      note: String(formData.get("note") ?? ""),
    });
    revalidatePath(`/tasks/${taskId}`);
    return {};
  } catch (error) {
    return friendly(error);
  }
}

export async function externalDepToggleAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const taskId = String(formData.get("taskId"));
  await setExternalDependencyResolved(
    actor,
    String(formData.get("externalDepId")),
    formData.get("resolved") === "true",
  );
  revalidatePath(`/tasks/${taskId}`);
}

export async function externalDepDeleteAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const taskId = String(formData.get("taskId"));
  await deleteExternalDependency(actor, String(formData.get("externalDepId")));
  revalidatePath(`/tasks/${taskId}`);
}

export async function commentAction(
  _prev: TaskActionState,
  formData: FormData,
): Promise<TaskActionState> {
  try {
    const actor = await requireActor();
    const taskId = String(formData.get("taskId"));
    const body = String(formData.get("body") ?? "").trim();
    if (!body) return { error: "Comment is empty." };

    // image OR document — both show in the timeline and comment history
    let attachment: { path: string; name: string } | undefined;
    const file = formData.get("attachment");
    if (file instanceof File && file.size > 0) {
      attachment = {
        path: await saveFileUpload(file, "comments"),
        name: file.name,
      };
    }

    await addComment(
      actor,
      taskId,
      body,
      formData.getAll("mentions").map(String).filter(Boolean),
      attachment,
    );
    revalidatePath(`/tasks/${taskId}`);
    revalidatePath("/timeline");
    return {};
  } catch (error) {
    return friendly(error);
  }
}

export async function attachmentAction(
  _prev: TaskActionState,
  formData: FormData,
): Promise<TaskActionState> {
  try {
    const actor = await requireActor();
    const taskId = String(formData.get("taskId"));
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return { error: "Choose a file first." };
    }
    const relativePath = await saveFileUpload(file, "attachments");
    await addAttachment(actor, taskId, {
      name: file.name,
      size: file.size,
      path: relativePath,
    });
    revalidatePath(`/tasks/${taskId}`);
    return {};
  } catch (error) {
    return friendly(error);
  }
}

export async function handoffRequestAction(
  _prev: TaskActionState,
  formData: FormData,
): Promise<TaskActionState> {
  try {
    const actor = await requireActor();
    const eventId = String(formData.get("eventId"));
    await requestHandoff(actor, {
      eventId,
      fromDivisionId: String(formData.get("fromDivisionId")),
      toDivisionId: String(formData.get("toDivisionId")),
      title: String(formData.get("title") ?? "").trim(),
      note: String(formData.get("note") ?? ""),
      originTaskId: String(formData.get("originTaskId") ?? "") || undefined,
    });
    revalidatePath(`/events/${eventId}/handoffs`);
    return {};
  } catch (error) {
    return friendly(error);
  }
}

export async function handoffDecideAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const eventId = String(formData.get("eventId"));
  await decideHandoff(
    actor,
    String(formData.get("handoffId")),
    formData.get("accept") === "true",
  );
  revalidatePath(`/events/${eventId}/handoffs`);
}
