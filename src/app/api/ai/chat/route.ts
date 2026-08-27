import { NextResponse } from "next/server";
import { logActivity } from "@/lib/activity";
import { buildAssistantContext } from "@/lib/ai/context";
import {
  appendExchange,
  createConversation,
  getConversation,
  saveAttachments,
} from "@/lib/ai/conversations";
import {
  buildAttachmentPrompt,
  describeAttachments,
  extractAttachment,
  MAX_CHARS_TOTAL,
  MAX_FILES,
  type ExtractedAttachment,
} from "@/lib/ai/extract";
import {
  aiConfigured,
  streamChat,
  type ChatMessage,
  type ContentPart,
} from "@/lib/ai/openai";
import { saveFileUpload } from "@/lib/uploads";
import { matchRequestedFiles } from "@/lib/ai/dataroom-match";
import {
  listFilesForAssistant,
  openForAssistant,
} from "@/lib/dataroom/service";
import { sessionActor } from "@/lib/auth/session-actor";
import { can } from "@/lib/permissions";

// AI assistant chat endpoint (EPIC-014 T-140). Streams plain text. The
// context injected into the prompt is permission-scoped per actor in
// buildAssistantContext — leadership gate here, data scoping there.

export const maxDuration = 120;

function systemPrompt(orgName: string, assistantName: string): string {
  return `You are ${assistantName}, the in-house analyst for ${orgName}, a production organisation. You answer questions about their live project/task data and assess whether projects are on course. If asked what you are called, use the name ${assistantName}.

You receive a JSON snapshot of the data the CURRENT USER is allowed to see (their permission scope — never speculate about data outside it). All amounts are IDR. Dates/times are WIB (Asia/Jakarta).

When asked whether a project will run smoothly (or for any risk assessment):
1. Give a clear verdict first: ON COURSE / AT RISK / CRITICAL, with a confidence level.
2. Then the reasons, ranked by severity, grounded in the snapshot: time pressure (daysToShow vs open/overdue work and remaining phases), dependency pressure (bottlenecks list — tasks many others wait on), workload concentration (workloadTop — one person carrying too many open tasks), unresolved external waits (permits, vendors), budget burn (committed+paid vs planned), ticket pace (sold vs capacity given daysToShow), and auto-escalated urgent tasks.
3. Recommend the 2–3 highest-leverage actions, each tied to a reason.
4. When useful, benchmark against typical industry practice for comparable concerts (e.g. permits secured 60–90 days out, ticket on-sale 6–12 weeks before launch, production advance locked by go-live week). Present these as general industry heuristics from your own knowledge — NEVER invent specific named events, figures, or sources.

Dataroom: the snapshot lists the document files the CURRENT USER may see, per event. When the user names one of those files, its content arrives alongside this prompt as an attached file. If they ask about a document that was not provided, ask them to name the file exactly as listed — do not guess at contents. Files the user cannot see are not listed and must never be speculated about.

Style: answer in the user's language. Be direct and concrete — name tasks, people, and numbers from the snapshot. Use short paragraphs and lists, no filler. If the snapshot lacks the data to answer, say exactly what is missing instead of guessing.`;
}

interface ChatRequestBody {
  messages?: Array<{ role?: string; content?: string }>;
  eventId?: string;
  conversationId?: string;
}

