import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone server bundle — required by the Docker image (T-002).
  output: "standalone",
  experimental: {
    // Server Actions default to a 1 MB body, which rejected uploads with a 413
    // *before* src/lib/uploads.ts could apply its own caps — a 5 MB poster or
    // avatar died as "A server error occurred". Sits above the largest action
    // upload (20 MB task attachments / documents) plus multipart overhead, so
    // the app's limits stay the ones that actually decide. nginx already
    // allows 50m, so it is not the constraint.
    serverActions: { bodySizeLimit: "24mb" },
  },
  // pdfkit loads its AFM font data from node_modules at runtime — keep it
  // external so the standalone tracer ships those files (report PDFs).
  // Baileys is required at runtime, never bundled: it pulls optional deps
  // (jimp, sharp) that we don't use for text-only sending, and bundling it
  // would force those to resolve at build time.
  serverExternalPackages: ["pdfkit", "@whiskeysockets/baileys",
    // assistant attachment readers (EPIC-016): keep them out of the bundle,
    // same reason as pdfkit — they carry optional/native deps Turbopack
    // cannot resolve at build time
    "exceljs",
    "mammoth",
    "unpdf",
    // imported directly now (profile photos); keep it out of the bundle
    "sharp",
  ],
};

export default nextConfig;
