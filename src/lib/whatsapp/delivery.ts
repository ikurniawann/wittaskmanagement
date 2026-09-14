// Delivery bookkeeping for the Baileys gateway (Owner 2026-09-14: a test
// message "sent" fine yet never arrived). Pure helpers, no Baileys import,
// so the decisions are unit-testable.
//
// Background. WhatsApp requires a privacy token (tctoken) on 1:1 messages
// to contacts the account has not established a chat with. Baileys rc14
// attaches one when it is stored and asks the server for one only AFTER a
// send (fire-and-forget), so the very first message to a cold contact goes
// out bare, the server answers the ack with error 463 and drops it — while
// sendMessage() has already resolved successfully. The socket only surfaces
// this as a `messages.update` with status ERROR.

/** proto.WebMessageInfo.Status — ERROR is 0, SERVER_ACK is 2 */
export const STATUS_ERROR = 0;
export const STATUS_SERVER_ACK = 2;

export type AckOutcome =
  | { outcome: "ok" }
  | { outcome: "error"; code: string }
  | { outcome: "timeout" };

interface MessageUpdate {
  key: { id?: string | null };
  update: { status?: number | null; messageStubParameters?: (string | null)[] | null };
}

export interface AckEmitter {
  on(event: "messages.update", listener: (updates: MessageUpdate[]) => void): unknown;
  off(event: "messages.update", listener: (updates: MessageUpdate[]) => void): unknown;
}

/**
 * Resolves with the server's verdict on one message id: an error ack (with
 * its code), a positive receipt, or nothing within the window. No news is
 * treated by callers as accepted — WhatsApp only volunteers the failures.
 */
export function waitForAck(ev: AckEmitter, msgId: string, timeoutMs: number): Promise<AckOutcome> {
  return new Promise((resolve) => {
    const finish = (result: AckOutcome) => {
      clearTimeout(timer);
      ev.off("messages.update", listener);
      resolve(result);
    };
    const listener = (updates: MessageUpdate[]) => {
      for (const u of updates) {
        if (u.key?.id !== msgId) continue;
        const status = u.update?.status;
        if (status === STATUS_ERROR) {
          finish({ outcome: "error", code: u.update?.messageStubParameters?.[0] ?? "unknown" });
          return;
        }
        if (typeof status === "number" && status >= STATUS_SERVER_ACK) {
          finish({ outcome: "ok" });
          return;
        }
      }
    };
    const timer = setTimeout(() => finish({ outcome: "timeout" }), timeoutMs);
    ev.on("messages.update", listener);
  });
}

/**
 * Whether a 463 deserves one more attempt. Only when the first send went
 * out WITHOUT a token and one has since been stored: then the retry is the
 * message WA Web would have sent in the first place. A 463 despite a token
 * means the account itself is restricted — retrying counts as another
 * "reach out" and deepens the restriction (Baileys' own guidance).
 */
export function shouldRetryAfter463(tokenPresentAtSend: boolean, tokenPresentNow: boolean): boolean {
  return !tokenPresentAtSend && tokenPresentNow;
}

/** Human-readable reason for an ack error, for the admin's toast and the log. */
export function describeAckError(code: string, me: string | null): string {
  switch (code) {
    case "463":
      return (
        "WhatsApp rejected the message (463): this number is not allowed to start a new chat with that contact yet. " +
        `Ask the recipient to send one message to ${me ?? "the linked number"} first, then try again. ` +
        "If it keeps failing for every contact, WhatsApp has restricted the linked number."
      );
    case "479":
      return "WhatsApp rejected the message (479): stale device session. Unlink and scan the QR again.";
    default:
      return `WhatsApp rejected the message (error ${code}).`;
  }
}
