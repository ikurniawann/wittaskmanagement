import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { sessionActor } from "@/lib/auth/session-actor";
import { listAccessLog } from "@/lib/dataroom/service";
import { can } from "@/lib/permissions";

export const metadata: Metadata = { title: "Dataroom activity" };

const VERB: Record<string, string> = {
  upload: "uploaded",
  download: "downloaded",
  view: "opened",
  trash: "moved to trash",
  restore: "restored",
  share_created: "shared a link to",
  share_revoked: "withdrew a link to",
};

// EPIC-017 T-174. Filtered by the same access rules as the files themselves —
// see listAccessLog for why an unfiltered version would leak sealed names.
export default async function DataroomActivityPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const actor = await sessionActor();
  if (!actor || !can(actor, "event.view")) redirect("/my-tasks");

  const { id: eventId } = await params;
  const rows = await listAccessLog(actor, eventId);

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Link
          href={`/events/${eventId}/dataroom`}
          className="text-xs font-medium uppercase tracking-wider text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          ← Dataroom
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Activity</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Every upload, download and change, newest first. You see the entries
          for folders you can open — a sealed folder&apos;s activity stays with
          the people on its list.
        </p>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          Nothing recorded yet.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-card bg-card shadow-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-3 font-medium">Who</th>
                <th className="px-4 py-3 font-medium">Did what</th>
                <th className="px-4 py-3 font-medium">File</th>
                <th className="px-4 py-3 font-medium">When</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.id}
                  className="border-b transition-colors last:border-0 hover:bg-surface-2"
                >
                  <td className="px-4 py-2.5">
                    {row.actorName ? (
                      row.actorName
                    ) : row.viewerEmail ? (
                      // an outside visitor, named by the address they gave —
                      // this used to render as "Removed user", which buried
                      // exactly the answer the audit exists to give
                      <span className="flex flex-col">
                        <span>{row.viewerEmail}</span>
                        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                          external
                        </span>
                      </span>
                    ) : (
                      "Shared link (anonymous)"
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground">
                    {VERB[row.action] ?? row.action}
                  </td>
                  <td className="px-4 py-2.5">
                    {row.fileName}
                    {row.versionNo ? (
                      <span className="ml-1.5 text-xs text-muted-foreground">
                        v{row.versionNo}
                      </span>
                    ) : null}
                    {row.note ? (
                      <span className="block text-xs text-muted-foreground">
                        {row.note}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">
                    {row.createdAt.toLocaleString("en-GB", {
                      day: "numeric",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                      timeZone: "Asia/Jakarta",
                    })}{" "}
                    WIB
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
