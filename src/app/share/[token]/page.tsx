import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { ChevronRight, Download, FileText, Folder } from "lucide-react";
import { getBranding } from "@/lib/org/branding";
import {
  listSharedFolder,
  resolveShare,
  type ResolvedFolderShare,
} from "@/lib/dataroom/share-service";
import { readSharePass, SHARE_COOKIE } from "@/lib/dataroom/share-session";
import { GateForm } from "./gate-form";

// Shared with someone who has no account (EPIC-018 T-181; folders added by
// Owner request 2026-08-27). Outside the (app) group: no sidebar, no session,
// nothing of the workspace.
export const metadata: Metadata = {
  title: "Shared",
  // a shared contract must never end up in a search index
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

const FOOTER =
  "This link expires, and the sender can withdraw it at any time. Opens are recorded.";

async function FolderView({
  token,
  share,
  path,
}: {
  token: string;
  share: ResolvedFolderShare;
  path?: string;
}) {
  const listing = await listSharedFolder(share, path);

  // null = the requested folder is not inside the shared one. Refused in the
  // same words as anything else missing, so a guessed id learns nothing.
  if (!listing) {
    return (
      <p className="rounded-md border border-dashed px-4 py-6 text-sm text-muted-foreground">
        That folder is not part of this link.
      </p>
    );
  }

  const empty = listing.folders.length === 0 && listing.files.length === 0;

  return (
    <div className="flex w-full max-w-3xl flex-col gap-3">
      {listing.trail.length > 1 ? (
        <nav
          aria-label="Folder path"
          className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground"
        >
          {listing.trail.map((step, i) => (
            <span key={step.id} className="flex items-center gap-1">
              {i > 0 ? <ChevronRight className="size-3" /> : null}
              {i === listing.trail.length - 1 ? (
                <span className="font-medium text-foreground">{step.name}</span>
              ) : (
                <Link
                  href={`/share/${token}?path=${step.id}`}
                  className="underline-offset-4 hover:text-foreground hover:underline"
                >
                  {step.name}
                </Link>
              )}
            </span>
          ))}
        </nav>
      ) : null}

      <ul className="flex flex-col divide-y rounded-md border bg-card">
        {empty ? (
          <li className="px-4 py-6 text-center text-sm text-muted-foreground">
            This folder is empty.
          </li>
        ) : null}

        {listing.folders.map((folder) => (
          <li key={folder.id}>
            <Link
              href={`/share/${token}?path=${folder.id}`}
              className="flex items-center gap-2.5 px-4 py-2.5 text-sm transition-colors hover:bg-accent/40"
            >
              <Folder className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate font-medium">{folder.name}</span>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
            </Link>
          </li>
        ))}

        {listing.files.map((file) => (
          <li key={file.id} className="flex items-center gap-2.5 px-4 py-2.5 text-sm">
            <FileText className="size-4 shrink-0 text-muted-foreground" />
            <a
              href={`/api/share/${token}?file=${file.id}`}
              target="_blank"
              rel="noreferrer"
              className="min-w-0 flex-1 truncate underline-offset-4 hover:underline"
            >
              {file.name}
            </a>
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
              {formatBytes(file.sizeBytes)}
            </span>
            {share.allowDownload ? (
              <a
                href={`/api/share/${token}?file=${file.id}&download=1`}
                aria-label={`Download ${file.name}`}
                className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <Download className="size-4" />
              </a>
            ) : null}
          </li>
        ))}
      </ul>

      <p className="text-[11px] text-muted-foreground">
        {share.allowDownload
          ? FOOTER
          : `Downloading is turned off for this link. You can read the files here. ${FOOTER}`}
      </p>
    </div>
  );
}

export default async function SharePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ path?: string }>;
}) {
  const { token } = await params;
  const { path } = await searchParams;
  const branding = await getBranding();
  const jar = await cookies();
  const pass = readSharePass(token, jar.get(SHARE_COOKIE)?.value);

  const resolution = await resolveShare(token, {
    email: pass?.email ?? undefined,
    passcodeVerified: pass?.passcodeOk,
  });

  const heading = !resolution.ok
    ? "Shared with you"
    : resolution.kind === "folder"
      ? resolution.share.rootFolderName
      : resolution.share.fileName;

  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-6 bg-background p-6">
      <div className="flex flex-col items-center gap-1.5 text-center">
        {resolution.ok && resolution.kind === "folder" ? (
          <Folder className="size-6 text-muted-foreground" />
        ) : (
          <FileText className="size-6 text-muted-foreground" />
        )}
        <h1 className="text-lg font-semibold">{heading}</h1>
        <p className="text-xs text-muted-foreground">
          Shared securely by {branding.orgName}
        </p>
      </div>

      {!resolution.ok ? (
        <GateForm
          token={token}
          needsPasscode={resolution.needsPasscode}
          needsEmail={resolution.needsEmail}
          message={
            resolution.needsEmail || resolution.needsPasscode
              ? null
              : resolution.message
          }
        />
      ) : resolution.kind === "folder" ? (
        <FolderView token={token} share={resolution.share} path={path} />
      ) : (
        <div className="flex w-full max-w-4xl flex-col gap-3">
          <iframe
            src={`/api/share/${token}`}
            title={resolution.share.fileName}
            className="h-[70svh] w-full rounded-md border bg-card"
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            {resolution.share.allowDownload ? (
              <a
                href={`/api/share/${token}?download=1`}
                className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm transition-colors hover:bg-accent/40"
              >
                <Download className="size-4" /> Download
              </a>
            ) : (
              <span className="text-xs text-muted-foreground">
                Downloading is turned off for this link. You can read it here.
              </span>
            )}
            <span className="text-[11px] text-muted-foreground">{FOOTER}</span>
          </div>
        </div>
      )}
    </main>
  );
}
