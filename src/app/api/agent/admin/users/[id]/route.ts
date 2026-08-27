import { agentRoute } from "@/lib/agent/respond";
import { setUserContact } from "@/lib/org/service";

/** PATCH { phone, whatsappNotifications } — org.manage enforced in service. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return agentRoute(request, async ({ actor }) => {
    const { id } = await params;
    const body = (await request.json().catch(() => null)) as {
      phone?: string;
      whatsappNotifications?: boolean;
    } | null;
    if (!body || body.phone === undefined) {
      throw new Error("Pass phone (and optionally whatsappNotifications).");
    }
    await setUserContact(actor, id, {
      phone: body.phone,
      whatsappNotifications: body.whatsappNotifications ?? Boolean(body.phone),
    });
    return { updated: true };
  });
}
