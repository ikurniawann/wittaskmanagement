import { agentRoute } from "@/lib/agent/respond";
import { getUnreadCounts, listMentions, listTimeline } from "@/lib/timeline/service";

/** GET /timeline?mentions=1&limit=… — the speaker's feed, same scoping as the app. */
export async function GET(request: Request) {
  return agentRoute(request, async ({ actor }) => {
    const url = new URL(request.url);
    const limit = Math.min(100, Number(url.searchParams.get("limit") ?? 30) || 30);
    const [items, counts] = await Promise.all([
      url.searchParams.get("mentions")
        ? listMentions(actor, limit)
        : listTimeline(actor, limit),
      getUnreadCounts(actor),
    ]);
    return { unread: counts, items };
  });
}
