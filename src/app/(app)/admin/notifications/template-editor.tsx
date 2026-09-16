"use client";

import { MessageCircle, RotateCcw } from "lucide-react";
import { useActionState, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DEFAULT_TEMPLATES,
  PREVIEW_VARS,
  renderTemplate,
  validateTemplate,
  type TemplateSpec,
  type WaTemplateKey,
} from "@/lib/whatsapp/templates";
import { cn } from "@/lib/utils";
import {
  resetTemplateAction,
  saveTemplateAction,
  type TemplateActionState,
} from "./actions";

// Admin-only editor for the WhatsApp message wording (T-152). The preview
// calls the SAME renderTemplate/validateTemplate the server uses when it
// sends, so what is shown here cannot drift from what the team receives.

/** Renders WhatsApp's *bold* markers the way the phone will show them. */
function WhatsAppText({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\*[^*\n]+\*)/g).map((chunk, i) =>
        chunk.startsWith("*") && chunk.endsWith("*") && chunk.length > 2 ? (
          <strong key={i} className="font-semibold">
            {chunk.slice(1, -1)}
          </strong>
        ) : (
          <span key={i}>{chunk}</span>
        ),
      )}
    </>
  );
}

export function TemplateEditor({
  spec,
  body,
  isCustom,
}: {
  spec: TemplateSpec;
  body: string;
  isCustom: boolean;
}) {
  const [draft, setDraft] = useState(body);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [saveState, saveAction, saving] = useActionState<
    TemplateActionState,
    FormData
  >(saveTemplateAction, {});
  const [resetState, resetAction, resetting] = useActionState<
    TemplateActionState,
    FormData
  >(resetTemplateAction, {});

  const verdict = validateTemplate(spec.key, draft);
  const dirty = draft !== body;
  const serverError =
    (saveState.key === spec.key ? saveState.error : undefined) ??
    (resetState.key === spec.key ? resetState.error : undefined);
  const saved = saveState.key === spec.key && saveState.ok && !dirty;

  const insert = (placeholder: string) => {
    const el = textareaRef.current;
    const token = `{${placeholder}}`;
    if (!el) {
      setDraft((d) => d + token);
      return;
    }
    const { selectionStart: start, selectionEnd: end } = el;
    setDraft((d) => d.slice(0, start) + token + d.slice(end));
    // put the caret after the inserted token once React has repainted
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  };

  return (
    <div className="flex flex-col gap-4 rounded-card bg-card shadow-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            {spec.label}
            {isCustom ? (
              <span className="rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Edited
              </span>
            ) : null}
          </h2>
          <p className="max-w-xl text-xs text-muted-foreground">
            {spec.trigger}
          </p>
        </div>
        {isCustom ? (
          <form action={resetAction}>
            <input type="hidden" name="key" value={spec.key} />
            <Button
              type="submit"
              variant="ghost"
              size="sm"
              disabled={resetting}
              className="gap-1.5 text-muted-foreground hover:text-foreground"
            >
              <RotateCcw className="size-3.5" />
              {resetting ? "Resetting…" : "Reset to default"}
            </Button>
          </form>
        ) : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <form action={saveAction} className="flex flex-col gap-3">
          <input type="hidden" name="key" value={spec.key} />
          <textarea
            ref={textareaRef}
            name="body"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={10}
            spellCheck={false}
            className="w-full resize-y rounded-md border bg-background p-3 font-mono text-xs leading-relaxed outline-none transition-colors focus:border-foreground/40"
          />

          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
              Insert
            </span>
            {spec.placeholders.map((p) => (
              <button
                key={p.name}
                type="button"
                title={p.description}
                onClick={() => insert(p.name)}
                className="rounded-full border px-2.5 py-1 font-mono text-[11px] transition-all duration-150 hover:border-foreground/40 hover:bg-surface-2 active:scale-[0.97]"
              >
                {`{${p.name}}`}
              </button>
            ))}
          </div>

          {!verdict.ok ? (
            <p role="alert" className="text-xs text-destructive">
              {verdict.error}
            </p>
          ) : null}
          {serverError ? (
            <p role="alert" className="text-xs text-destructive">
              {serverError}
            </p>
          ) : null}
          {saved ? (
            <p className="text-xs text-status-done">Saved — this wording is live.</p>
          ) : null}

          <div className="flex items-center gap-2">
            <Button type="submit" size="sm" disabled={saving || !verdict.ok || !dirty}>
              {saving ? "Saving…" : "Save"}
            </Button>
            {dirty ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setDraft(body)}
                className="text-muted-foreground"
              >
                Discard changes
              </Button>
            ) : null}
            {draft !== DEFAULT_TEMPLATES[spec.key] ? null : (
              <span className="text-[11px] text-muted-foreground">
                Currently the default wording
              </span>
            )}
          </div>
        </form>

        <div className="flex flex-col gap-2">
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
            Preview
          </span>
          <div className="rounded-md border bg-muted/30 p-3">
            <div className="flex items-start gap-2">
              <MessageCircle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <p className="whitespace-pre-wrap break-words text-xs leading-relaxed">
                <WhatsAppText text={renderTemplate(draft, PREVIEW_VARS)} />
              </p>
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Sample data. The real message uses the recipient&apos;s first name
            and the task&apos;s own link.
          </p>
        </div>
      </div>
    </div>
  );
}

export function TemplateEditorList({
  specs,
  bodies,
}: {
  specs: readonly TemplateSpec[];
  bodies: Array<{ key: WaTemplateKey; body: string; isCustom: boolean }>;
}) {
  const byKey = new Map(bodies.map((b) => [b.key, b]));
  return (
    <div className={cn("flex flex-col gap-4")}>
      {specs.map((spec) => {
        const stored = byKey.get(spec.key);
        return (
          <TemplateEditor
            key={spec.key}
            spec={spec}
            body={stored?.body ?? DEFAULT_TEMPLATES[spec.key]}
            isCustom={stored?.isCustom ?? false}
          />
        );
      })}
    </div>
  );
}
