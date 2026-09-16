import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { FileText, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { sessionActor } from "@/lib/auth/session-actor";
import { getEvent } from "@/lib/events/service";
import { listEventPages } from "@/lib/pages/service";
import { can } from "@/lib/permissions";
import { createPageAction } from "./actions";

export const metadata: Metadata = { title: "Pages" };

const dt = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Jakarta",
});

// Per-event pages list (Owner 2026-08-07) — the event's mini-wiki.
export default async function EventPagesPage({
  params,
}: PageProps<"/events/[id]/pages">) {
  const actor = await sessionActor();
  if (!actor || !can(actor, "event.view")) redirect("/login");

  const { id } = await params;
  const event = await getEvent(actor, id);
  if (!event) notFound();

  const pages = await listEventPages(actor, id);

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            Pages
          </h1>
        </div>
        <form action={createPageAction}>
          <input type="hidden" name="eventId" value={id} />
          <Button type="submit" className="gap-1.5">
            <Plus className="size-3.5" /> New page
          </Button>
        </form>
      </div>

      {pages.length === 0 ? (
        <p className="rounded-md border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
          No pages yet. Briefs, meeting notes, riders, checklists — write the
          first one.
        </p>
      ) : (
        <ul className="flex flex-col divide-y rounded-card bg-card shadow-card">
          {pages.map((page) => (
            <li key={page.id}>
              <Link
                href={`/events/${id}/pages/${page.id}`}
                className="flex items-center gap-3 px-4 py-3 text-sm transition-colors hover:bg-surface-2"
              >
                <FileText className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate font-medium">
                  {page.title}
                </span>
                {page.authorName ? (
                  <span className="hidden text-xs text-muted-foreground sm:block">
                    {page.authorName}
                  </span>
                ) : null}
                <span className="text-xs tabular-nums text-muted-foreground">
                  {dt.format(page.updatedAt)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
