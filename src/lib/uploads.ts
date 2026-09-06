import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { env } from "@/lib/env";

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const FILE_EXTENSIONS = new Set([
  ...IMAGE_EXTENSIONS,
  ".pdf",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".ppt",
  ".pptx",
  ".txt",
  ".csv",
  ".zip",
  // assistant attachments (EPIC-016) — kept in step with src/lib/ai/extract.ts
  ".md",
  ".json",
  ".tsv",
  ".log",
  ".gif",
]);
const MAX_FILE_BYTES = 20 * 1024 * 1024;

/**
 * Profile photos (Owner 2026-09-06). The generic image path rejected exactly
 * what a phone produces — a 6 MB camera JPEG over the 5 MB cap, an iPhone's
 * HEIC — while the avatar is drawn at 56px at most. So the input is allowed
 * to be big and messy, and what is STORED is small and uniform: auto-rotated
 * by EXIF (phone photos arrive sideways otherwise), centre-cropped to a
 * 256px square, encoded as WebP. sharp ships in the runtime image with HEIF
 * support, so HEIC decodes server-side.
 */
const AVATAR_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif", ".gif"]);
const MAX_AVATAR_INPUT_BYTES = 20 * 1024 * 1024;
const AVATAR_SIZE = 256;

export async function saveAvatarUpload(file: File): Promise<string> {
  const ext = path.extname(file.name).toLowerCase();
  if (!AVATAR_EXTENSIONS.has(ext)) {
    throw new Error("Unsupported image type (jpg, png, webp, heic or gif).");
  }
  if (file.size > MAX_AVATAR_INPUT_BYTES) {
    throw new Error("That photo is larger than 20 MB.");
  }

  const { default: sharp } = await import("sharp");
  let bytes: Buffer;
  try {
    bytes = await sharp(Buffer.from(await file.arrayBuffer()))
      .rotate() // honour EXIF orientation, then strip it
      .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: "cover", position: "attention" })
      .webp({ quality: 82 })
      .toBuffer();
  } catch {
    throw new Error("That file could not be read as an image.");
  }

  const relative = path.join("avatars", `${randomUUID()}.webp`);
  const absolute = path.join(path.resolve(env.UPLOADS_DIR), relative);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, bytes);
  return relative;
}

// Generic attachment upload (T-034): documents + images, 20 MB cap.
export async function saveFileUpload(
  file: File,
  subdir: "attachments" | "comments" | "documents" | "ai",
): Promise<string> {
  const ext = path.extname(file.name).toLowerCase();
  if (!FILE_EXTENSIONS.has(ext)) {
    throw new Error("Unsupported file type.");
  }
  if (file.size > MAX_FILE_BYTES) {
    throw new Error("File exceeds the 20 MB limit.");
  }
  const relative = path.join(subdir, `${randomUUID()}${ext}`);
  const absolute = path.join(path.resolve(env.UPLOADS_DIR), relative);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, Buffer.from(await file.arrayBuffer()));
  return relative;
}

// Store an uploaded image under UPLOADS_DIR/<subdir>/, return the relative
// path persisted on the record (served via /api/files/<relative-path>).
export async function saveImageUpload(
  file: File,
  subdir: "posters" | "comments" | "pages" | "avatars",
): Promise<string> {
  const ext = path.extname(file.name).toLowerCase();
  if (!IMAGE_EXTENSIONS.has(ext)) {
    throw new Error("Unsupported image type (jpg, png, webp only).");
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error("Image exceeds the 5 MB limit.");
  }

  const relative = path.join(subdir, `${randomUUID()}${ext}`);
  const absolute = path.join(path.resolve(env.UPLOADS_DIR), relative);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, Buffer.from(await file.arrayBuffer()));
  return relative;
}
