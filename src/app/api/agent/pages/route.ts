import { agentRoute } from "@/lib/agent/respond";
import { createPage, listPages } from "@/lib/pages/standalone-service";
import { markdownToDoc } from "@/lib/pages/markdown";

export async function GET(request: Request) {
  return agentRoute(request, async ({ actor }) => listPages(actor));
}

/**
 * POST { title, markdown? } — content arrives as markdown and is converted
 * to the editor's document format, so a page made from chat opens cleanly
 * in the app's editor.
 */
export async function POST(request: Request) {
  return agentRoute(request, async ({ actor }) => {
    const body = (await request.json().catch(() => null)) as {
      title?: string;
      markdown?: string;
    } | null;
    if (!body?.title) throw new Error("title is required.");
    const { id } = await createPage(actor, {
      title: body.title,
      content: body.markdown ? markdownToDoc(body.markdown) : undefined,
    });
    return { id };
  });
}
