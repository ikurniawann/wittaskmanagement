import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { env } from "@/lib/env";
import { describeAckError, shouldRetryAfter463, waitForAck, type AckEmitter } from "./delivery";
import { toWhatsAppJid } from "./normalize";
import {
  isTcTokenExpired,
  mergedTcTokenIndexWrite,
  resolveIssuanceJid,
  resolveTcTokenJid,
  storeTcTokensFromIqResult,
  type BinaryNode,
  type TcTokenEntry,
  type TcTokenKeys,
} from "./tc-token";

// Baileys WhatsApp gateway (EPIC-015). Baileys is an UNOFFICIAL WhatsApp Web
// client: it holds one long-lived socket per linked device. Two consequences
// shape this file.
//
// 1. The socket must be a true singleton. Next dev hot-reload re-evaluates
//    modules, and the standalone server may import this from several route
//    handlers — a second socket on the same credentials gets both kicked.
//    So the instance is cached on globalThis, exactly like the db pool.
// 2. Credentials must outlive the container. useMultiFileAuthState writes to
//    WHATSAPP_SESSION_DIR, which lives on the uploads volume in Docker, so a
//    redeploy does NOT force a re-scan.
//
// Everything here fails soft: WhatsApp is a side channel, never a hard
// dependency of a mutation.

export type WaStatus =
  | "disconnected" // no socket, no attempt
  | "connecting" // socket opening / waiting for the pairing QR to be scanned
  | "awaiting_qr" // QR generated, waiting for the phone to scan it
  | "connected"; // linked and able to send

interface WaState {
  socket: unknown | null;
  status: WaStatus;
  /** data: URL of the current pairing QR, present only while awaiting_qr */
  qr: string | null;
  /** the linked account's own number, once known */
  me: string | null;
  lastError: string | null;
  /** guards against overlapping connect() calls */
  starting: boolean;
}

const globalForWa = globalThis as unknown as { waState?: WaState };

const state: WaState = (globalForWa.waState ??= {
  socket: null,
  status: "disconnected",
  qr: null,
  me: null,
  lastError: null,
  starting: false,
});

function sessionDir(): string {
  return (
    process.env.WHATSAPP_SESSION_DIR ||
    path.join(path.resolve(env.UPLOADS_DIR), "whatsapp-session")
  );
}

export function getStatus(): {
  status: WaStatus;
  qr: string | null;
  me: string | null;
  lastError: string | null;
} {
  return {
    status: state.status,
    qr: state.qr,
    me: state.me,
    lastError: state.lastError,
  };
}

export function isConnected(): boolean {
  return state.status === "connected" && state.socket !== null;
}

/**
 * Opens (or re-opens) the WhatsApp socket. Safe to call repeatedly: returns
 * immediately when already connected or mid-start.
 */
