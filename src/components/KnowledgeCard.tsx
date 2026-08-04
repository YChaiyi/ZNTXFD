import Link from "next/link";
import { RatingBadge } from "@/components/RatingBadge";

export type KnowledgeCardItem = {
  slug: string;
  title: string;
  category: string;
  rating?: string;
  summary: string;
  evidenceCount: number;
  sourceCount?: number;
  citationCount: number;
};

// The four-layer card template: badge row, title (the card's only real
// link, stretched over the card), two-line summary, metadata row.
export function KnowledgeCard({ item }: { item: KnowledgeCardItem }) {
  return (
    <article
      data-knowledge-card
      className="group relative flex min-h-[196px] flex-col gap-3 overflow-hidden rounded-2xl border border-accent/25 bg-[#111116] p-5 transition-all hover:-translate-y-1 hover:border-accent/60 hover:shadow-[0_18px_42px_-20px_rgba(0,0,0,0.85)]"
    >
      <div className="flex flex-wrap items-center gap-2">
        <RatingBadge rating={item.rating} />
        <span className="text-xs text-foreground-muted">{item.category}</span>
      </div>
      <h3 className="text-lg font-black leading-snug">
        <Link
          href={`/knowledge/${item.slug}`}
          aria-label={`${item.title}（${item.rating || "待验证"} · ${item.category}）`}
          className="line-clamp-2 text-foreground transition-colors after:absolute after:inset-0 after:content-[''] group-hover:text-accent-light"
        >
          {item.title}
        </Link>
      </h3>
      <p className="line-clamp-2 flex-1 text-sm leading-6 text-foreground-muted">
        {item.summary}
      </p>
      <div className="flex flex-wrap items-center gap-3 border-t border-white/[0.08] pt-3 text-xs text-foreground-muted">
        <span>证据 {item.evidenceCount}</span>
        <span>来源 {item.sourceCount ?? item.evidenceCount}</span>
        <span>引用 {item.citationCount}</span>
      </div>
    </article>
  );
}
