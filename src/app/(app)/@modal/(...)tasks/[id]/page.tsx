import { TaskDetailPanel } from "@/app/(app)/tasks/[id]/task-detail-panel";
import { TaskPeek } from "./task-peek";

// Intercepted /tasks/[id]: opens full-screen over the current view. The URL
// is the real task URL (shareable) and a refresh loads the standalone page.
//
// No `compact` any more (Owner 2026-08-31): it existed to squeeze the panel
// into a half-width drawer — small title, breadcrumb instead of a back link.
// At full width there is room for the page as it was meant to look.
export default async function TaskPeekPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <TaskPeek>
      <TaskDetailPanel taskId={id} />
    </TaskPeek>
  );
}
