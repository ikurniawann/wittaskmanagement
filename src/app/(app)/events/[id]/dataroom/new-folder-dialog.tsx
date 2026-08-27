"use client";

import { FolderPlus, Globe, Lock, Users, Folder } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Segmented } from "@/components/segmented";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { allowedChildLevels, type Visibility } from "@/lib/dataroom/access";
import { createFolderAction } from "./actions";

// New folder, as a plain overlay (Owner bug report 2026-08-12). The previous
// version drove a base-ui Dialog from useActionState plus a closing effect,
// and could wedge open: `state.ok` was never reset, so the effect's verdict
// depended on render order, and the portal's exit animation kept the
// full-screen backdrop up — swallowing every click until a refresh. This one
// follows the Rename dialog beside it: mounted fresh each time it opens,
// closed imperatively on success. No effect, no stale state, nothing to hang.

const LEVEL_META: Record<Visibility, { label: string; icon: React.ReactNode; hint: string }> = {
  sealed: { label: "Sealed", icon: <Lock className="size-3.5" />, hint: "Only people you name — not even the Owner" },
  division: { label: "Division", icon: <Users className="size-3.5" />, hint: "One division's members" },
  event: { label: "Project", icon: <Folder className="size-3.5" />, hint: "Anyone who can see this project" },
  organisation: { label: "Everyone", icon: <Globe className="size-3.5" />, hint: "Every internal user" },
};

export function NewFolderDialog({
  eventId,
  parent,
  divisions,
  onClose,
}: {
  eventId: string;
  parent: { id: string; name: string; visibility: Visibility } | null;
  divisions: Array<{ id: string; name: string }>;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  // a child may only narrow, so wider options are simply not offered
  const levels = allowedChildLevels(parent?.visibility ?? "organisation");
  const [level, setLevel] = useState<Visibility>(
    levels.includes("event") ? "event" : levels[0],
  );
  const [divisionId, setDivisionId] = useState(divisions[0]?.id ?? "");

  const submit = () => {
    const data = new FormData();
    data.set("eventId", eventId);
    data.set("parentId", parent?.id ?? "");
    data.set("name", name);
    data.set("visibility", level);
    data.set("divisionId", level === "division" ? divisionId : "");
    startTransition(async () => {
      const result = await createFolderAction({}, data);
      if (result.error) {
        setError(result.error);
        return;
      }
      onClose();
      router.refresh();
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) submit();
        }}
        className="flex w-full max-w-md flex-col gap-4 rounded-lg border bg-card p-5 shadow-lg"
      >
        <div className="flex flex-col gap-1">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <FolderPlus className="size-4" /> New folder
          </h2>
          <p className="text-xs text-muted-foreground">
            {parent
              ? `Inside “${parent.name}”. It cannot be more open than its parent.`
              : "At the top level of this project's dataroom."}
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="nf-name" className="text-xs">
            Name
          </Label>
          <Input
            id="nf-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoFocus
            placeholder="Vendor contracts"
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
            }}
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label className="text-xs">Who can see it</Label>
          <Segmented
            name="visibility-display"
            options={levels.map((v) => ({
              value: v,
              label: LEVEL_META[v].label,
              icon: LEVEL_META[v].icon,
              hint: LEVEL_META[v].hint,
            }))}
            defaultValue={level}
            onValueChange={(v) => setLevel(v as Visibility)}
          />
          <span className="text-[11px] text-muted-foreground">
            {LEVEL_META[level].hint}
          </span>
        </div>

        {level === "division" && divisions.length > 0 ? (
          <div className="flex flex-col gap-2">
            <Label className="text-xs">Which division</Label>
            <Segmented
              name="division-display"
              options={divisions.map((d) => ({ value: d.id, label: d.name }))}
              defaultValue={divisionId}
              onValueChange={setDivisionId}
            />
          </div>
        ) : null}

        {error ? (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        ) : null}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={pending || !name.trim()}>
            {pending ? "Creating…" : "Create folder"}
          </Button>
        </div>
      </form>
    </div>
  );
}
