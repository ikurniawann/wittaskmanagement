"use client";

import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  ChevronDown,
  Code,
  Image as ImageIcon,
  Italic,
  List,
  ListOrdered,
  ListTodo,
  Strikethrough,
  Table as TableIcon,
  TextQuote,
  Underline as UnderlineIcon,
} from "lucide-react";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TextStyleKit } from "@tiptap/extension-text-style";
import { TableKit } from "@tiptap/extension-table";
import { TaskItem } from "@tiptap/extension-task-item";
import { TaskList } from "@tiptap/extension-task-list";
import TextAlign from "@tiptap/extension-text-align";
import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

// Shared rich-text page editor (Owner 2026-08-07, Plane/Notion-style).
// Content autosaves as Tiptap JSON ~1.2s after the last keystroke.
//
// Used by BOTH the per-event wiki and the standalone Pages module
// (EPIC-016), which is why the save call arrives as a prop: the two modules
// have different services and permission rules, but an identical editor.

export type PageSaveAction = (
  pageId: string,
  fields: { title?: string; contentJson?: string },
) => Promise<{ error?: string; savedAt?: string }>;

const COLORS = [
  { key: "default", value: null, swatch: "bg-foreground" },
  { key: "gray", value: "#9ca3af", swatch: "bg-[#9ca3af]" },
  { key: "red", value: "#f87171", swatch: "bg-[#f87171]" },
  { key: "orange", value: "#fb923c", swatch: "bg-[#fb923c]" },
  { key: "amber", value: "#fbbf24", swatch: "bg-[#fbbf24]" },
  { key: "green", value: "#4ade80", swatch: "bg-[#4ade80]" },
  { key: "blue", value: "#60a5fa", swatch: "bg-[#60a5fa]" },
  { key: "violet", value: "#a78bfa", swatch: "bg-[#a78bfa]" },
  { key: "pink", value: "#f472b6", swatch: "bg-[#f472b6]" },
];

const BLOCKS = [
  { key: "paragraph", label: "Text" },
  { key: "h1", label: "Heading 1" },
  { key: "h2", label: "Heading 2" },
  { key: "h3", label: "Heading 3" },
] as const;

