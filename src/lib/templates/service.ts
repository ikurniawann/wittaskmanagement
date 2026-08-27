import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  divisions,
  eventTemplateItems,
  eventTemplates,
  events,
  tasks,
} from "@/db/schema";
import { logActivity } from "@/lib/activity";
import { recomputeEventHealth } from "@/lib/events/service";
import { assertCan, type Actor } from "@/lib/permissions";

// Event playbooks (T-090/T-092). Applying a template COPIES its items into
// tasks with due dates computed backwards from show day — the template and
// the generated event are decoupled from that moment on.

const DAY_MS = 86_400_000;

export async function listTemplates() {
  return db
    .select({
      template: eventTemplates,
      itemCount: sql<number>`(select count(*)::int from ${eventTemplateItems} where ${eventTemplateItems.templateId} = ${eventTemplates.id})`,
    })
    .from(eventTemplates)
    .orderBy(asc(eventTemplates.name));
}

export async function getTemplate(templateId: string) {
  const [template] = await db
    .select()
    .from(eventTemplates)
    .where(eq(eventTemplates.id, templateId))
    .limit(1);
  if (!template) return null;
  const items = await db
    .select({ item: eventTemplateItems, divisionName: divisions.name })
    .from(eventTemplateItems)
    .innerJoin(divisions, eq(eventTemplateItems.divisionId, divisions.id))
    .where(eq(eventTemplateItems.templateId, templateId))
    .orderBy(asc(divisions.sortOrder), asc(eventTemplateItems.sortOrder));
  return { ...template, items };
}

export async function createTemplate(actor: Actor, name: string, description: string) {
  assertCan(actor, "org.manage");
  const [template] = await db
    .insert(eventTemplates)
    .values({ name: name.trim(), description: description.trim() })
    .returning();
  await logActivity({
    actorId: actor.id,
    action: "template.create",
    entity: `template:${template.id}`,
    detail: { name: template.name },
  });
  return template;
}

export async function deleteTemplate(actor: Actor, templateId: string) {
  assertCan(actor, "org.manage");
  await db.delete(eventTemplates).where(eq(eventTemplates.id, templateId));
  await logActivity({
    actorId: actor.id,
    action: "template.delete",
    entity: `template:${templateId}`,
  });
}

export async function addTemplateItem(
  actor: Actor,
  input: {
    templateId: string;
    divisionId: string;
    title: string;
    priority: "low" | "medium" | "high" | "urgent";
    offsetDays: number;
  },
) {
  assertCan(actor, "org.manage");
  if (!input.title.trim()) throw new Error("Item title is empty.");
  const [{ max }] = await db
    .select({ max: sql<number>`coalesce(max(sort_order), 0)::int` })
    .from(eventTemplateItems)
    .where(eq(eventTemplateItems.templateId, input.templateId));
  await db.insert(eventTemplateItems).values({
    templateId: input.templateId,
    divisionId: input.divisionId,
    title: input.title.trim(),
    priority: input.priority,
    offsetDays: input.offsetDays,
    sortOrder: max + 1,
  });
}

export async function deleteTemplateItem(actor: Actor, itemId: string) {
  assertCan(actor, "org.manage");
  await db.delete(eventTemplateItems).where(eq(eventTemplateItems.id, itemId));
}

// ---- generation (T-092) ---------------------------------------------------

export async function applyTemplate(
  actor: Actor,
  eventId: string,
  templateId: string,
): Promise<{ created: number; skipped: number }> {
  assertCan(actor, "event.create");

  const [event] = await db
    .select()
    .from(events)
    .where(eq(events.id, eventId))
    .limit(1);
  if (!event) throw new Error("Project not found.");
  const template = await getTemplate(templateId);
  if (!template) throw new Error("Template not found.");

  // idempotency guard: skip items that already exist (same division+title)
  const existing = await db
    .select({ divisionId: tasks.divisionId, title: tasks.title })
    .from(tasks)
    .where(eq(tasks.eventId, eventId));
  const existingKeys = new Set(
    existing.map((t) => `${t.divisionId}::${t.title.toLowerCase()}`),
  );

  let created = 0;
  let skipped = 0;
  for (const { item } of template.items) {
    const key = `${item.divisionId}::${item.title.toLowerCase()}`;
    if (existingKeys.has(key)) {
      skipped += 1;
      continue;
    }
    await db.insert(tasks).values({
      eventId,
      divisionId: item.divisionId,
      title: item.title,
      priority: item.priority,
      status: "todo",
      dueDate: new Date(event.showDate.getTime() - item.offsetDays * DAY_MS),
      createdBy: actor.id,
    });
    created += 1;
  }

  await logActivity({
    actorId: actor.id,
    action: "template.apply",
    entity: `event:${eventId}`,
    detail: { template: template.name, created, skipped },
    eventId,
  });
  await recomputeEventHealth(eventId);
  return { created, skipped };
}
