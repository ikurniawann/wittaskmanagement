import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { sessionActor } from "@/lib/auth/session-actor";
import { auth } from "@/lib/auth";
import {
  getConversationWithMessages,
  listHistory,
} from "@/lib/ai/conversations";
import { aiConfigured } from "@/lib/ai/openai";
import { listActiveEvents } from "@/lib/events/service";
import { can } from "@/lib/permissions";
import { AssistantChat } from "./assistant-chat";
import { HistoryPanel } from "./history-panel";

export async function generateMetadata(): Promise<Metadata> {
  const { getBranding } = await import("@/lib/org/branding");
  return { title: (await getBranding()).assistantName };
}

// EPIC-014 T-140/T-141: predictive chat over the org's live data with saved
// conversations — leadership only (owner / admin / division heads).
export default async function AssistantPage({
  searchParams,
}: PageProps<"/assistant">) {
  const session = await auth();
  const actor = await sessionActor();
  if (!actor) redirect("/login");
  if (!can(actor, "ai.assistant")) redirect("/my-tasks");

  const sp = await searchParams;
  const conversationId = typeof sp.c === "string" && sp.c ? sp.c : null;

  const { getBranding } = await import("@/lib/org/branding");
  const [events, history, conversation, branding] = await Promise.all([
    listActiveEvents(actor),
    listHistory(actor),
    conversationId
      ? getConversationWithMessages(actor, conversationId)
      : Promise.resolve(null),
    getBranding(),
  ]);
  // unknown/foreign id → start fresh rather than 404-ing the whole page
  if (conversationId && !conversation) redirect("/assistant");

  return (
    <section className="flex min-h-[calc(100svh-8rem)] flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-3xl font-semibold tracking-tight">
          {branding.assistantName}
        </h1>
        <p className="text-sm text-muted-foreground">
          Ask about any project or the whole portfolio — predictions come with
          reasons, grounded in your live data. Chats are saved to your history.
        </p>
      </div>
      <div className="flex flex-1 flex-col gap-8 lg:flex-row">
        <HistoryPanel
          groups={history.groups.map((group) => ({
            id: group.id,
            name: group.name,
            conversations: group.conversations.map((c) => ({
              id: c.id,
              title: c.title,
              groupId: c.groupId,
            })),
          }))}
          ungrouped={history.ungrouped.map((c) => ({
            id: c.id,
            title: c.title,
            groupId: c.groupId,
          }))}
          activeId={conversation?.id ?? null}
        />
        <AssistantChat
          key={conversation?.id ?? "new"}
          userName={session?.user?.name ?? "You"}
          assistantName={branding.assistantName}
          events={events.map((e) => ({ id: e.id, name: e.name }))}
          configured={aiConfigured()}
          conversationId={conversation?.id ?? null}
          initialMessages={conversation?.messages ?? []}
          initialEventId={conversation?.eventId ?? ""}
        />
      </div>
    </section>
  );
}