export async function connect(): Promise<void> {
  if (state.status === "connected" || state.starting) return;
  state.starting = true;
  state.lastError = null;
  state.status = "connecting";

  try {
    // imported lazily so the module never loads during `next build` page-data
    // collection, and so an install without the dep still boots
    const {
      default: makeWASocket,
      // aliased: the `use*` name trips eslint's react-hooks rule
      useMultiFileAuthState: loadAuthState,
      DisconnectReason,
      fetchLatestBaileysVersion,
    } = await import("@whiskeysockets/baileys");
    const { toDataURL } = await import("qrcode");

    const dir = sessionDir();
    await mkdir(dir, { recursive: true });
    const { state: auth, saveCreds } = await loadAuthState(dir);
    const { version } = await fetchLatestBaileysVersion();

    const socket = makeWASocket({
      version,
      auth,
      // we render the QR ourselves in the admin UI
      printQRInTerminal: false,
      // never mark the linked phone as "online" — that would steal
      // notifications from the human using the same account
      markOnlineOnConnect: false,
      browser: ["Backstage", "Chrome", "1.0.0"],
    });
    state.socket = socket;

    socket.ev.on("creds.update", saveCreds);

    socket.ev.on("connection.update", (update: Record<string, unknown>) => {
      const qr = update.qr as string | undefined;
      const connection = update.connection as string | undefined;
      const lastDisconnect = update.lastDisconnect as
        | { error?: { output?: { statusCode?: number } } }
        | undefined;

      if (qr) {
        state.status = "awaiting_qr";
        void toDataURL(qr, { margin: 1, width: 320 })
          .then((dataUrl) => {
            state.qr = dataUrl;
          })
          .catch(() => {
            state.qr = null;
          });
      }

      if (connection === "open") {
        state.status = "connected";
        state.qr = null;
        state.lastError = null;
        const jid = (socket as { user?: { id?: string } }).user?.id;
        state.me = jid ? jid.split(":")[0] : null;
        console.log("[whatsapp] connected as", state.me);
      }

      if (connection === "close") {
        const code = lastDisconnect?.error?.output?.statusCode;
        const loggedOut = code === DisconnectReason.loggedOut;
        state.socket = null;
        state.qr = null;
        state.status = "disconnected";
        state.starting = false;
        if (loggedOut) {
          // the phone unlinked us — the stored creds are now useless
          state.lastError =
            "Logged out on the phone. Scan the QR again to reconnect.";
          void rm(sessionDir(), { recursive: true, force: true }).catch(() => {});
        } else {
          // A transient drop — including 515 "restart required", which
          // WhatsApp ALWAYS sends right after a successful QR pairing.
          // Report "connecting" (not "disconnected") so the admin UI keeps
          // polling and sees the reconnect land, instead of freezing on a
          // stale error message.
          state.status = "connecting";
          state.lastError =
            code === 515
              ? "Finishing pairing…"
              : `Connection dropped (${code ?? "unknown"}). Reconnecting…`;
          setTimeout(() => void connect().catch(() => {}), 3_000);
        }
      }
    });
  } catch (error) {
    state.status = "disconnected";
    state.socket = null;
    state.lastError =
      error instanceof Error ? error.message : "Failed to start WhatsApp.";
    console.error("[whatsapp] connect failed:", error);
  } finally {
    state.starting = false;
  }
}

/** Unlinks this device and deletes the stored credentials. */
export async function disconnect(): Promise<void> {
  const socket = state.socket as { logout?: () => Promise<void> } | null;
  try {
    await socket?.logout?.();
  } catch {
    // already gone — carry on and clear local state anyway
  }
  state.socket = null;
  state.status = "disconnected";
  state.qr = null;
  state.me = null;
  state.lastError = null;
  await rm(sessionDir(), { recursive: true, force: true }).catch(() => {});
}

// The slice of the Baileys socket the sender touches. Typed here rather than
// imported so the module still loads when the dependency is absent.
interface GatewaySocket {
  ev: AckEmitter;
  sendMessage: (jid: string, content: { text: string }) => Promise<{ key?: { id?: string | null } } | undefined>;
  issuePrivacyTokens: (jids: string[], timestamp?: number) => Promise<BinaryNode>;
  authState: { keys: TcTokenKeys };
  signalRepository: {
    lidMapping: {
      getLIDForPN: (pn: string) => Promise<string | null>;
      getPNForLID: (lid: string) => Promise<string | null>;
    };
  };
  serverProps?: { lidTrustedTokenIssueToLid?: boolean };
}

export interface DeliveryResult {
  sent: boolean;
  /** why it did not go through — readable, safe to show an admin */
  reason?: string;
  /** WhatsApp's ack error code, when that is what stopped it */
  code?: string;
}

/** how long to wait for WhatsApp to reject a message before assuming it went */
const ACK_WINDOW_MS = 4_000;

/**
 * Makes sure a privacy token (tctoken) for the contact is stored before the
 * first message, the way WA Web issues one when a chat is opened. Without it
 * the first message to a cold contact is dropped with error 463 (Owner
 * 2026-09-14). Returns whether a usable token is stored afterwards. Fails
 * soft: the send still happens, Baileys' own recovery then kicks in.
 */
