"use client";

import { CheckCircle2, Loader2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { cn } from "@/lib/utils";

// "Upload Progress Files" — a guest filing documents against one sub-task
// (Owner 2026-08-27). Streamed straight to the route so a large file never
// sits in memory; the route re-checks the link on arrival.

export function UploadPanel({
  token,
  targets,
}: {
  token: string;
  targets: Array<{ id: string; title: string }>;
}) {
  const [itemId, setItemId] = useState(targets[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  if (targets.length === 0) return null;

  const send = async (files: FileList) => {
    setError(null);
    setBusy(true);
    try {
      for (const file of Array.from(files)) {
        const res = await fetch(
          `/api/progress/${token}/upload?item=${encodeURIComponent(itemId)}&name=${encodeURIComponent(file.name)}`,
          {
            method: "POST",
            body: file,
            headers: { "content-type": file.type || "application/octet-stream" },
          },
        );
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
          folderPath?: string;
        };
        if (!res.ok) throw new Error(body.error ?? "Upload failed.");
        setDone((prev) => [...prev, `${file.name} → ${body.folderPath ?? ""}`]);
      }
      if (fileRef.current) fileRef.current.value = "";
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex w-full flex-col gap-3 rounded-md border bg-card p-4">
      <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        <Upload className="size-3.5" /> Upload Progress Files
      </h2>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <select
          value={itemId}
          onChange={(e) => setItemId(e.target.value)}
          aria-label="Which sub-task is this for?"
          className="h-9 min-w-0 flex-1 rounded-md border bg-background px-2.5 text-sm outline-none focus:border-foreground/40"
        >
          {targets.map((t) => (
            <option key={t.id} value={t.id}>
              {t.title}
            </option>
          ))}
        </select>

        <input
          ref={fileRef}
          type="file"
          multiple
          disabled={busy || !itemId}
          onChange={(e) => {
            if (e.target.files?.length) void send(e.target.files);
          }}
          className={cn(
            "text-xs file:mr-2 file:rounded-md file:border file:bg-background file:px-3 file:py-1.5 file:text-xs file:font-medium",
            busy && "opacity-50",
          )}
        />
      </div>

      {busy ? (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" /> Uploading…
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}

      {done.map((line) => (
        <p key={line} className="flex items-center gap-1.5 text-xs text-status-done">
          <CheckCircle2 className="size-3.5" /> {line}
        </p>
      ))}

      <p className="text-[11px] text-muted-foreground">
        Files go to the team&apos;s document room, filed under the sub-task you
        pick. They are not public — only the project team can open them.
      </p>
    </div>
  );
}
