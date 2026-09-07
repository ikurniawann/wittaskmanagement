// Dev-only fixture for Backstage Play (EPIC-024 T-247 smoke): a small office
// with heads, staff, two projects, ~30 open tasks in every state, fan-in
// dependencies, a pending handoff and checklists. Never run against a
// production DATABASE_URL — it refuses unless PLAY_FIXTURE=1 is set.
//
//   DATABASE_URL=postgres://… PLAY_FIXTURE=1 pnpm tsx scripts/play-fixture.ts
import { db } from "@/db";
import {
  divisionMembers,
  events,
  handoffs,
  profiles,
  taskAssignees,
  taskChecklistItems,
  taskDependencies,
  tasks,
} from "@/db/schema";
import { hashPassword } from "@/lib/auth/password";
import { DIVISIONS } from "@/lib/org/divisions";

if (process.env.PLAY_FIXTURE !== "1") {
  console.error("refusing: set PLAY_FIXTURE=1 to seed the Play fixture into this database");
  process.exit(1);
}

const PASSWORD = "changeme123";
const FIRST = ["Ayu", "Bagas", "Citra", "Dimas", "Eka", "Fajar", "Gita", "Hana", "Indra", "Joko", "Kirana", "Lukman", "Maya", "Nadia", "Oka", "Putri", "Raka", "Sari", "Tono", "Umar", "Vina", "Wira"];
const LAST = ["Pratama", "Wijaya", "Santoso", "Lestari", "Saputra", "Hidayat", "Kusuma", "Rahayu"];

async function main() {
  const pw = hashPassword(PASSWORD);
  // people: 2 per division for the first 8 divisions, 3 for the rest
  const people: { id: string; divisionId: string; role: "head" | "staff" }[] = [];
  let n = 0;
  for (const d of DIVISIONS) {
    const count = n < 16 ? 2 : 3;
    for (let k = 0; k < count; k++) {
      const name = `${FIRST[n % FIRST.length]} ${LAST[(n * 3) % LAST.length]}`;
      const [row] = await db
        .insert(profiles)
        .values({ email: `play${n}@example.test`, name, passwordHash: pw, role: "member", isActive: true })
        .returning({ id: profiles.id });
      people.push({ id: row.id, divisionId: d.id, role: k === 0 ? "head" : "staff" });
      n++;
    }
  }
  await db.insert(divisionMembers).values(people.map((p) => ({ userId: p.id, divisionId: p.divisionId, role: p.role })));
  const owner = (await db.select({ id: profiles.id }).from(profiles).where(undefined).limit(50)).find(() => true);

  const now = Date.now();
  const [ev1] = await db.insert(events).values({ name: "Jakarta Arena Night", showDate: new Date(now + 41 * 86400000) }).returning({ id: events.id });
  const [ev2] = await db.insert(events).values({ name: "Bandung Open Air", showDate: new Date(now + 9 * 86400000) }).returning({ id: events.id });
  const statuses = ["todo", "in_progress", "in_review", "blocked", "todo", "in_progress", "backlog"] as const;
  const priorities = ["low", "medium", "high", "urgent"] as const;
  const created: string[] = [];
  let i = 0;
  for (const p of people) {
    const count = 1 + (i % 3);
    for (let k = 0; k < count; k++) {
      const status = statuses[(i + k) % statuses.length];
      const due = new Date(now + ((i * 7 + k * 3) % 21 - 6) * 86400000); // some overdue
      const [row] = await db
        .insert(tasks)
        .values({
          eventId: (i % 2 === 0 ? ev1 : ev2).id,
          divisionId: p.divisionId,
          title: `${DIVISIONS.find((d) => d.id === p.divisionId)?.name ?? p.divisionId}: task ${i}-${k}`,
          status,
          priority: priorities[(i + k) % priorities.length],
          leadId: p.id,
          createdBy: owner?.id ?? p.id,
          dueDate: due,
        })
        .returning({ id: tasks.id });
      await db.insert(taskAssignees).values({ taskId: row.id, userId: p.id });
      const items = (i + k) % 4;
      for (let c = 0; c < items * 2; c++) await db.insert(taskChecklistItems).values({ taskId: row.id, title: `step ${c + 1}`, done: c < items });
      created.push(row.id);
    }
    i++;
  }
  // fan-in: many tasks wait on the first production task → critical bottleneck
  const blocker = created[2];
  for (const t of created.slice(6, 11)) await db.insert(taskDependencies).values({ taskId: t, dependsOnTaskId: blocker });
  await db.insert(taskDependencies).values({ taskId: created[12], dependsOnTaskId: created[4] });
  // a pending handoff production → operations
  await db.insert(handoffs).values({
    eventId: ev1.id,
    fromDivisionId: "production",
    toDivisionId: "operations-logistics",
    title: "Stage power distribution plan",
    status: "pending",
    requestedBy: people.find((p) => p.divisionId === "production")!.id,
  });
  console.log(`[play-fixture] ${people.length} people, 2 events, ${created.length} tasks`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
