import type { Metadata } from "next";
import { Logo } from "@/components/logo";
import { RetryButton } from "./retry-button";
import { getBranding } from "@/lib/org/branding";

export const metadata: Metadata = { title: "Offline" };

// Fallback served by the service worker when a navigation fails (T-103).
// Kept static and dependency-free so it can be precached — it must never
// contain user-specific data, since backstage phones get passed around.
export default async function OfflinePage() {
  const branding = await getBranding();
  return (
    <div className="flex min-h-svh flex-col items-center justify-center px-4">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <Logo short={branding.orgShortName} product={branding.productName} className="text-sm" />
        <div className="flex flex-col gap-4 rounded-card bg-card shadow-card p-5">
          <h1 className="text-lg font-semibold uppercase tracking-tight">
            No connection
          </h1>
          <p className="text-sm text-muted-foreground">
            This app needs the network to show live task, approval and budget
            data. Nothing has been lost — reconnect and try again.
          </p>
          <RetryButton />
        </div>
      </div>
    </div>
  );
}
