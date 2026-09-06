import type { MetadataRoute } from "next";

// PWA manifest (T-103). Backstage crews work from phones in venues, so the
// app is installable and opens standalone — no browser chrome eating the
// viewport. Monochrome to match the app theme.
/**
 * Rendered per request, NOT at build time.
 *
 * Without this Next prerenders the manifest into a static file during
 * `next build`, where the database is unreachable and getBranding() falls back
 * to its defaults — so an installed app was called "Your Organisation
 * Backstage" no matter what the org had set, while every page title showed the
 * real branding (Owner 2026-08-31). The page titles were right only because
 * generateMetadata() in layout.tsx is already per-request.
 */
export const dynamic = "force-dynamic";

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const { getBranding, fullName } = await import("@/lib/org/branding");
  const branding = await getBranding();
  return {
    name: fullName(branding),
    short_name: branding.productName,
    description:
      `Everything behind the scenes — project and task management for ${branding.orgName}.`,
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#000000",
    theme_color: "#000000",
    categories: ["productivity", "business"],
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    shortcuts: [
      { name: "My tasks", url: "/my-tasks" },
      { name: "Approvals", url: "/approvals" },
    ],
  };
}
