import { describe, expect, it } from "vitest";
import { formatMoney, sumMoneyStrings } from "./money";

describe("formatMoney", () => {
  it("prints rupiah without decimals", () => {
    expect(formatMoney(11_625_000, "IDR")).toContain("11,625,000");
  });

  it("does NOT print an Australian total as rupiah", () => {
    const aud = formatMoney(253.5, "AUD");
    expect(aud).toContain("253.50");
    expect(aud).not.toContain("Rp");
  });

  it("falls back to IDR when a row carries no currency", () => {
    expect(formatMoney(1000, null)).toContain("1,000");
    expect(formatMoney(1000, "")).toContain("1,000");
  });

  it("keeps an unfamiliar but well-formed code visible", () => {
    // Intl accepts any 3-letter code, so this goes through the normal path
    expect(formatMoney(42, "ZZZ")).toMatch(/ZZZ\s?42\.00/);
  });

  it("survives a malformed code instead of throwing", () => {
    // Intl DOES throw on these — the fallback is what keeps the page up
    expect(formatMoney(42, "Z")).toBe("Z 42.00");
    expect(formatMoney(42, "rupiah!")).toBe("RUPIAH! 42.00");
  });

  it("missing amounts read as em dash, never as zero", () => {
    expect(formatMoney(null, "IDR")).toBe("—");
    expect(formatMoney(undefined, "IDR")).toBe("—");
    expect(formatMoney(Number.NaN, "IDR")).toBe("—");
  });
});

describe("sumMoneyStrings", () => {
  it("adds cents exactly — 0.1 + 0.2 must be 0.3", () => {
    expect(sumMoneyStrings(["0.1", "0.2"])).toBe(0.3);
  });

  it("adds the real Tessera fee shape without drift", () => {
    expect(sumMoneyStrings(["30071.43", "30071.43", "30071.43"])).toBe(90214.29);
  });

  it("skips nulls and unreadable values rather than counting them as zero", () => {
    expect(sumMoneyStrings([null, "abc", "5"])).toBe(5);
    expect(sumMoneyStrings([])).toBe(0);
  });
});
