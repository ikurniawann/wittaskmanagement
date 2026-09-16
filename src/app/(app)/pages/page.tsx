import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { FileText, Globe, Lock, Plus, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { sessionActor } from "@/lib/auth/session-actor";
import { listPages } from "@/lib/pages/standalone-service";
import { can } from "@/lib/permissions";
import { createPageAction } from "./actions";
import { PageHeader } from "@/components/page-header";

export const metadata: Metadata = { title: "Pages" };

// EPIC-016 T-160: the workspace wiki that belongs to no event. Pages start
// private to their author and are shared explicitly.
export default async function PagesIndex() {
  const actor = await sessionActor();
  if (!actor) redirect("/login");
  if (!can(actor, "page.use")) redirect("/my-tasks");

  const items = await listPages(actor);
  const mine = items.filter((p) => p.isMine);
  const sharedWithMe = items.filter((p) => !p.isMine);

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <PageHeader title={<>Pages</>} description={<>Notes, SOPs and summaries that do not belong to a single event. A
            new page is private to you until you share it.</>} />
        <form action={createPageAction} className="flex items-end gap-2">
          <Input
            name="title"
            placeholder="New page title…"
            aria-label="New page title"
            className="h-9 w-56"
          />
          <Button type="submit" className="gap-1.5">
            <Plus className="size-4" /> New page
          </Button>
        </form>
      </div>

      <PageGroup
        heading="My pages"
        empty="You have not created a page yet."
        items={mine}
      />
      {sharedWithMe.length > 0 ? (
        <PageGroup
          heading="Shared with me"
          empty=""
          items={sharedWithMe}
          showAuthor
        />
      ) : null}
    </section>
  );
}

function PageGroup({
  heading,
  empty,
  items,
  showAuthor = false,
}: {
  heading: string;
  empty: string;
  items: Array<{
    id: string;
    title: string;
    visibility: "private" | "organisation";
    updatedAt: Date;
    ownerName: string | null;
    isShared: boolean;
  }>;
  showAuthor?: boolean;
}) {
  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
        {heading}
      </h2>
      {items.length === 0 ? (
        <p className="rounded-md border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
          {empty}
        </p>
      ) : (
        <ul className="flex flex-col divide-y rounded-card bg-card shadow-card">
          {items.map((page) => (
            <li key={page.id}>
              <Link
                href={`/pages/${page.id}`}
                className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-2"
              >
                <FileText className="size-4 shrink-0 text-muted-foreground" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-medium">
                    {page.title}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {showAuthor && page.ownerName ? `${page.ownerName} · ` : ""}
                    Updated {page.updatedAt.toLocaleDateString("en-GB")}
                  </span>
                </span>
                <VisibilityChip
                  visibility={page.visibility}
                  isShared={page.isShared}
                />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function VisibilityChip({
  visibility,
  isShared,
}: {
  visibility: "private" | "organisation";
  isShared: boolean;
}) {
  const [Icon, label] =
    visibility === "organisation"
      ? ([Globe, "Everyone"] as const)
      : isShared
        ? ([Users, "Shared"] as const)
        : ([Lock, "Private"] as const);

  return (
    <span className="flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-wider text-muted-foreground">
      <Icon className="size-3" />
      {label}
    </span>
  );
}
