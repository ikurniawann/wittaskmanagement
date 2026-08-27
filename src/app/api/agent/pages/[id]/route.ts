import { agentRoute } from "@/lib/agent/respond";
import { deletePage, getPage, updatePage } from "@/lib/pages/standalone-service";
import { markdownToDoc } from "@/lib/pages/markdown";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return agentRoute(request, async ({ actor }) => {
    const { id } = await params;
    const page = await getPage(actor, id);
    if (!page) throw new Error("Page not found.");
    return page;
  });
}

/** PATCH { title?, markdown? } — markdown REPLACES the content wholesale. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return agentRoute(request, async ({ actor }) => {
    const { id } = await params;
    const body = (await request.json().catch(() => null)) as {
      title?: string;
      markdown?: string;
    } | null;
    if (!body || (body.title === undefined && body.markdown === undefined)) {
      throw new Error("Pass title and/or markdown.");
    }
    await updatePage(actor, id, {
      title: body.title,
      content: body.markdown !== undefined ? markdownToDoc(body.markdown) : undefined,
    });
    return { updated: true };
  });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return agentRoute(request, async ({ actor }) => {
    const { id } = await params;
    await deletePage(actor, id);
    return { deleted: true };
  });
}
