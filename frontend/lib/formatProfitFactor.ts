/**
 * Profit factor display aligned with engine: JSON null + profitFactorStatus when the ratio is undefined
 * (e.g. no losing trades). Legacy payloads may still use a 999-style sentinel.
 */
export function formatProfitFactorDisplay(value: unknown, status?: string | null): string {
  const s = (status ?? "").trim();
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value >= 999 && s !== "defined") {
      return "∞ (legacy / no losing trades)";
    }
    return value.toFixed(2);
  }
  if (value != null && value !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) {
      if (n >= 999 && s !== "defined") {
        return "∞ (legacy / no losing trades)";
      }
      return n.toFixed(2);
    }
  }
  if (s === "undefined_no_losing_trades") return "∞ (no losing trades)";
  if (s === "no_gross_activity") return "N/A (no P&L)";
  return "N/A";
}

export function formatProfitFactorFromRow(row: Record<string, unknown>): string {
  const st = typeof row.profitFactorStatus === "string" ? row.profitFactorStatus : undefined;
  return formatProfitFactorDisplay(row.profitFactor, st);
}
