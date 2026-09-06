"use client";

import { Bot, KeyRound, Loader2, PlugZap, Trash2 } from "lucide-react";
import { useActionState, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  clearAiKeyAction,
  saveAiSettingsAction,
  testAiConnectionAction,
  type AiSettingsState,
} from "./actions";

// Reddie AI provider settings (Owner 2026-09-06). Pick a provider, adjust the
// URL and model if needed, paste a key. The key field is never pre-filled:
// what is stored is shown only as its last four characters, and an empty
// field on save means "keep what is there".

export interface AiProviderOption {
  key: "openai" | "deepseek" | "custom";
  name: string;
  baseUrl: string;
  defaultModel: string;
}

export function AiProviderPanel({
  providers,
  initial,
  assistantName,
}: {
  providers: AiProviderOption[];
  initial: {
    provider: AiProviderOption["key"];
    baseUrl: string;
    model: string;
    hasKey: boolean;
    keyTail: string | null;
    source: "settings" | "env" | "none";
  };
  assistantName: string;
}) {
  const [provider, setProvider] = useState(initial.provider);
  const [baseUrl, setBaseUrl] = useState(initial.baseUrl);
  const [model, setModel] = useState(initial.model);
  const [state, formAction, saving] = useActionState<AiSettingsState, FormData>(
    saveAiSettingsAction,
    {},
  );
  const [side, setSide] = useState<AiSettingsState>({});
  const [busy, start] = useTransition();

  const pick = (key: AiProviderOption["key"]) => {
    const spec = providers.find((p) => p.key === key);
    setProvider(key);
    // switching presets rewrites URL and model — those belong to the provider
    if (spec) {
      setBaseUrl(spec.baseUrl);
      setModel(spec.defaultModel);
    }
  };

  const status =
    initial.source === "settings"
      ? `Configured here · key ends ····${initial.keyTail ?? "????"}`
      : initial.source === "env"
        ? "Using the server environment (OPENAI_API_KEY) — saving a key here takes over"
        : "Not configured — the assistant is off until a key is saved";

  return (
    <div className="flex flex-col gap-3 rounded-md border bg-card p-4">
      <div className="flex flex-col gap-0.5">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Bot className="size-4 text-muted-foreground" /> {assistantName}
        </h2>
        <p className="text-xs text-muted-foreground">
          Which model provider the assistant talks to. Any OpenAI-compatible API
          works; the key is stored write-only and never shown again.
        </p>
        <p
          className={cn(
            "text-[11px]",
            initial.source === "none" ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {status}
        </p>
      </div>

      <form action={formAction} className="flex flex-col gap-3">
        <input type="hidden" name="provider" value={provider} />

        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">Provider</Label>
          <div className="flex flex-wrap gap-1.5">
            {providers.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => pick(p.key)}
                aria-pressed={provider === p.key}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-xs transition-all",
                  provider === p.key
                    ? "border-foreground bg-foreground font-medium text-background"
                    : "text-muted-foreground hover:border-foreground/40 hover:text-foreground",
                )}
              >
                {p.name}
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ai-url" className="text-xs">
              Base URL
            </Label>
            <Input
              id="ai-url"
              name="baseUrl"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://api.example.com/v1"
              required={provider === "custom"}
              inputMode="url"
              className="h-9 text-xs"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ai-model" className="text-xs">
              Model
            </Label>
            <Input
              id="ai-model"
              name="model"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="model name"
              required
              className="h-9 text-xs"
            />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ai-key" className="flex items-center gap-1.5 text-xs">
            <KeyRound className="size-3.5" /> API key
          </Label>
          <Input
            id="ai-key"
            name="apiKey"
            type="password"
            autoComplete="off"
            placeholder={
              initial.hasKey
                ? `Leave empty to keep the current key (····${initial.keyTail ?? ""})`
                : "Paste the provider's API key"
            }
            className="h-9 text-xs"
          />
        </div>

        {state.error || side.error ? (
          <p role="alert" className="text-xs text-destructive">
            {state.error ?? side.error}
          </p>
        ) : null}
        {state.message || side.message ? (
          <p className="text-xs text-status-done">{side.message ?? state.message}</p>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" size="sm" disabled={saving || busy}>
            {saving ? "Saving…" : "Save"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={saving || busy || !initial.hasKey}
            className="gap-1.5"
            onClick={() => start(async () => setSide(await testAiConnectionAction()))}
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <PlugZap className="size-3.5" />}
            Test connection
          </Button>
          {initial.source === "settings" ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={saving || busy}
              className="ml-auto gap-1.5 text-destructive hover:text-destructive"
              onClick={() => start(async () => setSide(await clearAiKeyAction()))}
            >
              <Trash2 className="size-3.5" /> Remove key
            </Button>
          ) : null}
        </div>
      </form>
    </div>
  );
}
