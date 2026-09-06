import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { tasks } from "@/db/schema";
import { TaskDetailPanel } from "./task-detail-panel";

// Full-page fallback: direct links / refresh. In-app clicks are intercepted
// by the @modal slot and open the same panel full-screen instead (T-111).

/**
 * The tab reads the task's own title, not the word "Task" (Owner 2026-08-31:
 * the tab strip is the first place someone looks when they have lost their
 * place). Title only — it carries no permission, and the panel below still
 * gates the real content.
 */
export async function generateMetadata({
  params,
}: PageProps<"/tasks/[id]">): Promise<Metadata> {
  const { id } = await params;
  const [row] = await db
    .select({ title: tasks.title })
    .from(tasks)
    .where(eq(tasks.id, id))
    .limit(1)
    .catch(() => []);
  return { title: row?.title ?? "Task" };
}

export default async function TaskPage({ params }: PageProps<"/tasks/[id]">) {
  const { id } = await params;
  return (
    <div className="mx-auto w-full max-w-5xl">
      <TaskDetailPanel taskId={id} />
    </div>
  );
}