export async function POST(request: Request) {
  const actor = await sessionActor();
  if (!actor) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!can(actor, "ai.assistant")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!aiConfigured()) {
    return NextResponse.json(
      { error: "AI assistant is not configured (OPENAI_API_KEY is empty)." },
      { status: 503 },
    );
  }

  // The client posts multipart when the turn carries attachments, plain JSON
  // otherwise — so a chat without files is unchanged.
  let body: ChatRequestBody = {};
  let uploads: File[] = [];
  if ((request.headers.get("content-type") ?? "").includes("multipart/form-data")) {
    const form = await request.formData().catch(() => null);
    if (form) {
      try {
        body = JSON.parse(String(form.get("payload") ?? "{}")) as ChatRequestBody;
      } catch {
        body = {};
      }
      uploads = form
        .getAll("files")
        .filter((f): f is File => f instanceof File && f.size > 0)
        .slice(0, MAX_FILES);
    }
  } else {
    body = (await request.json().catch(() => ({}))) as ChatRequestBody;
  }
  // strings only at this stage, so `question` stays a plain string even
  // after images turn the final turn into content parts below
  const history: Array<{ role: "user" | "assistant"; content: string }> = (
    body.messages ?? []
  )
    .filter(
      (m): m is { role: "user" | "assistant"; content: string } =>
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string" &&
        m.content.trim().length > 0,
    )
    // last 12 turns is plenty of memory and caps prompt cost
    .slice(-12)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 8_000) }));
  if (history.length === 0 || history[history.length - 1].role !== "user") {
    return NextResponse.json({ error: "No user message." }, { status: 400 });
  }

  const eventId =
    typeof body.eventId === "string" && body.eventId ? body.eventId : undefined;
  const question = history[history.length - 1].content;

  // persistence (T-141): resume the caller's own conversation, or start a
  // new one titled after the first question
  let conversation =
    typeof body.conversationId === "string" && body.conversationId
      ? await getConversation(actor, body.conversationId)
      : null;
  if (body.conversationId && !conversation) {
    return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
  }
  conversation ??= await createConversation(actor, {
    title: question,
    eventId,
  });

  // Read every attachment before the prompt is built. Extraction never
  // throws: an unreadable file comes back with an error we show the user
  // instead of quietly sending the model an empty document.
  const attachments: Array<{
    extracted: ExtractedAttachment;
    filePath: string | null;
  }> = [];
  let charBudget = MAX_CHARS_TOTAL;
  for (const upload of uploads) {
    const bytes = Buffer.from(await upload.arrayBuffer());
    const extracted = await extractAttachment(
      { name: upload.name, type: upload.type, bytes },
      charBudget,
    );
    charBudget -= extracted.chars;
    let filePath: string | null = null;
    if (!extracted.error) {
      // keep the original so the user can reopen what they sent; a file we
      // could not read is not worth storing
      filePath = await saveFileUpload(upload, "ai").catch(() => null);
    }
    attachments.push({ extracted, filePath });
  }
  const extractedFiles = attachments.map((a) => a.extracted);

  const { getBranding } = await import("@/lib/org/branding");
  const branding = await getBranding();
  const context = await buildAssistantContext(
    actor,
    eventId ?? conversation.eventId ?? undefined,
  );

  // Dataroom for the assistant (Owner 2026-08-12). Listing and reading both
  // run as the ASKER: the same folder rules as the browsing UI, so a sealed
  // folder is as sealed in chat as it is on screen — and every read lands in
  // the dataroom access log attributed to the asker, "via AI Assistant".
  const dataroomIndex: Array<{
    fileId: string;
    name: string;
    folderName: string;
    eventName: string;
  }> = [];
  try {
    const focus = eventId ?? conversation.eventId ?? null;
    const scopeEvents = focus
      ? context.events.filter((e) => e.id === focus)
      : context.events.slice(0, 8);
    for (const ev of scopeEvents) {
      const files = await listFilesForAssistant(actor, ev.id, 60);
      for (const f of files) {
        dataroomIndex.push({
          fileId: f.fileId,
          name: f.name,
          folderName: f.folderName,
          eventName: ev.name,
        });
      }
      if (dataroomIndex.length >= 150) break;
    }
  } catch (error) {
    // the dataroom must never take the chat down with it
    console.error("[ai] dataroom listing failed:", error);
  }

  let assistantCharBudget = charBudget;
  const requested = matchRequestedFiles(question, dataroomIndex);
  for (const hit of requested) {
    try {
      const opened = await openForAssistant(actor, hit.fileId);
      if (!opened) continue;
      const { readFile } = await import("node:fs/promises");
      const bytes = await readFile(opened.absolutePath);
      const extracted = await extractAttachment(
        { name: opened.fileName, type: opened.mimeType, bytes },
        assistantCharBudget,
      );
      assistantCharBudget -= extracted.chars;
      extractedFiles.push(extracted);
    } catch (error) {
      console.error(`[ai] dataroom read failed for ${hit.name}:`, error);
    }
  }

  const attachmentPrompt = buildAttachmentPrompt(extractedFiles);
  const images = extractedFiles.filter(
    (f) => f.kind === "image" && f.dataUrl && !f.error,
  );

  // images ride on the user turn itself as content parts (T-162); document
  // text goes in its own system message so a document cannot impersonate the
  // user's instruction
  const turns: ChatMessage[] = [...history];
  if (images.length > 0) {
    const parts: ContentPart[] = [
      { type: "text", text: question },
      ...images.map((img) => ({
        type: "image_url" as const,
        image_url: { url: img.dataUrl as string },
      })),
    ];
    turns[turns.length - 1] = { role: "user", content: parts };
  }

  const messages: ChatMessage[] = [
    {
      role: "system",
      content: systemPrompt(branding.orgName, branding.assistantName),
    },
    {
      role: "system",
      content: `Data snapshot (permission-scoped to this user):\n${JSON.stringify(
        {
          ...context,
          dataroomFiles: dataroomIndex.map((f) => ({
            event: f.eventName,
            folder: f.folderName,
            name: f.name,
          })),
        },
      )}`,
    },
    ...(attachmentPrompt
      ? [{ role: "system" as const, content: attachmentPrompt }]
      : []),
    ...turns,
  ];

  await logActivity({
    actorId: actor.id,
    action: "ai.chat",
    entity: `ai:${eventId ?? "portfolio"}`,
    detail: {
      question: question.slice(0, 200),
      attachments: extractedFiles.length
        ? describeAttachments(extractedFiles)
        : undefined,
    },
    eventId,
  });

  const conversationId = conversation.id;
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let assistantText = "";
      try {
        // tell the user up front about anything that could not be read,
        // rather than letting the answer quietly ignore a file
        const unreadable = extractedFiles.filter((f) => f.error);
        if (unreadable.length > 0) {
          const notice = `${unreadable
            .map((f) => `⚠️ ${f.fileName}: ${f.error}`)
            .join("\n")}\n\n`;
          controller.enqueue(encoder.encode(notice));
        }
        for await (const chunk of streamChat(messages)) {
          assistantText += chunk;
          controller.enqueue(encoder.encode(chunk));
        }
      } catch (error) {
        const message = `\n\n[error] ${error instanceof Error ? error.message : "AI request failed."}`;
        assistantText += message;
        controller.enqueue(encoder.encode(message));
      } finally {
        controller.close();
        // persist the exchange even on partial/failed answers so the
        // history reflects what the user actually saw
        try {
          const { userMessageId } = await appendExchange(
            actor,
            conversationId,
            question,
            assistantText,
          );
          if (userMessageId) {
            await saveAttachments(
              userMessageId,
              attachments
                .filter((a) => a.filePath)
                .map((a) => ({
                  fileName: a.extracted.fileName,
                  filePath: a.filePath as string,
                  kind: a.extracted.kind,
                  sizeBytes: a.extracted.sizeBytes,
                  chars: a.extracted.chars,
                  truncated: a.extracted.truncated,
                  error: a.extracted.error ?? null,
                })),
            );
          }
        } catch (persistError) {
          console.error("[ai] failed to persist exchange:", persistError);
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      // defeat proxy buffering so tokens render as they arrive
      "X-Accel-Buffering": "no",
      // lets a fresh chat learn its id and update the URL/history list
      "X-Conversation-Id": conversationId,
    },
  });
}
