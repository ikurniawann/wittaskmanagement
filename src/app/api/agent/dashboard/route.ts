import { agentRoute } from "@/lib/agent/respond";
import {
  getBlockers,
  getBottlenecks,
  getOverdueHotspots,
  getPortfolio,
  getUpcomingMilestones,
} from "@/lib/dashboard/service";

/** The dashboard's numbers in one call — everything event-scoped per actor. */
export async function GET(request: Request) {
  return agentRoute(request, async ({ actor }) => {
    const [portfolio, milestones, bottlenecks, blockers, overdue] =
      await Promise.all([
        getPortfolio(actor),
        getUpcomingMilestones(actor),
        getBottlenecks(actor),
        getBlockers(actor),
        getOverdueHotspots(actor),
      ]);
    return { portfolio, milestones, bottlenecks, blockers, overdue };
  });
}