function ToolButton({
  onClick,
  active,
  label,
  children,
}: {
  onClick: () => void;
  active?: boolean;
  label: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onMouseDown={(e) => e.preventDefault()} // keep editor selection
      onClick={onClick}
      className={cn(
        "flex size-9 items-center justify-center rounded-md transition-colors sm:size-7",
        active
          ? "bg-accent text-foreground"
          : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <span aria-hidden className="mx-1 h-5 w-px bg-border" />;
}

function BlockPicker({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState(false);
  const current = editor.isActive("heading", { level: 1 })
    ? "Heading 1"
    : editor.isActive("heading", { level: 2 })
      ? "Heading 2"
      : editor.isActive("heading", { level: 3 })
        ? "Heading 3"
        : "Text";

  const apply = (key: (typeof BLOCKS)[number]["key"]) => {
    const chain = editor.chain().focus();
    if (key === "paragraph") chain.setParagraph().run();
    else chain.toggleHeading({ level: Number(key[1]) as 1 | 2 | 3 }).run();
    setOpen(false);
  };

  return (
    <div className="relative">
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((o) => !o)}
        className="flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-xs text-foreground hover:bg-accent/60"
      >
        {current}
        <ChevronDown className="size-3 text-muted-foreground" />
      </button>
      {open ? (
        <div className="absolute left-0 top-8 z-30 flex w-36 flex-col rounded-md border bg-popover p-1 shadow-md">
          {BLOCKS.map((block) => (
            <button
              key={block.key}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => apply(block.key)}
              className={cn(
                "rounded px-2 py-1.5 text-left text-xs hover:bg-accent",
                current === block.label && "font-semibold",
              )}
            >
              {block.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ColorPicker({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative flex items-center gap-1.5">
      <span className="text-xs text-muted-foreground">Color</span>
      <button
        type="button"
        aria-label="Text color"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((o) => !o)}
        className="flex h-7 items-center rounded-md border px-2 text-xs hover:bg-accent/60"
        style={{
          color: (editor.getAttributes("textStyle").color as string) ?? undefined,
        }}
      >
        Aa
      </button>
      {open ? (
        <div className="absolute left-0 top-8 z-30 flex gap-1 rounded-md border bg-popover p-1.5 shadow-md">
          {COLORS.map((color) => (
            <button
              key={color.key}
              type="button"
              aria-label={`Color ${color.key}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                const chain = editor.chain().focus();
                if (color.value === null) chain.unsetColor().run();
                else chain.setColor(color.value).run();
                setOpen(false);
              }}
              className={cn("size-5 rounded-full border", color.swatch)}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Toolbar({ editor }: { editor: Editor }) {
  const fileRef = useRef<HTMLInputElement>(null);

  const uploadImage = async (file: File) => {
    const data = new FormData();
    data.set("file", file);
    const res = await fetch("/api/pages/upload", { method: "POST", body: data });
    if (res.ok) {
      const { url } = (await res.json()) as { url: string };
      editor.chain().focus().setImage({ src: url }).run();
    }
  };

  return (
    <div className="sticky top-14 z-20 -mx-1 flex flex-wrap items-center gap-1 rounded-md border bg-background/95 px-2 py-1.5 backdrop-blur">
      <BlockPicker editor={editor} />
      <Divider />
      <ColorPicker editor={editor} />
      <Divider />
      <ToolButton label="Bold" active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}>
        <Bold className="size-3.5" />
      </ToolButton>
      <ToolButton label="Italic" active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}>
        <Italic className="size-3.5" />
      </ToolButton>
      <ToolButton label="Underline" active={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()}>
        <UnderlineIcon className="size-3.5" />
      </ToolButton>
      <ToolButton label="Strikethrough" active={editor.isActive("strike")} onClick={() => editor.chain().focus().toggleStrike().run()}>
        <Strikethrough className="size-3.5" />
      </ToolButton>
      <Divider />
      <ToolButton label="Align left" active={editor.isActive({ textAlign: "left" })} onClick={() => editor.chain().focus().setTextAlign("left").run()}>
        <AlignLeft className="size-3.5" />
      </ToolButton>
      <ToolButton label="Align center" active={editor.isActive({ textAlign: "center" })} onClick={() => editor.chain().focus().setTextAlign("center").run()}>
        <AlignCenter className="size-3.5" />
      </ToolButton>
      <ToolButton label="Align right" active={editor.isActive({ textAlign: "right" })} onClick={() => editor.chain().focus().setTextAlign("right").run()}>
        <AlignRight className="size-3.5" />
      </ToolButton>
      <Divider />
      <ToolButton label="Numbered list" active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
        <ListOrdered className="size-3.5" />
      </ToolButton>
      <ToolButton label="Bullet list" active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()}>
        <List className="size-3.5" />
      </ToolButton>
      <ToolButton label="To-do list" active={editor.isActive("taskList")} onClick={() => editor.chain().focus().toggleTaskList().run()}>
        <ListTodo className="size-3.5" />
      </ToolButton>
      <Divider />
      <ToolButton label="Quote" active={editor.isActive("blockquote")} onClick={() => editor.chain().focus().toggleBlockquote().run()}>
        <TextQuote className="size-3.5" />
      </ToolButton>
      <ToolButton label="Code block" active={editor.isActive("codeBlock")} onClick={() => editor.chain().focus().toggleCodeBlock().run()}>
        <Code className="size-3.5" />
      </ToolButton>
      <Divider />
      <ToolButton label="Insert table" onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}>
        <TableIcon className="size-3.5" />
      </ToolButton>
      <ToolButton label="Insert image" onClick={() => fileRef.current?.click()}>
        <ImageIcon className="size-3.5" />
      </ToolButton>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void uploadImage(file);
          e.target.value = "";
        }}
      />
    </div>
  );
}

export function PageEditor({
  pageId,
  initialTitle,
  initialContent,
  save,
  editable = true,
}: {
  pageId: string;
  initialTitle: string;
  initialContent: unknown;
  /** module-specific server action — see PageSaveAction */
  save: PageSaveAction;
  /** false renders the page read-only (shared without edit rights) */
  editable?: boolean;
}) {
  const [title, setTitle] = useState(initialTitle);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const queueSave = (fields: { title?: string; contentJson?: string }) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setState("saving");
    saveTimer.current = setTimeout(async () => {
      const result = await save(pageId, fields);
      setState(result.error ? "error" : "saved");
    }, 1200);
  };

  const editor = useEditor({
    // Next.js SSR: render only on the client to avoid hydration mismatch
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ link: { openOnClick: false } }),
      TextStyleKit,
      TableKit.configure({ table: { resizable: false } }),
      TaskList,
      TaskItem.configure({ nested: true }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Image,
      Placeholder.configure({ placeholder: "Write something…" }),
    ],
    content: (initialContent as object | null) ?? undefined,
    editable,
    onUpdate: ({ editor: current }) => {
      queueSave({ contentJson: JSON.stringify(current.getJSON()) });
    },
  });

  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    },
    [],
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <input
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            queueSave({ title: e.target.value });
          }}
          readOnly={!editable}
          placeholder="Untitled"
          aria-label="Page title"
          className="w-full bg-transparent text-3xl font-semibold tracking-tight outline-none placeholder:text-muted-foreground/40"
        />
        <span
          className={cn(
            "shrink-0 text-[10px] uppercase tracking-widest",
            state === "error" ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {state === "saving"
            ? "Saving…"
            : state === "saved"
              ? "Saved"
              : state === "error"
                ? "Save failed"
                : ""}
        </span>
      </div>

      {editor && editable ? <Toolbar editor={editor} /> : null}

      <EditorContent
        editor={editor}
        className={cn(
          "min-h-[55vh] max-w-none text-[15px] leading-relaxed",
          "[&_.ProseMirror]:min-h-[55vh] [&_.ProseMirror]:outline-none",
          "[&_h1]:mb-2 [&_h1]:mt-5 [&_h1]:text-3xl [&_h1]:font-semibold [&_h1]:tracking-tight",
          "[&_h2]:mb-2 [&_h2]:mt-4 [&_h2]:text-2xl [&_h2]:font-semibold",
          "[&_h3]:mb-1.5 [&_h3]:mt-3 [&_h3]:text-xl [&_h3]:font-semibold",
          "[&_p]:my-1.5",
          "[&_ol]:my-1.5 [&_ol]:list-decimal [&_ol]:pl-6 [&_ul]:my-1.5 [&_ul]:list-disc [&_ul]:pl-6",
          "[&_ul[data-type=taskList]]:list-none [&_ul[data-type=taskList]]:pl-1",
          "[&_ul[data-type=taskList]_li]:flex [&_ul[data-type=taskList]_li]:items-start [&_ul[data-type=taskList]_li]:gap-2",
          "[&_ul[data-type=taskList]_li>label]:mt-1",
          "[&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:pl-4 [&_blockquote]:text-muted-foreground",
          "[&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-3 [&_pre]:font-mono [&_pre]:text-[13px]",
          "[&_code]:rounded-sm [&_code]:bg-muted [&_code]:px-1 [&_code]:font-mono [&_code]:text-[13px] [&_pre_code]:bg-transparent [&_pre_code]:p-0",
          "[&_table]:my-3 [&_table]:w-full [&_table]:border-collapse",
          "[&_td]:border [&_td]:px-2.5 [&_td]:py-1.5 [&_th]:border [&_th]:bg-muted/60 [&_th]:px-2.5 [&_th]:py-1.5 [&_th]:text-left [&_th]:font-semibold",
          "[&_img]:my-2 [&_img]:max-w-full [&_img]:rounded-md [&_img]:border",
          "[&_a]:underline [&_a]:underline-offset-2",
          "[&_.ProseMirror_p.is-editor-empty:first-child::before]:pointer-events-none [&_.ProseMirror_p.is-editor-empty:first-child::before]:float-left [&_.ProseMirror_p.is-editor-empty:first-child::before]:h-0 [&_.ProseMirror_p.is-editor-empty:first-child::before]:text-muted-foreground/50 [&_.ProseMirror_p.is-editor-empty:first-child::before]:content-[attr(data-placeholder)]",
        )}
      />
    </div>
  );
}
