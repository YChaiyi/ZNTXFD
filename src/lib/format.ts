// The site-wide count formatter: one tier vocabulary for every number the
// UI shows (thousands separators below 1万, then 万 and 亿 with one decimal).
export function formatCount(value: number): string {
  if (value >= 100_000_000) return `${(value / 100_000_000).toFixed(1)}亿`;
  if (value >= 10000) return `${(value / 10000).toFixed(1)}万`;
  return Math.round(value).toLocaleString("zh-CN");
}
