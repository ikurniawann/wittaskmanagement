import { describe, expect, it } from "vitest";
import {
  describeAckError,
  shouldRetryAfter463,
  STATUS_ERROR,
  STATUS_SERVER_ACK,
  waitForAck,
  type AckEmitter,
} from "./delivery";

type Listener = (updates: unknown[]) => void;

function fakeEmitter() {
  const listeners = new Set<Listener>();
  const ev: AckEmitter = {
    on: (_e, l) => listeners.add(l as Listener),
    off: (_e, l) => listeners.delete(l as Listener),
  };
  return { ev, emit: (updates: unknown[]) => listeners.forEach((l) => l(updates)), size: () => listeners.size };
}

describe("waitForAck", () => {
  it("reports an error ack with its code", async () => {
    const { ev, emit, size } = fakeEmitter();
    const p = waitForAck(ev, "M1", 1000);
    emit([{ key: { id: "M1" }, update: { status: STATUS_ERROR, messageStubParameters: ["463"] } }]);
    expect(await p).toEqual({ outcome: "error", code: "463" });
    expect(size()).toBe(0); // unsubscribed
  });

  it("treats a receipt at or above SERVER_ACK as accepted", async () => {
    const { ev, emit } = fakeEmitter();
    const p = waitForAck(ev, "M2", 1000);
    emit([{ key: { id: "M2" }, update: { status: STATUS_SERVER_ACK + 1 } }]);
    expect(await p).toEqual({ outcome: "ok" });
  });

  it("ignores other messages and times out quietly", async () => {
    const { ev, emit, size } = fakeEmitter();
    const p = waitForAck(ev, "M3", 30);
    emit([{ key: { id: "OTHER" }, update: { status: STATUS_ERROR, messageStubParameters: ["463"] } }]);
    expect(await p).toEqual({ outcome: "timeout" });
    expect(size()).toBe(0);
  });
});

describe("shouldRetryAfter463", () => {
  it("retries only when the first send was bare and a token exists now", () => {
    expect(shouldRetryAfter463(false, true)).toBe(true);
    expect(shouldRetryAfter463(true, true)).toBe(false); // account restricted — do not deepen it
    expect(shouldRetryAfter463(false, false)).toBe(false); // nothing changed
  });
});

describe("describeAckError", () => {
  it("names the linked number in the 463 advice", () => {
    expect(describeAckError("463", "6285724992160")).toContain("6285724992160");
    expect(describeAckError("463", null)).toContain("the linked number");
    expect(describeAckError("999", null)).toContain("999");
  });
});
