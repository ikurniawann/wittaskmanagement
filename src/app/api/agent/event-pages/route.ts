import { agentRoute } from "@/lib/agent/respond";
import { createPage, listEventPages, updatePage } from "@/lib/pages/service";
import { markdownToDoc } from "@/lib/pages/markdown";

/** GET /event-pages?eventId=… — the event's wiki pages. */
export async function GET(request: Request) {
  return agentRoute(request, async ({ actor }) => {
    const eventId = new URL(request.url).searchParams.get("eventId");
    if (!eventId) throw new Error("Pass ?eventId=…");
    return listEventPages(actor, eventId);
  });
}

/** POST { eventId, title, markdown? } */
export async function POST(request: Request) {
  return agentRoute(request, async ({ actor }) => {
    const body = (await request.json().catch(() => null)) as {
      eventId?: string;
      title?: string;
      markdown?: string;
    } | null;
    if (!body?.eventId || !body.title) throw new Error("eventId and title are required.");
    const page = await createPage(actor, body.eventId, body.title);
    if (body.markdown) {
      await updatePage(actor, page.id, { content: markdownToDoc(body.markdown) });
    }
    return { id: page.id };
  });
}
