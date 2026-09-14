import { describe, expect, it } from "vitest";
import {
  isTcTokenExpired,
  mergedTcTokenIndexWrite,
  normalizeUser,
  resolveIssuanceJid,
  resolveTcTokenJid,
  storeTcTokensFromIqResult,
  TC_TOKEN_INDEX_KEY,
  type TcTokenEntry,
  type TcTokenKeys,
} from "./tc-token";

function memoryKeys(initial: Record<string, TcTokenEntry> = {}) {
  const store: Record<string, TcTokenEntry | null> = { ...initial };
  const keys: TcTokenKeys = {
    get: async (_t, ids) => Object.fromEntries(ids.map((id) => [id, store[id]])),
    set: async (data) => {
      for (const [id, v] of Object.entries(data.tctoken)) store[id] = v;
    },
  };
  return { keys, store };
}

const WEEK = 604_800;
const now = 1_789_346_050_000; // 2026-09-14

describe("isTcTokenExpired", () => {
  it("keeps tokens inside the 4-bucket window and expires older ones", () => {
    const nowSec = Math.floor(now / 1000);
    expect(isTcTokenExpired(nowSec, now)).toBe(false);
    expect(isTcTokenExpired(String(nowSec - 2 * WEEK), now)).toBe(false);
    expect(isTcTokenExpired(nowSec - 5 * WEEK, now)).toBe(true);
    expect(isTcTokenExpired(undefined, now)).toBe(true);
    expect(isTcTokenExpired("abc", now)).toBe(true);
  });
});

describe("jid resolution", () => {
  const lidFor = async (pn: string) => (pn.startsWith("6281") ? "219606107046135@lid" : null);
  it("stores under the LID when known, else the phone jid", async () => {
    expect(await resolveTcTokenJid("6281809078014@s.whatsapp.net", lidFor)).toBe("219606107046135@lid");
    expect(await resolveTcTokenJid("6289@s.whatsapp.net", lidFor)).toBe("6289@s.whatsapp.net");
    expect(await resolveTcTokenJid("x@lid", lidFor)).toBe("x@lid");
  });
  it("issues to LID or PN according to the server flag", async () => {
    const pnFor = async () => "6281809078014@s.whatsapp.net";
    expect(await resolveIssuanceJid("6281809078014@s.whatsapp.net", true, lidFor, pnFor)).toBe("219606107046135@lid");
    expect(await resolveIssuanceJid("6281809078014@s.whatsapp.net", false, lidFor, pnFor)).toBe("6281809078014@s.whatsapp.net");
    expect(await resolveIssuanceJid("219606107046135@lid", false, lidFor, pnFor)).toBe("6281809078014@s.whatsapp.net");
  });
  it("drops the device suffix", () => {
    expect(normalizeUser("6285724992160:2@s.whatsapp.net")).toBe("6285724992160@s.whatsapp.net");
  });
});

describe("storeTcTokensFromIqResult", () => {
  const lidFor = async () => "219606107046135@lid";
  const iq = (t: string, type = "trusted_contact") => ({
    tag: "iq",
    attrs: {},
    content: [{ tag: "tokens", attrs: {}, content: [{ tag: "token", attrs: { type, t, jid: "me:2@s.whatsapp.net" }, content: new Uint8Array([4, 1, 55]) }] }],
  });
  it("stores a fresh token under the contact's LID and reports it", async () => {
    const { keys, store } = memoryKeys();
    const written = await storeTcTokensFromIqResult({ result: iq("1789346050"), fallbackJid: "6281809078014@s.whatsapp.net", keys, getLIDForPN: lidFor });
    expect(written).toEqual(["219606107046135@lid"]);
    expect(store["219606107046135@lid"]).toMatchObject({ timestamp: "1789346050" });
    expect(Array.from(store["219606107046135@lid"]!.token!)).toEqual([4, 1, 55]);
  });
  it("ignores older, timestamp-less and non-trusted tokens", async () => {
    const { keys, store } = memoryKeys({ "219606107046135@lid": { token: new Uint8Array([9]), timestamp: "1789346050" } });
    expect(await storeTcTokensFromIqResult({ result: iq("1789000000"), fallbackJid: "6281809078014@s.whatsapp.net", keys, getLIDForPN: lidFor })).toEqual([]);
    expect(await storeTcTokensFromIqResult({ result: iq(""), fallbackJid: "6281809078014@s.whatsapp.net", keys, getLIDForPN: lidFor })).toEqual([]);
    expect(await storeTcTokensFromIqResult({ result: iq("1789346060", "other"), fallbackJid: "6281809078014@s.whatsapp.net", keys, getLIDForPN: lidFor })).toEqual([]);
    expect(Array.from(store["219606107046135@lid"]!.token!)).toEqual([9]);
  });
});

describe("mergedTcTokenIndexWrite", () => {
  it("unions the persisted index with new jids and survives a corrupt index", async () => {
    const { keys } = memoryKeys({ [TC_TOKEN_INDEX_KEY]: { token: new Uint8Array(Buffer.from(JSON.stringify(["a@lid"]))) } });
    const write = await mergedTcTokenIndexWrite(keys, ["b@lid", TC_TOKEN_INDEX_KEY, ""]);
    expect(JSON.parse(Buffer.from(write[TC_TOKEN_INDEX_KEY].token!).toString())).toEqual(["a@lid", "b@lid"]);
    const corrupt = memoryKeys({ [TC_TOKEN_INDEX_KEY]: { token: new Uint8Array(Buffer.from("{not json")) } });
    const w2 = await mergedTcTokenIndexWrite(corrupt.keys, ["c@lid"]);
    expect(JSON.parse(Buffer.from(w2[TC_TOKEN_INDEX_KEY].token!).toString())).toEqual(["c@lid"]);
  });
});
