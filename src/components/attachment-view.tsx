import { Paperclip } from "lucide-react";

const IMAGE_EXT = /\.(jpe?g|png|webp)$/i;

// Renders a comment attachment: images inline (socmed-style), documents as
// a download chip. Files are served through the auth-gated /api/files route.
export function AttachmentView({
  path,
  name,
}: {
  path: string;
  name: string | null;
}) {
  if (IMAGE_EXT.test(path)) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- auth-gated route
      <img
        src={`/api/files/${path}`}
        alt={name ?? "Attached image"}
        className="max-h-96 w-fit max-w-full rounded-lg border object-contain"
      />
    );
  }
  return (
    <a
      href={`/api/files/${path}`}
      download={name ?? true}
      className="inline-flex w-fit items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-surface-2"
    >
      <Paperclip className="size-3.5" />
      {name ?? "Attachment"}
    </a>
  );
}
