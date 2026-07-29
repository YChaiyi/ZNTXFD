const TONES: Record<string, string> = {
  AAA: "border-success/40 bg-success/15 text-success",
  AA: "border-[#53b184]/40 bg-[#53b184]/15 text-[#53b184]",
  A: "border-[#8fa89a]/40 bg-[#8fa89a]/15 text-[#8fa89a]",
};

export function RatingBadge({ rating }: { rating?: string }) {
  const known = rating && TONES[rating] ? rating : null;
  const tone = known
    ? TONES[known]
    : "border-white/[0.14] bg-white/[0.05] text-foreground-muted";

  return (
    <span
      data-rating={known ?? "待验证"}
      className={`mono-num inline-flex items-center rounded-md border px-2.5 py-1 text-xs font-black ${tone}`}
    >
      {known ?? "待验证"}
    </span>
  );
}
