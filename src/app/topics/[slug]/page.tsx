import Link from "next/link";
import { notFound } from "next/navigation";
import { TagBadge } from "@/components/TagBadge";
import {
  getDailyReport,
  getKnowledgeTopics,
} from "@/lib/data";
import type { DailyTopic, KnowledgeTopic } from "@/lib/data";

export const dynamic = "force-dynamic";

type TopicDetailPageProps = {
  params: Promise<{
    slug: string;
  }>;
};

const weekdays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

function formatDate(date: string) {
  const value = new Date(`${date}T00:00:00`);
  return `${value.getMonth() + 1}月${value.getDate()}日 · ${weekdays[value.getDay()]}`;
}

function getTopicTimeline(topic: KnowledgeTopic) {
  return topic.dates
    .map((date) => {
      const report = getDailyReport(date);
      const matches = report.topics.filter((item) =>
        item.tags.includes(topic.name),
      );

      return {
        date,
        title: report.title,
        topics: matches,
      };
    })
    .filter((item) => item.topics.length > 0);
}

function uniqueItems(items: string[]) {
  return [...new Set(items.filter(Boolean))];
}

export default async function TopicDetailPage({ params }: TopicDetailPageProps) {
  const { slug } = await params;
  const decodedSlug = decodeURIComponent(slug);
  const topic = getKnowledgeTopics().find(
    (item) => item.slug === decodedSlug || item.name === decodedSlug,
  );

  if (!topic) {
    notFound();
  }

  const timeline = getTopicTimeline(topic);
  const insights = uniqueItems(topic.insights).slice(0, 12);
  const tools = uniqueItems(topic.tools);

  return (
    <section className="relative overflow-hidden">
      <div className="pointer-events-none absolute -left-28 top-6 h-72 w-72 rounded-full bg-[radial-gradient(circle,rgba(240,185,11,0.18)_0%,rgba(240,185,11,0)_68%)] blur-2xl" />
      <div className="pointer-events-none absolute right-0 top-36 h-72 w-72 rounded-full bg-[radial-gradient(circle,rgba(2,192,118,0.12)_0%,rgba(2,192,118,0)_70%)] blur-2xl" />

      <Link
        href="/topics"
        className="glass card-hover relative mb-5 inline-flex items-center rounded-full px-3 py-2 text-sm font-medium text-foreground-muted hover:border-white/[0.14] hover:text-accent"
      >
        ← 返回知识脉络
      </Link>

      <header className="glass-card glow-border card-hover relative mb-6 p-5 hover:border-white/[0.14] md:p-7">
        <p className="text-xs font-bold uppercase tracking-[0.24em] text-accent">
          Arsenal Topic
        </p>
        <h1 className="mt-3 text-3xl font-bold leading-tight text-foreground md:text-5xl">
          {topic.name}
        </h1>
        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <div className="rounded-[14px] border border-white/[0.06] bg-white/[0.03] p-4">
            <p className="text-xs text-foreground-muted">出现期数</p>
            <p className="mono-num mt-2 text-2xl font-bold text-accent">
              {topic.count}
            </p>
          </div>
          <div className="rounded-[14px] border border-white/[0.06] bg-white/[0.03] p-4">
            <p className="text-xs text-foreground-muted">贡献者</p>
            <p className="mono-num mt-2 text-2xl font-bold text-success">
              {topic.contributors.length}
            </p>
          </div>
          <div className="rounded-[14px] border border-white/[0.06] bg-white/[0.03] p-4">
            <p className="text-xs text-foreground-muted">提到工具</p>
            <p className="mono-num mt-2 text-2xl font-bold text-purple">
              {tools.length}
            </p>
          </div>
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-4">
          <section className="glass-card card-hover p-5 hover:border-white/[0.14]">
            <h2 className="text-lg font-bold text-foreground">核心洞见</h2>
            <div className="mt-5 space-y-3">
              {insights.length > 0 ? (
                insights.map((insight) => (
                  <p
                    key={insight}
                    className="flex gap-3 text-sm leading-6 text-foreground-muted"
                  >
                    <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-accent" />
                    <span>{insight}</span>
                  </p>
                ))
              ) : (
                <p className="text-sm text-foreground-muted">
                  暂无结构化核心洞见
                </p>
              )}
            </div>
          </section>

          <section className="glass-card card-hover p-5 hover:border-white/[0.14]">
            <h2 className="text-lg font-bold text-foreground">期刊时间线</h2>
            <div className="mt-5 space-y-4">
              {timeline.map((item) => (
                <div
                  key={item.date}
                  className="border-l-2 border-accent/70 pl-4"
                >
                  <Link
                    href={`/daily/${item.date}`}
                    className="mono-num text-sm font-semibold text-accent"
                  >
                    {formatDate(item.date)}
                  </Link>
                  <p className="mt-1 text-sm text-foreground-muted">
                    {item.title}
                  </p>
                  <div className="mt-3 space-y-2">
                    {item.topics.map((dailyTopic: DailyTopic) => (
                      <Link
                        key={dailyTopic.title}
                        href={`/daily/${item.date}`}
                        className="block rounded-[12px] border border-white/[0.04] bg-white/[0.02] px-3 py-2 text-sm font-medium text-foreground transition-colors hover:border-white/[0.14] hover:text-accent"
                      >
                        {dailyTopic.title}
                      </Link>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>

        <aside className="space-y-4">
          <section className="glass-card card-hover p-5 hover:border-white/[0.14]">
            <h2 className="text-lg font-bold text-foreground">提到的工具</h2>
            <div className="mt-4 flex flex-wrap gap-2">
              {tools.length > 0 ? (
                tools.map((tool) => <TagBadge key={tool}>{tool}</TagBadge>)
              ) : (
                <p className="text-sm text-foreground-muted">暂无工具提及</p>
              )}
            </div>
          </section>

          <section className="glass-card card-hover p-5 hover:border-white/[0.14]">
            <h2 className="text-lg font-bold text-foreground">关联话题标签</h2>
            <div className="mt-4 flex flex-wrap gap-2">
              {topic.relatedTags.length > 0 ? (
                topic.relatedTags.map((tag) => (
                  <TagBadge key={tag}>{tag}</TagBadge>
                ))
              ) : (
                <p className="text-sm text-foreground-muted">暂无关联标签</p>
              )}
            </div>
          </section>

          <section className="glass-card card-hover p-5 hover:border-white/[0.14]">
            <h2 className="text-lg font-bold text-foreground">贡献者</h2>
            <div className="mt-4 flex flex-wrap gap-2">
              {topic.contributors.slice(0, 18).map((name) => (
                <span
                  key={name}
                  className="rounded-full border border-white/[0.06] bg-white/[0.03] px-3 py-1.5 text-xs text-foreground-muted"
                >
                  {name}
                </span>
              ))}
            </div>
          </section>
        </aside>
      </div>
    </section>
  );
}
