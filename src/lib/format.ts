// The site-wide count formatter: one tier vocabulary for every number the
// UI shows (thousands separators below 1万, then 万 and 亿 with one decimal).
// Tier thresholds sit at the value where toFixed(1) starts rounding into the
// next tier, so 99,999,999.6 reads 1.0亿 rather than 10000.0万.
export function formatCount(value: number): string {
  if (!Number.isFinite(value)) return "0";
  if (value >= 99_950_000) return `${(value / 100_000_000).toFixed(1)}亿`;
  if (value >= 9_995) return `${(value / 10_000).toFixed(1)}万`;
  return Math.round(value).toLocaleString("zh-CN");
}
