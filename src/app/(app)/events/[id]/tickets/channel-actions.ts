"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { eventTicketChannels } from "@/db/schema";
import { logActivity } from "@/lib/activity";
import { sessionActor } from "@/lib/auth/session-actor";
import { can } from "@/lib/permissions";
import { listMegatixEvents, listMegatixPresenters } from "@/lib/megatix/client";
import { listTesseraEvents } from "@/lib/tessera/client";

// Channel mapping (Owner 2026-08-17: "ada 2 channel — tessera dan megatix").
// org.manage on every action: connecting a data source decides what an
// event's sales history says, and listing a provider's events spends the
// shared credentials either way.

export type ChannelProvider = "tessera" | "megatix";

export interface Option {
  id: string;
  name: string;
  /** Megatix presenters own their events; carried so mapping can store it */
  accountId?: string | null;
}

export async function fetchChannelOptionsAction(
  provider: ChannelProvider,
  presenterId?: string,
): Promise<{ options: Option[] } | { error: string }> {
  const actor = await sessionActor();
  if (!actor || !can(actor, "org.manage")) return { error: "Not allowed." };
  try {
    if (provider === "tessera") {
      const rows = await listTesseraEvents(actor);
      return { options: rows.map((r) => ({ id: r.id, name: r.name })) };
    }
    // Megatix scopes events under a presenter, so with none chosen yet the
    // presenters themselves are what the picker offers first
    if (!presenterId) {
      const rows = await listMegatixPresenters(actor);
      return { options: rows.map((r) => ({ id: r.id, name: r.name })) };
    }
    const rows = await listMegatixEvents(actor, presenterId);
    return {
      options: rows.map((r) => ({ id: r.id, name: r.name, accountId: presenterId })),
    };
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : `Could not reach ${provider === "tessera" ? "Tessera" : "Megatix"}.`,
    };
  }
}

export async function mapChannelAction(
  eventId: string,
  provider: ChannelProvider,
  providerEventId: string | null,
  presenterId?: string | null,
): Promise<{ error?: string }> {
  const actor = await sessionActor();
  if (!actor || !can(actor, "org.manage")) return { error: "Not allowed." };

  if (providerEventId) {
    await db
      .insert(eventTicketChannels)
      .values({
        eventId,
        provider,
        providerEventId,
        providerAccountId: presenterId ?? null,
      })
      .onConflictDoUpdate({
        target: [eventTicketChannels.eventId, eventTicketChannels.provider],
        set: { providerEventId, providerAccountId: presenterId ?? null },
      });
  } else {
    // unlinking drops the channel row; the transactions already stored stay,
    // because deleting a show's sales history is never a side effect of
    // changing where it syncs from
    await db
      .delete(eventTicketChannels)
      .where(
        and(
          eq(eventTicketChannels.eventId, eventId),
          eq(eventTicketChannels.provider, provider),
        ),
      );
  }

  await logActivity({
    actorId: actor.id,
    action: providerEventId ? "ticketing.channel_mapped" : "ticketing.channel_unmapped",
    entity: `event:${eventId}`,
    detail: { provider, providerEventId },
    eventId,
  });
  revalidatePath(`/events/${eventId}/tickets`);
  return {};
}
