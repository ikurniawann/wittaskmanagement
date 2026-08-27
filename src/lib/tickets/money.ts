// Money formatting for ticketing (Owner 2026-08-17).
//
// The app was single-currency until Megatix arrived: everything went through
// formatIDR. Megatix reports a currency PER EVENT (their sample is AUD), so
// printing an Australian total with "Rp" in front of it would be a lie that
// looks like a rounding difference. Rows carry their currency; this formats
// what the row actually says and falls back to IDR only when nothing does.

export function formatMoney(
  amount: number | null | undefined,
  currency: string | null | undefined,
): string {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) {
    return "—";
  }
  const code = (currency ?? "IDR").trim().toUpperCase() || "IDR";
  // IDR has no minor unit in practice here; everything else keeps 2 decimals
  const fractionDigits = code === "IDR" ? 0 : 2;
  try {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: code,
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    }).format(amount);
  } catch {
    // an unknown code must not take the page down — show the number and the
    // code verbatim so the reader can still see what they are looking at
    return `${code} ${amount.toLocaleString("en-GB", {
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    })}`;
  }
}

/** Sums a column of numeric-strings without letting a float near the parts. */
export function sumMoneyStrings(values: Array<string | null>): number {
  let total = 0;
  for (const value of values) {
    if (!value) continue;
    const parsed = Number(value);
    if (Number.isFinite(parsed)) total += Math.round(parsed * 100);
  }
  return total / 100;
}
