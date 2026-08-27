import { AgentAuthError, authenticateAgent, type AgentContext } from "./auth";
import { PermissionError } from "@/lib/permissions";

// One wrapper for every agent route: auth → handler → uniform JSON errors.
// Uniform on purpose — an LLM agent retries on the text it gets back, so the
// message must say what to fix ("phone unknown") without leaking internals.
export async function agentRoute(
  request: Request,
  handler: (ctx: AgentContext) => Promise<unknown>,
): Promise<Response> {
  try {
    const ctx = await authenticateAgent(request);
    const result = await handler(ctx);
    return Response.json({ ok: true, data: result });
  } catch (error) {
    if (error instanceof AgentAuthError) {
      return Response.json({ ok: false, error: error.message }, { status: error.status });
    }
    if (error instanceof PermissionError) {
      return Response.json(
        { ok: false, error: "This user is not allowed to do that." },
        { status: 403 },
      );
    }
    if (error instanceof Error && /not found/i.test(error.message)) {
      return Response.json({ ok: false, error: error.message }, { status: 404 });
    }
    if (error instanceof Error) {
      return Response.json({ ok: false, error: error.message }, { status: 400 });
    }
    return Response.json({ ok: false, error: "Unexpected failure." }, { status: 500 });
  }
}