async function ensureTcToken(socket: GatewaySocket, jid: string): Promise<boolean> {
  try {
    const { lidMapping } = socket.signalRepository;
    const getLIDForPN = lidMapping.getLIDForPN.bind(lidMapping);
    const getPNForLID = lidMapping.getPNForLID.bind(lidMapping);
    const storageJid = await resolveTcTokenJid(jid, getLIDForPN);
    const usable = async () => {
      const entry = (await socket.authState.keys.get("tctoken", [storageJid]))[storageJid];
      return Boolean(entry?.token?.length) && !isTcTokenExpired(entry?.timestamp);
    };
    if (await usable()) return true;

    const issueJid = await resolveIssuanceJid(
      jid,
      Boolean(socket.serverProps?.lidTrustedTokenIssueToLid),
      getLIDForPN,
      getPNForLID,
    );
    const issuedAt = Math.floor(Date.now() / 1000);
    const result = await socket.issuePrivacyTokens([issueJid], issuedAt);
    await storeTcTokensFromIqResult({ result, fallbackJid: storageJid, keys: socket.authState.keys, getLIDForPN });
    // record that we issued one, so Baileys' post-send issuance does not repeat it
    const current: TcTokenEntry | null | undefined = (await socket.authState.keys.get("tctoken", [storageJid]))[storageJid];
    const indexWrite = await mergedTcTokenIndexWrite(socket.authState.keys, [storageJid]);
    await socket.authState.keys.set({
      tctoken: {
        [storageJid]: { token: new Uint8Array(0), ...current, senderTimestamp: issuedAt },
        ...indexWrite,
      },
    });
    const ok = await usable();
    console.log(`[whatsapp] tctoken for ${jid}: ${ok ? "issued" : "not granted"}`);
    return ok;
  } catch (error) {
    console.warn(`[whatsapp] tctoken step failed for ${jid}:`, error instanceof Error ? error.message : error);
    return false;
  }
}

/**
 * Sends a text and reports what WhatsApp did with it. Never throws. A cold
 * contact gets a privacy token first; a 463 on a bare first send earns one
 * retry with the token, a 463 despite a token is reported as-is (the number
 * is restricted; retrying would deepen it).
 */
export async function deliverText(to: string, text: string): Promise<DeliveryResult> {
  if (!isConnected()) return { sent: false, reason: "Gateway is not connected." };
  const jid = toWhatsAppJid(to, process.env.WHATSAPP_COUNTRY_CODE || "62");
  if (!jid) {
    console.warn(`[whatsapp] unusable number, skipped: ${to}`);
    return { sent: false, reason: "That number cannot be used on WhatsApp." };
  }
  const socket = state.socket as unknown as GatewaySocket;

  const attempt = async (tokenPresent: boolean): Promise<DeliveryResult | { retryable: true }> => {
    const msg = await socket.sendMessage(jid, { text });
    const id = msg?.key?.id;
    if (!id) return { sent: true };
    const ack = await waitForAck(socket.ev, id, ACK_WINDOW_MS);
    if (ack.outcome !== "error") return { sent: true };
    console.warn(`[whatsapp] ${jid} rejected message ${id} with error ${ack.code}`);
    if (ack.code === "463") {
      // Baileys' own 463 recovery issues a token in the background — give it a moment
      await new Promise((r) => setTimeout(r, 1_500));
      if (shouldRetryAfter463(tokenPresent, await ensureTcToken(socket, jid))) return { retryable: true };
    }
    return { sent: false, code: ack.code, reason: describeAckError(ack.code, state.me) };
  };

  try {
    const tokenPresent = await ensureTcToken(socket, jid);
    const first = await attempt(tokenPresent);
    if (!("retryable" in first)) return first;
    console.log(`[whatsapp] retrying ${jid} once, now with a privacy token`);
    const second = await attempt(true);
    return "retryable" in second
      ? { sent: false, code: "463", reason: describeAckError("463", state.me) }
      : second;
  } catch (error) {
    console.error(`[whatsapp] send failed to ${jid}:`, error);
    return { sent: false, reason: error instanceof Error ? error.message : "Send failed." };
  }
}

/**
 * Sends a text message. Returns false (never throws) when the gateway is
 * offline, the number is unusable, or WhatsApp rejected it, so callers stay
 * unaffected. Use deliverText when the reason matters.
 */
export async function sendText(to: string, text: string): Promise<boolean> {
  return (await deliverText(to, text)).sent;
}

/**
 * Called once at server boot (see instrumentation.ts). Re-links silently when
 * credentials from a previous pairing are still on disk — without this the
 * gateway stays down after every redeploy until someone opens Admin and
 * clicks Connect.
 */
export async function resumeIfLinked(): Promise<boolean> {
  try {
    const { access } = await import("node:fs/promises");
    await access(path.join(sessionDir(), "creds.json"));
  } catch {
    return false; // never paired, or the user unlinked — stay idle
  }
  void connect().catch(() => {});
  return true;
}
