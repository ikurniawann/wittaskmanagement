"use client";

import {
  Archive,
  ChevronRight,
  Download,
  File as FileIcon,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo,
  Folder,
  FolderPlus,
  Globe,
  LayoutGrid,
  List,
  Loader2,
  Lock,
  MoreVertical,
  Music,
  Pencil,
  Share2,
  Trash2,
  Upload,
  Users,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { ContextMenu, useContextMenu, type MenuItem } from "@/components/context-menu";
import { Button } from "@/components/ui/button";
import type { Visibility } from "@/lib/dataroom/access";
import { cn } from "@/lib/utils";
import { fileMenuAction } from "./actions";
import { NewFolderDialog } from "./new-folder-dialog";
import { ShareDialog, type ShareTarget } from "./share-dialog";

// A Drive-shaped file manager (Owner 2026-08-11, second pass): a collapsible
// folder tree, folders dropped onto folders become sub-folders, the content
// pane shows sub-folders + files behind a breadcrumb, and the view switches
// between list and tiles.
//
// Tiles use type icons, never content previews. Every byte read in the
// dataroom lands in the access log — a grid of fifty images would write fifty
// phantom "view" entries each time the page opened, and the log would lie.

export interface FolderView {
  id: string;
  name: string;
  parentId: string | null;
  visibility: Visibility;
  divisionId: string | null;
  canUpload: boolean;
  canManage: boolean;
  /** newest change of any file in the subtree; null when nothing lives here */
  updatedAt: string | null;
}

interface FileView {
  id: string;
  name: string;
  currentVersion: number;
  updatedAt: string;
}

type Dragged = { kind: "file"; file: FileView } | { kind: "folder"; folder: FolderView };

const LEVEL_ICON: Record<Visibility, React.ReactNode> = {
  sealed: <Lock className="size-4" />,
  division: <Users className="size-4" />,
  event: <Folder className="size-4" />,
  organisation: <Globe className="size-4" />,
};

const LEVEL_LABEL: Record<Visibility, string> = {
  sealed: "Sealed — named people only",
  division: "One division",
  event: "Anyone on this project",
  organisation: "Everyone internal",
};

const WIDTH: Record<Visibility, number> = {
  sealed: 0,
  division: 1,
  event: 2,
  organisation: 3,
};

/** Icon by extension — recognition beats reading in a tile grid. */
function fileTypeIcon(name: string, className: string): React.ReactNode {
  const ext = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
  if (["png", "jpg", "jpeg", "webp", "gif", "svg"].includes(ext))
    return <FileImage className={className} />;
  if (["xlsx", "xls", "csv", "tsv"].includes(ext))
    return <FileSpreadsheet className={className} />;
  if (["pdf", "doc", "docx", "txt", "md"].includes(ext))
    return <FileText className={className} />;
  if (["mp4", "mov", "webm", "mkv"].includes(ext))
    return <FileVideo className={className} />;
  if (["mp3", "wav", "flac", "m4a"].includes(ext))
    return <Music className={className} />;
  if (["zip", "rar", "7z", "tar", "gz"].includes(ext))
    return <Archive className={className} />;
  return <FileIcon className={className} />;
}

export function DataroomBrowser({
  eventId,
  folders,
  openFolderId,
  files,
  divisions,
  view,
}: {
  eventId: string;
  folders: FolderView[];
  openFolderId: string | null;
  files: FileView[];
  divisions: Array<{ id: string; name: string }>;
  view: "list" | "grid";
}) {
  const router = useRouter();
  const open = folders.find((f) => f.id === openFolderId) ?? null;

  const byId = new Map(folders.map((f) => [f.id, f]));
  const children = new Map<string | null, FolderView[]>();
  for (const f of folders) {
    const list = children.get(f.parentId) ?? [];
    list.push(f);
    children.set(f.parentId, list);
  }

  // ancestors of the open folder start expanded, so the selection is visible
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const start = new Set<string>();
    let cursor = open?.parentId ?? null;
    while (cursor) {
      start.add(cursor);
      cursor = byId.get(cursor)?.parentId ?? null;
    }
    return start;
  });

  const [uploading, setUploading] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [dropTarget, setDropTarget] = useState<"pane" | "root" | string | null>(null);
  const [newFolderFor, setNewFolderFor] = useState<FolderView | null | undefined>(undefined);
  const [sharing, setSharing] = useState<ShareTarget | null>(null);
  const [renaming, setRenaming] = useState<{ kind: "file" | "folder"; id: string; name: string } | null>(null);
  const [, startTransition] = useTransition();
  const fileInput = useRef<HTMLInputElement>(null);
  const dragged = useRef<Dragged | null>(null);

  const fileMenu = useContextMenu<FileView>();
  const folderMenu = useContextMenu<FolderView>();
  // right-click on the pane's background — not on a row, which claims the
  // event first via preventDefault
  const paneMenu = useContextMenu<true>();

  const goto = (folderId: string | null) =>
    router.push(
      `/events/${eventId}/dataroom?${new URLSearchParams({
        ...(folderId ? { f: folderId } : {}),
        ...(view === "grid" ? { view: "grid" } : {}),
      })}`,
    );

  const run = (form: Record<string, string>) => {
    const data = new FormData();
    data.set("eventId", eventId);
    for (const [k, v] of Object.entries(form)) data.set(k, v);
    startTransition(async () => {
      const result = await fileMenuAction({}, data);
      if (result.error) toast.error(result.error);
      else router.refresh();
    });
  };

  const uploadOne = (file: File, folderId: string) =>
    new Promise<void>((resolve) => {
      const xhr = new XMLHttpRequest();
      const query = new URLSearchParams({ folderId, name: file.name });
      xhr.open("PUT", `/api/dataroom/upload?${query}`);
      xhr.setRequestHeader("x-file-type", file.type || "application/octet-stream");
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100));
      };
      xhr.onload = () => {
        const body = (() => {
          try {
            return JSON.parse(xhr.responseText) as { error?: string; crossedWarning?: boolean };
          } catch {
            return {};
          }
        })();
        if (xhr.status >= 400) toast.error(body.error ?? `${file.name} was refused.`);
        else if (body.crossedWarning)
          toast.warning(`${file.name} uploaded — this event has passed 80% of its storage.`);
        else toast.success(`${file.name} uploaded.`);
        resolve();
      };
      xhr.onerror = () => {
        toast.error(`${file.name} failed — the connection dropped.`);
        resolve();
      };
      xhr.send(file);
    });

  const uploadMany = async (list: FileList | File[], folderId: string) => {
    const chosen = Array.from(list);
    if (chosen.length === 0) return;
    for (const file of chosen) {
      setUploading(file.name);
      setProgress(0);
      await uploadOne(file, folderId);
    }
    setUploading(null);
    router.refresh();
  };

  /** One handler for every drop surface: desktop files, a dragged row, or a
   *  dragged folder. `target` null = the top level. */
  const handleDrop = (event: React.DragEvent, target: FolderView | null) => {
    event.preventDefault();
    event.stopPropagation();
    setDropTarget(null);
    const payload = dragged.current;
    dragged.current = null;

    if (!payload) {
      if (event.dataTransfer.files?.length && target) {
        void uploadMany(event.dataTransfer.files, target.id);
      }
      return;
    }

    if (payload.kind === "file") {
      if (!target || !open || target.id === open.id) return;
      if (WIDTH[target.visibility] > WIDTH[open.visibility]) {
        const ok = window.confirm(
          `“${target.name}” is more open than “${open.name}”. Moving ${payload.file.name} there makes it visible to more people. Continue?`,
        );
        if (!ok) return;
      }
      run({ verb: "move-file", fileId: payload.file.id, folderId: target.id });
      return;
    }

    // folder onto folder → sub-folder; folder onto the root strip → top level
    const moving = payload.folder;
    if (target && target.id === moving.id) return;
    run({
      verb: "move-folder",
      folderId: moving.id,
      parentId: target?.id ?? "",
    });
  };

  const allowDrop = (event: React.DragEvent, targetId: "pane" | "root" | string) => {
    if (!dragged.current && !event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    event.stopPropagation();
    setDropTarget(targetId);
  };

  const fileItems = (file: FileView): MenuItem[] => [
    {
      label: "Download",
      icon: <Download className="size-3.5" />,
      onSelect: () => window.open(`/api/dataroom/files/${file.id}`, "_blank"),
    },
    ...(open?.canUpload
      ? [
          {
            label: "Share outside…",
            icon: <Share2 className="size-3.5" />,
            onSelect: () => setSharing({ kind: "file", id: file.id, name: file.name }),
          },
          {
            label: "Rename…",
            icon: <Pencil className="size-3.5" />,
            onSelect: () => setRenaming({ kind: "file", id: file.id, name: file.name }),
          },
          {
            label: "Move to trash",
            icon: <Trash2 className="size-3.5" />,
            danger: true,
            onSelect: () => run({ verb: "trash-file", fileId: file.id }),
          },
        ]
      : []),
  ];

  const folderItems = (folder: FolderView): MenuItem[] => [
    {
      label: "New folder inside…",
      icon: <FolderPlus className="size-3.5" />,
      disabled: !folder.canUpload,
      onSelect: () => setNewFolderFor(folder),
    },
    ...(folder.canManage
      ? [
          {
            // manage-level on purpose: handing over a folder gives away
            // everything nested inside it, now and later
            label: "Share folder outside…",
            icon: <Share2 className="size-3.5" />,
            onSelect: () =>
              setSharing({ kind: "folder", id: folder.id, name: folder.name }),
          },
          {
            label: "Rename…",
            icon: <Pencil className="size-3.5" />,
            onSelect: () => setRenaming({ kind: "folder", id: folder.id, name: folder.name }),
          },
          {
            label: "Delete folder",
            icon: <Trash2 className="size-3.5" />,
            danger: true,
            onSelect: () => run({ verb: "delete-folder", folderId: folder.id }),
          },
        ]
      : []),
  ];

  /** The recursive tree row: chevron toggles, name navigates, both drag. */
  const TreeRow = ({ folder, depth }: { folder: FolderView; depth: number }) => {
    const kids = children.get(folder.id) ?? [];
    const isExpanded = expanded.has(folder.id);
    return (
      <>
        <div
          draggable={folder.canManage}
          onDragStart={(e) => {
            e.stopPropagation();
            dragged.current = { kind: "folder", folder };
          }}
          onDragEnd={() => {
            dragged.current = null;
            setDropTarget(null);
          }}
          onDragOver={(e) => allowDrop(e, folder.id)}
          onDragLeave={() => setDropTarget(null)}
          onDrop={(e) => handleDrop(e, folder)}
          onContextMenu={(e) => folderMenu.openAt(e, folder)}
          style={{ paddingLeft: depth * 14 + 4 }}
          className={cn(
            "group flex items-center gap-1 rounded-md py-1.5 pr-1 text-sm transition-colors",
            folder.id === openFolderId
              ? "bg-accent font-medium"
              : "text-muted-foreground hover:bg-accent/40 hover:text-foreground",
            dropTarget === folder.id && "ring-2 ring-foreground/40",
          )}
        >
          <button
            type="button"
            aria-label={isExpanded ? "Collapse" : "Expand"}
            onClick={() =>
              setExpanded((prev) => {
                const next = new Set(prev);
                if (next.has(folder.id)) next.delete(folder.id);
                else next.add(folder.id);
                return next;
              })
            }
            className={cn(
              "flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-transform hover:text-foreground",
              kids.length === 0 && "invisible",
              isExpanded && "rotate-90",
            )}
          >
            <ChevronRight className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={() => goto(folder.id)}
            title={LEVEL_LABEL[folder.visibility]}
            className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 text-left"
          >
            <span className="shrink-0 text-muted-foreground">
              {LEVEL_ICON[folder.visibility]}
            </span>
            <span className="truncate">{folder.name}</span>
          </button>
        </div>
        {isExpanded
          ? kids.map((kid) => <TreeRow key={kid.id} folder={kid} depth={depth + 1} />)
          : null}
      </>
    );
  };

  // breadcrumb chain, root-first
  const crumbs: FolderView[] = [];
  {
    let cursor: FolderView | null = open;
    while (cursor) {
      crumbs.unshift(cursor);
      cursor = cursor.parentId ? (byId.get(cursor.parentId) ?? null) : null;
    }
  }
  const subfolders = open ? (children.get(open.id) ?? []) : (children.get(null) ?? []);

  const openFolderTile = (folder: FolderView) => goto(folder.id);
  const openFile = (file: FileView) =>
    window.open(`/api/dataroom/files/${file.id}?inline=1`, "_blank");

  return (
    <div className="grid gap-5 lg:grid-cols-[250px_1fr]">
      {/* ---- folder tree ---- */}
      <div className="flex flex-col gap-2">
        <div
          onDragOver={(e) => allowDrop(e, "root")}
          onDragLeave={() => setDropTarget(null)}
          onDrop={(e) => handleDrop(e, null)}
          className={cn(
            "flex items-center justify-between rounded-md px-1 py-1",
            dropTarget === "root" && "ring-2 ring-foreground/40",
          )}
          title="Drop a folder here to move it to the top level"
        >
          <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            Folders
          </span>
          <button
            type="button"
            onClick={() => setNewFolderFor(null)}
            className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <FolderPlus className="size-3.5" /> New
          </button>
        </div>

        {folders.length === 0 ? (
          <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
            No folders yet. Create one to start filing documents.
          </p>
        ) : (
          <nav className="flex flex-col gap-0.5">
            {(children.get(null) ?? []).map((folder) => (
              <TreeRow key={folder.id} folder={folder} depth={0} />
            ))}
          </nav>
        )}
      </div>

      {/* ---- content pane ---- */}
      <div
        onDragOver={(e) => {
          if (!open?.canUpload || dragged.current) return;
          allowDrop(e, "pane");
        }}
        onDragLeave={() => setDropTarget(null)}
        onDrop={(e) => open && handleDrop(e, open)}
        onContextMenu={(e) => {
          // rows and tiles preventDefault when they open their own menu;
          // anything still unclaimed here is the background
          if (e.defaultPrevented) return;
          paneMenu.openAt(e, true);
        }}
        className={cn(
          "flex min-h-[60svh] flex-col gap-3 rounded-lg border border-transparent p-1 transition-colors",
          dropTarget === "pane" && "border-dashed border-foreground/40 bg-accent/20",
        )}
      >
        <div className="flex flex-wrap items-center justify-between gap-2 px-1">
          {/* breadcrumbs */}
          <nav className="flex min-w-0 items-center gap-1 text-sm">
            <button
              type="button"
              onClick={() => goto(null)}
              className={cn(
                "shrink-0 cursor-pointer rounded px-1.5 py-0.5 transition-colors",
                open ? "text-muted-foreground hover:text-foreground" : "font-medium",
              )}
            >
              Dataroom
            </button>
            {crumbs.map((crumb, i) => (
              <span key={crumb.id} className="flex min-w-0 items-center gap-1">
                <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/60" />
                <button
                  type="button"
                  onClick={() => goto(crumb.id)}
                  className={cn(
                    "cursor-pointer truncate rounded px-1.5 py-0.5 transition-colors",
                    i === crumbs.length - 1
                      ? "font-medium"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {crumb.name}
                </button>
              </span>
            ))}
            {open ? (
              <span
                className="ml-1 shrink-0 rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground"
                title={LEVEL_LABEL[open.visibility]}
              >
                {open.visibility}
              </span>
            ) : null}
          </nav>

          <div className="flex items-center gap-1.5">
            {/* view toggle rides the URL so reload and share keep it */}
            <div className="flex rounded-md border p-0.5">
              {(
                [
                  { key: "list", icon: <List className="size-3.5" />, label: "List view" },
                  { key: "grid", icon: <LayoutGrid className="size-3.5" />, label: "Tile view" },
                ] as const
              ).map((option) => (
                <button
                  key={option.key}
                  type="button"
                  aria-label={option.label}
                  onClick={() =>
                    router.push(
                      `/events/${eventId}/dataroom?${new URLSearchParams({
                        ...(openFolderId ? { f: openFolderId } : {}),
                        ...(option.key === "grid" ? { view: "grid" } : {}),
                      })}`,
                    )
                  }
                  className={cn(
                    "flex size-7 cursor-pointer items-center justify-center rounded transition-colors",
                    view === option.key
                      ? "bg-accent text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {option.icon}
                </button>
              ))}
            </div>
            {open?.canUpload ? (
              <>
                <input
                  ref={fileInput}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files && open) void uploadMany(e.target.files, open.id);
                    e.target.value = "";
                  }}
                />
                <Button
                  size="sm"
                  disabled={Boolean(uploading)}
                  onClick={() => fileInput.current?.click()}
                  className="gap-1.5"
                >
                  {uploading ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Upload className="size-3.5" />
                  )}
                  {uploading ? `${progress}%` : "Upload"}
                </Button>
              </>
            ) : open ? (
              <span className="text-xs text-muted-foreground">Read only</span>
            ) : null}
          </div>
        </div>

        {uploading ? (
          <p className="px-1 text-xs text-muted-foreground">
            Uploading {uploading} — {progress}%
          </p>
        ) : null}

        {sharing ? (
          <ShareDialog
            eventId={eventId}
            target={sharing}
            onClose={() => setSharing(null)}
          />
        ) : null}

        {subfolders.length === 0 && files.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-md border border-dashed p-10 text-center">
            <Upload className="size-5 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              {open
                ? open.canUpload
                  ? "Drop files here, or use the Upload button."
                  : "Nothing filed here yet."
                : "Create a folder to start filing documents."}
            </p>
          </div>
        ) : view === "grid" ? (
          /* ---- tile view ---- */
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
            {subfolders.map((folder) => (
              <button
                key={folder.id}
                type="button"
                draggable={folder.canManage}
                onDragStart={(e) => {
                  e.stopPropagation();
                  dragged.current = { kind: "folder", folder };
                }}
                onDragEnd={() => {
                  dragged.current = null;
                  setDropTarget(null);
                }}
                onDragOver={(e) => allowDrop(e, folder.id)}
                onDragLeave={() => setDropTarget(null)}
                onDrop={(e) => handleDrop(e, folder)}
                onDoubleClick={() => openFolderTile(folder)}
                onClick={() => openFolderTile(folder)}
                onContextMenu={(e) => folderMenu.openAt(e, folder)}
                title={LEVEL_LABEL[folder.visibility]}
                className={cn(
                  "flex cursor-pointer flex-col items-center gap-2 rounded-md border bg-card p-4 transition-colors hover:border-foreground/40",
                  dropTarget === folder.id && "ring-2 ring-foreground/40",
                )}
              >
                <span className="text-muted-foreground">
                  {folder.visibility === "sealed" ? (
                    <Lock className="size-8" />
                  ) : (
                    <Folder className="size-8 text-folder" />
                  )}
                </span>
                <span className="w-full truncate text-center text-xs font-medium">
                  {folder.name}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  {folder.updatedAt
                    ? new Date(folder.updatedAt).toLocaleDateString("en-GB", {
                        day: "numeric",
                        month: "short",
                        timeZone: "Asia/Jakarta",
                      })
                    : "\u00a0"}
                </span>
              </button>
            ))}
            {files.map((file) => (
              <div
                key={file.id}
                draggable={open?.canUpload}
                onDragStart={() => {
                  dragged.current = { kind: "file", file };
                }}
                onDragEnd={() => {
                  dragged.current = null;
                  setDropTarget(null);
                }}
                onContextMenu={(e) => fileMenu.openAt(e, file)}
                onClick={() => openFile(file)}
                className="group relative flex cursor-pointer flex-col items-center gap-2 rounded-md border bg-card p-4 transition-colors hover:border-foreground/40"
              >
                <span className="text-muted-foreground">
                  {fileTypeIcon(file.name, "size-8")}
                </span>
                <span className="w-full truncate text-center text-xs">{file.name}</span>
                <span className="text-[10px] text-muted-foreground">
                  v{file.currentVersion}
                </span>
                <button
                  type="button"
                  aria-label={`Actions for ${file.name}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    fileMenu.openNear(e.currentTarget, file);
                  }}
                  className="absolute right-1.5 top-1.5 flex size-6 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
                >
                  <MoreVertical className="size-3.5" />
                </button>
              </div>
            ))}
          </div>
        ) : (
          /* ---- list view ---- */
          <div className="overflow-x-auto rounded-md border bg-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-2.5 font-medium">Name</th>
                  <th className="px-4 py-2.5 font-medium">Version</th>
                  <th className="px-4 py-2.5 font-medium">Updated</th>
                  <th className="w-10 px-2 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {subfolders.map((folder) => (
                  <tr
                    key={folder.id}
                    draggable={folder.canManage}
                    onDragStart={(e) => {
                      e.stopPropagation();
                      dragged.current = { kind: "folder", folder };
                    }}
                    onDragEnd={() => {
                      dragged.current = null;
                      setDropTarget(null);
                    }}
                    onDragOver={(e) => allowDrop(e, folder.id)}
                    onDragLeave={() => setDropTarget(null)}
                    onDrop={(e) => handleDrop(e, folder)}
                    onContextMenu={(e) => folderMenu.openAt(e, folder)}
                    onClick={() => openFolderTile(folder)}
                    className={cn(
                      "cursor-pointer border-b transition-colors last:border-0 hover:bg-accent/30",
                      dropTarget === folder.id && "ring-2 ring-inset ring-foreground/40",
                    )}
                  >
                    <td className="px-4 py-2.5">
                      <span className="flex items-center gap-2 font-medium">
                        <span className="text-muted-foreground">
                          {folder.visibility === "sealed" ? (
                            <Lock className="size-4" />
                          ) : (
                            <Folder className="size-4 text-folder" />
                          )}
                        </span>
                        {folder.name}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">—</td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">
                      {folder.updatedAt
                        ? new Date(folder.updatedAt).toLocaleDateString("en-GB", {
                            day: "numeric",
                            month: "short",
                            year: "numeric",
                            timeZone: "Asia/Jakarta",
                          })
                        : "—"}
                    </td>
                    <td className="px-2 py-2.5">
                      <button
                        type="button"
                        aria-label={`Actions for ${folder.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          folderMenu.openNear(e.currentTarget, folder);
                        }}
                        className="flex size-9 sm:size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                      >
                        <MoreVertical className="size-4" />
                      </button>
                    </td>
                  </tr>
                ))}
                {files.map((file) => (
                  <tr
                    key={file.id}
                    draggable={open?.canUpload}
                    onDragStart={() => {
                      dragged.current = { kind: "file", file };
                    }}
                    onDragEnd={() => {
                      dragged.current = null;
                      setDropTarget(null);
                    }}
                    onContextMenu={(e) => fileMenu.openAt(e, file)}
                    onClick={() => openFile(file)}
                    className="cursor-pointer border-b transition-colors last:border-0 hover:bg-accent/30"
                  >
                    <td className="px-4 py-2.5">
                      <a
                        href={`/api/dataroom/files/${file.id}?inline=1`}
                        target="_blank"
                        rel="noreferrer"
                        draggable={false}
                        onClick={(e) => e.stopPropagation()}
                        className="flex items-center gap-2 underline-offset-4 hover:underline"
                      >
                        <span className="shrink-0 text-muted-foreground">
                          {fileTypeIcon(file.name, "size-4")}
                        </span>
                        {file.name}
                      </a>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">
                      v{file.currentVersion}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">
                      {new Date(file.updatedAt).toLocaleDateString("en-GB", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                        timeZone: "Asia/Jakarta",
                      })}
                    </td>
                    <td className="px-2 py-2.5">
                      <button
                        type="button"
                        aria-label={`Actions for ${file.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          fileMenu.openNear(e.currentTarget, file);
                        }}
                        className="flex size-9 sm:size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                      >
                        <MoreVertical className="size-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ContextMenu
        position={fileMenu.position}
        items={fileMenu.target ? fileItems(fileMenu.target) : []}
        onClose={fileMenu.close}
      />
      <ContextMenu
        position={folderMenu.position}
        items={folderMenu.target ? folderItems(folderMenu.target) : []}
        onClose={folderMenu.close}
      />
      <ContextMenu
        position={paneMenu.position}
        items={[
          {
            label: open ? `New folder in “${open.name}”…` : "New folder…",
            icon: <FolderPlus className="size-3.5" />,
            disabled: open ? !open.canUpload : false,
            onSelect: () => setNewFolderFor(open),
          },
          ...(open?.canUpload
            ? [
                {
                  label: "Upload files…",
                  icon: <Upload className="size-3.5" />,
                  onSelect: () => fileInput.current?.click(),
                },
              ]
            : []),
        ]}
        onClose={paneMenu.close}
      />

      {newFolderFor !== undefined ? (
        // mounted fresh on every open, so no state survives from the last use
        <NewFolderDialog
          eventId={eventId}
          parent={newFolderFor}
          divisions={divisions}
          onClose={() => setNewFolderFor(undefined)}
        />
      ) : null}

      {renaming ? (
        <RenameDialog
          current={renaming}
          onCancel={() => setRenaming(null)}
          onConfirm={(name) => {
            run(
              renaming.kind === "file"
                ? { verb: "rename-file", fileId: renaming.id, name }
                : { verb: "rename-folder", folderId: renaming.id, name },
            );
            setRenaming(null);
          }}
        />
      ) : null}
    </div>
  );
}

function RenameDialog({
  current,
  onCancel,
  onConfirm,
}: {
  current: { kind: "file" | "folder"; name: string };
  onCancel: () => void;
  onConfirm: (name: string) => void;
}) {
  const [value, setValue] = useState(current.name);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (value.trim()) onConfirm(value.trim());
        }}
        className="flex w-full max-w-sm flex-col gap-3 rounded-lg border bg-card p-4 shadow-lg"
      >
        <h2 className="text-sm font-semibold">
          Rename {current.kind === "file" ? "file" : "folder"}
        </h2>
        <input
          value={value}
          autoFocus
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onCancel();
          }}
          className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:border-foreground/40"
        />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={!value.trim()}>
            Rename
          </Button>
        </div>
      </form>
    </div>
  );
}
