import Link from "next/link";
import { TagBadge } from "@/components/TagBadge";
import { getKnowledgeTopics } from "@/lib/data";

export const dynamic = "force-dynamic";

export default function TopicsPage() {
  const topics = getKnowledgeTopics();

  return (
    <section className="relative overflow-hidden">
      <div className="pointer-events-none absolute -left-24 top-4 h-72 w-72 rounded-full bg-[radial-gradient(circle,rgba(240,185,11,0.16)_0%,rgba(240,185,11,0)_68%)] blur-2xl" />
      <div className="pointer-events-none absolute right-0 top-32 h-72 w-72 rounded-full bg-[radial-gradient(circle,rgba(131,100,255,0.14)_0%,rgba(131,100,255,0)_70%)] blur-2xl" />

      <div className="relative mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground md:text-3xl">
            弹药库
          </h1>
          <p className="mt-2 text-sm text-foreground-muted">
            从全部期刊标签自动聚合的工具、观点、教程、案例和风险提醒
          </p>
        </div>
        <span className="mono-num hidden text-sm text-foreground-muted sm:inline">
          {topics.length} 个弹药标签
        </span>
      </div>

      <div className="relative grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {topics.map((topic, index) => (
          <Link
            key={topic.slug}
            href={`/topics/${topic.slug}`}
            className="glass-card card-hover group flex min-h-[230px] flex-col p-5 hover:border-white/[0.14]"
          >
            <div className="flex items-start justify-between gap-4">
              <span className="mono-num flex h-10 w-10 items-center justify-center rounded-full bg-accent/10 text-sm font-bold text-accent">
                {index + 1}
              </span>
              <span className="mono-num rounded-full bg-success/10 px-3 py-1 text-xs font-semibold text-success">
                {topic.count} 期出现
              </span>
            </div>
            <h2 className="mt-5 text-xl font-bold leading-8 text-foreground transition-colors group-hover:text-accent">
              {topic.name}
            </h2>
            <div className="mt-4 flex flex-wrap gap-2">
              {topic.relatedTags.slice(0, 3).map((tag) => (
                <TagBadge key={tag}>{tag}</TagBadge>
              ))}
            </div>
            <div className="mt-auto border-t border-white/[0.06] pt-5">
              <p className="mono-num text-sm font-medium text-foreground-muted">
                {topic.contributors.length} 位贡献者
              </p>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
