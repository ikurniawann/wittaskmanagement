import type { Metadata, Viewport } from "next";
import { DM_Sans, Geist_Mono } from "next/font/google";
import { ServiceWorker } from "@/components/service-worker";
import { AppToaster } from "@/components/app-toaster";
import { ThemeProvider } from "@/components/theme-provider";
import "./globals.css";

// One sans face for body and headings (WIT UI style, 2026-09-16). Self-hosted
// through next/font so the app needs no Google request at runtime.
const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const { getBranding, fullName } = await import("@/lib/org/branding");
  const branding = await getBranding();
  const name = fullName(branding);
  return {
    title: { default: name, template: `%s · ${name}` },
    description:
      "Everything behind the scenes — project and task management for production teams.",
    applicationName: name,
    appleWebApp: { capable: true, title: branding.productName },
  };
}

// PWA viewport (T-103): venues mean notched phones held one-handed, so the
// safe-area inset matters and the theme colour follows light/dark.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f1f0f1" },
    { media: "(prefers-color-scheme: dark)", color: "#0b0c0d" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      // next-themes mutates the class on the client before hydration
      suppressHydrationWarning
      className={`${dmSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <ThemeProvider>
          {children}
          <AppToaster />
        </ThemeProvider>
        <ServiceWorker />
      </body>
    </html>
  );
}
