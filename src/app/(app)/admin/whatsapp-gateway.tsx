"use client";

import { Loader2, MessageCircle, Power, QrCode, Send } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// WhatsApp gateway panel (EPIC-015): link a device by scanning a QR, then
// every WhatsApp notification the app already sends goes out through it.

type Status = "disconnected" | "connecting" | "awaiting_qr" | "connected";

interface GatewayState {
  status: Status;
  qr: string | null;
  me: string | null;
  lastError: string | null;
}

const LABEL: Record<Status, string> = {
  disconnected: "Not connected",
  connecting: "Connecting…",
  awaiting_qr: "Waiting for scan",
  connected: "Connected",
};

const DOT: Record<Status, string> = {
  disconnected: "bg-muted-foreground/50",
  connecting: "bg-status-in-progress",
  awaiting_qr: "bg-status-in-progress",
  connected: "bg-status-done",
};

export function WhatsAppGateway() {
  const [state, setState] = useState<GatewayState>({
    status: "disconnected",
    qr: null,
    me: null,
    lastError: null,
  });
  const [busy, setBusy] = useState(false);
  const [testNumber, setTestNumber] = useState("");

  // poll while a link is in progress; idle state needs no traffic
  const polling = state.status === "connecting" || state.status === "awaiting_qr";
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch("/api/whatsapp");
        if (res.ok && alive) setState((await res.json()) as GatewayState);
      } catch {
        // transient — next tick retries
      }
    };
    void load();
    if (!polling) return;
    const timer = setInterval(load, 2500);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [polling]);

  const act = async (action: string, extra: Record<string, unknown> = {}) => {
    setBusy(true);
    try {
      const res = await fetch("/api/whatsapp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...extra }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        status?: Status;
      };
      if (!res.ok) {
        toast.error(data.error ?? "Request failed.");
        return;
      }
      if (action === "connect") toast.success("Starting — a QR will appear.");
      if (action === "disconnect") toast.success("Device unlinked.");
      if (action === "test") toast.success("Test message sent.");
      const fresh = await fetch("/api/whatsapp");
      if (fresh.ok) setState((await fresh.json()) as GatewayState);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 rounded-card bg-card shadow-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <MessageCircle className="size-4 text-muted-foreground" />
            WhatsApp gateway
          </h2>
          <p className="max-w-xl text-xs text-muted-foreground">
            Link a WhatsApp account by scanning a QR, and the app sends its
            WhatsApp notifications through it — task assignments, due and
            overdue alerts, and approval decisions, to each person&apos;s own
            number.
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <span className="flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs">
            <span className={cn("size-2 rounded-full", DOT[state.status])} />
            {LABEL[state.status]}
            {state.me ? (
              <span className="text-muted-foreground">· {state.me}</span>
            ) : null}
          </span>
          <Link
            href="/admin/notifications"
            className="text-xs font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            Edit message templates ↗
          </Link>
        </div>
      </div>

      {state.lastError ? (
        <p
          className={cn(
            "rounded-md border px-3 py-2 text-xs",
            // a message while we're still dialling is progress, not failure
            state.status === "connecting"
              ? "border-border bg-muted/40 text-muted-foreground"
              : "border-destructive/40 bg-destructive/5 text-destructive",
          )}
        >
          {state.lastError}
        </p>
      ) : null}

      {state.status === "awaiting_qr" && state.qr ? (
        <div className="flex flex-col items-center gap-3 rounded-md border border-dashed p-4">
          <Image
            src={state.qr}
            alt="WhatsApp pairing QR code"
            width={220}
            height={220}
            unoptimized
            className="rounded bg-white p-2"
          />
          <ol className="max-w-sm list-decimal space-y-0.5 pl-4 text-xs text-muted-foreground">
            <li>Open WhatsApp on the phone that will send the messages.</li>
            <li>
              Go to <span className="text-foreground">Settings → Linked devices</span>
              , then <span className="text-foreground">Link a device</span>.
            </li>
            <li>Scan this code. It refreshes automatically if it expires.</li>
          </ol>
        </div>
      ) : null}

      {state.status === "connecting" ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" /> Opening the connection…
        </p>
      ) : null}

      <div className="flex flex-wrap items-end gap-2">
        {state.status === "connected" ? (
          <>
            <div className="flex flex-col gap-1.5">
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
                Send a test message
              </span>
              <Input
                value={testNumber}
                onChange={(e) => setTestNumber(e.target.value)}
                placeholder="08123456789"
                className="h-9 w-48"
              />
            </div>
            <Button
              variant="outline"
              disabled={busy || !testNumber.trim()}
              onClick={() => void act("test", { to: testNumber })}
              className="gap-1.5"
            >
              <Send className="size-3.5" /> Send test
            </Button>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => void act("disconnect")}
              className="gap-1.5 text-muted-foreground hover:text-destructive"
            >
              <Power className="size-3.5" /> Unlink device
            </Button>
          </>
        ) : (
          <Button
            disabled={busy || polling}
            onClick={() => void act("connect")}
            className="gap-1.5"
          >
            <QrCode className="size-4" />
            {polling ? "Waiting…" : "Connect WhatsApp"}
          </Button>
        )}
      </div>

      <p className="text-[11px] text-muted-foreground">
        Uses an unofficial WhatsApp Web connection. Prefer a dedicated number
        over a personal one, and keep the volume conversational — bulk sending
        risks the account being blocked. Each recipient must have a phone number
        set and WhatsApp notifications enabled in their own settings.
      </p>
    </div>
  );
}
