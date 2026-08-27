"use client";

import { ChevronLeft, Link2, Link2Off, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  fetchChannelOptionsAction,
  mapChannelAction,
  type ChannelProvider,
  type Option,
} from "./channel-actions";

// One card per ticketing channel (Owner 2026-08-17). The option list is
// fetched on demand, never at page load: it costs a call to the provider's
// API, and most visits to the Tickets page are not here to change a mapping.
//
// Megatix needs two steps — pick the presenter, then the event under it —
// so the picker keeps a small back-stack rather than two separate widgets.

const LABEL: Record<ChannelProvider, string> = {
  tessera: "Tessera",
  megatix: "Megatix",
};

export function ChannelMap({
  eventId,
  provider,
  mappedId,
  presenterId,
}: {
  eventId: string;
  provider: ChannelProvider;
  mappedId: string | null;
  presenterId?: string | null;
}) {
  const router = useRouter();
  const [options, setOptions] = useState<Option[] | null>(null);
  const [presenter, setPresenter] = useState<{ id: string; name: string } | null>(
    null,
  );
  const [filter, setFilter] = useState("");
  const [pending, startTransition] = useTransition();

  const load = (forPresenter?: { id: string; name: string } | null) =>
    startTransition(async () => {
      const result = await fetchChannelOptionsAction(
        provider,
        forPresenter?.id ?? undefined,
      );
      if ("error" in result) toast.error(result.error);
      else {
        setOptions(result.options);
        setPresenter(forPresenter ?? null);
        setFilter("");
      }
    });

  const choose = (option: Option) => {
    // Megatix, first step: this is a presenter, so drill into its events
    if (provider === "megatix" && !presenter) {
      load({ id: option.id, name: option.name });
      return;
    }
    map(option.id, option.accountId ?? presenter?.id ?? null);
  };

  const map = (providerEventId: string | null, accountId: string | null) =>
    startTransition(async () => {
      const result = await mapChannelAction(
        eventId,
        provider,
        providerEventId,
        accountId,
      );
      if (result?.error) toast.error(result.error);
      else {
        toast.success(
          providerEventId
            ? `${LABEL[provider]} linked — sales sync hourly.`
            : `${LABEL[provider]} unlinked.`,
        );
        setOptions(null);
        setPresenter(null);
        router.refresh();
      }
    });

  const shown = (options ?? []).filter((o) =>
    o.name.toLowerCase().includes(filter.trim().toLowerCase()),
  );

  return (
    <div className="flex flex-col gap-2 rounded-md border bg-card p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-medium">
          {LABEL[provider]}:{" "}
          {mappedId ? (
            <span className="text-status-done">linked ({mappedId})</span>
          ) : (
            <span className="text-muted-foreground">not linked</span>
          )}
          {mappedId && presenterId ? (
            <span className="text-muted-foreground"> · presenter {presenterId}</span>
          ) : null}
        </span>
        <span className="flex gap-2">
          {mappedId ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() => map(null, null)}
              className="gap-1.5 text-muted-foreground hover:text-destructive"
            >
              <Link2Off className="size-3.5" /> Unlink
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => load(null)}
            className="gap-1.5"
          >
            {pending && options === null ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Link2 className="size-3.5" />
            )}
            {mappedId ? "Change link" : `Link a ${LABEL[provider]} event`}
          </Button>
        </span>
      </div>

      {options !== null ? (
        options.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Nothing readable came back — check the connection on the Admin page.
          </p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {presenter ? (
              <button
                type="button"
                onClick={() => load(null)}
                className="flex items-center gap-1 self-start text-[11px] text-muted-foreground hover:text-foreground"
              >
                <ChevronLeft className="size-3" />
                {presenter.name} — back to presenters
              </button>
            ) : provider === "megatix" ? (
              <p className="text-[11px] text-muted-foreground">
                Pick the presenter first, then its event.
              </p>
            ) : null}
            <Input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter…"
              className="h-8 text-xs"
            />
            <div className="flex max-h-44 flex-col gap-0.5 overflow-y-auto">
              {shown.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  disabled={pending}
                  onClick={() => choose(option)}
                  className={cn(
                    "rounded px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-accent",
                    option.id === mappedId && "bg-accent/50 font-medium",
                  )}
                >
                  {option.name}
                  <span className="ml-1.5 text-[10px] text-muted-foreground">
                    {option.id}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )
      ) : null}
    </div>
  );
}
