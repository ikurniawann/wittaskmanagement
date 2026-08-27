import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Geist, Geist_Mono } from "next/font/google";
import { ServiceWorker } from "@/components/service-worker";
import { AppToaster } from "@/components/app-toaster";
import { ThemeProvider } from "@/components/theme-provider";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Headings only (design refresh 2026-08-12). One typeface doing both body and
// headings is the main reason the app read as flat: nothing on the page had a
// voice. Bricolage is editorial rather than corporate, which suits a concert
// promoter — and it stays off body text, where Geist is the better reader.
const displaySans = Bricolage_Grotesque({
  variable: "--font-display",
  subsets: ["latin"],
  display: "swap",
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
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#000000" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      // next-themes mutates the class on the client before hydration
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} ${displaySans.variable} h-full antialiased`}
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
