import { agentRoute } from "@/lib/agent/respond";
import { globalSearch } from "@/lib/search/service";

/** GET /search?q=… — the app's global search, visibility-scoped. */
export async function GET(request: Request) {
  return agentRoute(request, async ({ actor }) => {
    const q = new URL(request.url).searchParams.get("q") ?? "";
    if (q.trim().length < 2) throw new Error("Pass ?q= with at least 2 characters.");
    return globalSearch(actor, q);
  });
}
