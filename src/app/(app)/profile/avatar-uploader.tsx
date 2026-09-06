"use client";

import { Camera, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useTransition } from "react";
import { toast } from "sonner";
import { UserAvatar } from "@/components/task-meta";
import { cn } from "@/lib/utils";
import {
  removeMyAvatarAction,
  uploadMyAvatarAction,
} from "@/app/(app)/settings/actions";

// The avatar is its own upload control (Owner 2026-08-12): click the photo,
// pick an image, done. jpg/png/webp up to 5 MB, enforced server-side.

export function AvatarUploader({
  name,
  avatarPath,
}: {
  name: string;
  avatarPath: string | null;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();

  const upload = (file: File) => {
    const data = new FormData();
    data.set("avatar", file);
    startTransition(async () => {
      const result = await uploadMyAvatarAction({}, data);
      if (result.error) toast.error(result.error);
      else {
        toast.success("Photo updated.");
        router.refresh();
      }
    });
  };

  const remove = () => {
    startTransition(async () => {
      const result = await removeMyAvatarAction();
      if (result.error) toast.error(result.error);
      else router.refresh();
    });
  };

  return (
    <div className="flex items-center gap-3">
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif,image/gif"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) upload(file);
          e.target.value = "";
        }}
      />
      <button
        type="button"
        onClick={() => input.current?.click()}
        disabled={pending}
        aria-label="Change profile photo"
        title="Change photo"
        className={cn(
          "group relative cursor-pointer rounded-full outline-none",
          "focus-visible:ring-2 focus-visible:ring-foreground/40",
          pending && "opacity-60",
        )}
      >
        <UserAvatar name={name} src={avatarPath} className="size-14 text-lg" />
        <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/45 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
          <Camera className="size-4 text-white" />
        </span>
      </button>
      {avatarPath ? (
        <button
          type="button"
          onClick={remove}
          disabled={pending}
          className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-destructive"
        >
          <Trash2 className="size-3.5" /> Remove photo
        </button>
      ) : null}
    </div>
  );
}
