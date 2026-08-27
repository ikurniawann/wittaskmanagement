import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { sessionActor } from "@/lib/auth/session-actor";
import { defaultQuota, listEventStorage } from "@/lib/dataroom/service";
import { DISK_FLOOR_BYTES, formatBytes } from "@/lib/dataroom/quota";
import { freeDiskBytes } from "@/lib/dataroom/storage";
import { can } from "@/lib/permissions";
import { DefaultQuotaForm, StorageTable } from "./storage-table";

export const metadata: Metadata = { title: "Storage" };

const GIB = 1024 ** 3;

// EPIC-017 T-175. Owner/Admin only: a division head able to raise their own
// ceiling would turn the quota into a suggestion.
export default async function StoragePage() {
  const actor = await sessionActor();
  if (!actor || !can(actor, "org.manage")) redirect("/my-tasks");

  const [rows, fallback, free] = await Promise.all([
    listEventStorage(actor),
    defaultQuota(),
    freeDiskBytes(),
  ]);
  const low = free < DISK_FLOOR_BYTES * 2;

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Link
          href="/admin"
          className="text-xs font-medium uppercase tracking-wider text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          ← Admin
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight">Storage</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          How much dataroom space each project uses. Lowering a limit never
          deletes anything — the project simply cannot upload again until it is
          back under.
        </p>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-4 rounded-md border bg-card p-4">
        <DefaultQuotaForm defaultGb={Math.round((fallback / GIB) * 10) / 10} />
        <div className="flex flex-col gap-0.5 text-right">
          <span className="text-xs text-muted-foreground">Free on the storage disk</span>
          <span className={low ? "font-semibold text-priority-high" : "font-semibold"}>
            {formatBytes(free)}
          </span>
          <span className="text-[11px] text-muted-foreground">
            Uploads stop everywhere below {formatBytes(DISK_FLOOR_BYTES)}, whatever
            a project&apos;s own limit says.
          </span>
        </div>
      </div>

      <StorageTable rows={rows} />
    </section>
  );
}
