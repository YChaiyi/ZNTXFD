import Image from "next/image";
import Link from "next/link";
import { TagBadge } from "@/components/TagBadge";
import {
  getDailyIndex,
  getDailyReport,
  getDigestStatus,
  getKnowledgeTopics,
  getQuestionItems,
  getTokenRankData,
  getTrustedKnowledgeItems,
} from "@/lib/data";
import { getTokenRankLeaderboard } from "@/lib/tokenRankStore";
import type {
  DailyIndexItem,
  DailyReport,
  DigestImage,
  KnowledgeTopic,
  TrustedKnowledgeItem,
} from "@/lib/data";

const weekdays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

export const dynamic = "force-dynamic";

type AssetStats = {
  issueCount: number;
  topicCount: number;
  messageCount: number;
  insightCount: number;
  toolCount: number;
  contributorCount: number;
};

function formatDate(date: string) {
  const value = new Date(`${date}T00:00:00`);
  return `${value.getMonth() + 1}月${value.getDate()}日 · ${weekdays[value.getDay()]}`;
}

function compactNumber(value: number) {
  if (value >= 10000) return `${(value / 10000).toFixed(1)}万`;
  return value.toLocaleString("zh-CN");
}

function buildAssetStats(cards: DailyIndexItem[], reports: DailyReport[]): AssetStats {
  const tools = new Set<string>();
  const contributors = new Set<string>();
  let insightCount = 0;

  for (const report of reports) {
    for (const topic of report.topics) {
      insightCount += topic.key_insights.length;
      for (const tool of topic.tools_mentioned) tools.add(tool);
      for (const contributor of topic.contributors) contributors.add(contributor);
    }
  }

  return {
    issueCount: cards.length,
    topicCount: cards.reduce((sum, item) => sum + item.topic_count, 0),
    messageCount: cards.reduce((sum, item) => sum + item.total_messages, 0),
    insightCount,
    toolCount: tools.size,
    contributorCount: contributors.size,
  };
}

function SectionTitle({
  title,
  meta,
  href,
  cta,
  tone = "orange",
}: {
  title: string;
  meta?: string;
  href?: string;
  cta?: string;
  tone?: "orange" | "green";
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3">
      <span
        className={`h-5 w-1 rounded-full ${
          tone === "green"
            ? "bg-gradient-to-b from-success to-[#1f9e52]"
            : "bg-gradient-to-b from-accent-light to-accent"
        }`}
      />
      <h2 className="text-lg font-black text-foreground md:text-xl">{title}</h2>
      {meta ? (
        <span className="mono-num text-sm text-foreground-muted">{meta}</span>
      ) : null}
      {href && cta ? (
        <Link href={href} className="ml-auto text-sm font-bold text-accent hover:text-accent-light">
          {cta}
        </Link>
      ) : null}
    </div>
  );
}

function DigestCard({
  image,
  date,
  report,
  index,
}: {
  image: DigestImage;
  date: string;
  report: DailyReport;
  index: number;
}) {
  const topic = report.topics[index % Math.max(report.topics.length, 1)];
  const progress = image.exists ? 100 : 0;
  const previewTags = topic?.tags.slice(0, 2) ?? [];
  const groupStat = report.stats.groups?.find((group) => group.name === image.name);

  return (
    <Link
      href={`/daily/${date}#digest-${image.key}`}
      className="group overflow-hidden rounded-[14px] border border-white/[0.07] bg-[#16161b] shadow-[0_1px_2px_rgba(0,0,0,0.4)] transition-all duration-200 hover:-translate-y-1 hover:border-accent/60 hover:shadow-[0_22px_44px_-20px_rgba(0,0,0,0.85)]"
    >
      <div className="relative aspect-[16/10] overflow-hidden bg-gradient-to-br from-[#3a2410] to-[#15130f]">
        {image.exists ? (
          <Image
            src={image.src}
            alt={`${image.name} ${formatDate(date)} 群精华`}
            fill
            sizes="(min-width: 1280px) 260px, (min-width: 768px) 33vw, 100vw"
            unoptimized
            className="object-cover object-top transition-transform duration-500 group-hover:scale-[1.07]"
          />
        ) : null}
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_45%,rgba(255,106,0,0.16),rgba(9,9,11,0.35)_70%)] opacity-0 transition-opacity duration-200 group-hover:opacity-100" />
        <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-b from-transparent to-[#09090b]/85" />
        <span className="absolute left-2 top-2 rounded-md border border-white/[0.16] bg-[#09090b]/75 px-2 py-1 text-[11px] font-bold text-white backdrop-blur">
          {image.label}
        </span>
        <span
          className={`absolute right-2 top-2 rounded-md border px-2 py-1 text-[11px] font-bold backdrop-blur ${
            image.exists
              ? "border-success/40 bg-[#09090b]/75 text-success"
              : "border-danger/40 bg-[#09090b]/75 text-danger"
          }`}
        >
          {image.exists ? "已生成" : "待补齐"}
        </span>
        {groupStat ? (
          <span
            data-group-count={image.key}
            className="absolute bottom-2 right-2 rounded-md bg-[#09090b]/85 px-2 py-1 text-xs font-bold text-white"
          >
            {compactNumber(groupStat.message_count)}
          </span>
        ) : null}
        <span className="absolute left-1/2 top-1/2 flex h-12 w-12 -translate-x-1/2 -translate-y-1/2 scale-90 items-center justify-center rounded-full bg-gradient-to-b from-accent-light to-accent text-background opacity-0 shadow-[0_10px_26px_rgba(255,106,0,0.55)] transition-all duration-200 group-hover:scale-100 group-hover:opacity-100">
          <svg aria-hidden="true" viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 4.5h6a3 3 0 0 1 3 3v12a2.4 2.4 0 0 0-2.4-2.4H3z" />
            <path d="M21 4.5h-6a3 3 0 0 0-3 3v12a2.4 2.4 0 0 1 2.4-2.4H21z" />
          </svg>
        </span>
        <div className="absolute inset-x-0 bottom-0 h-[3px] bg-white/15">
          <div
            className="h-full rounded-r bg-gradient-to-r from-accent to-accent-light"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>
      <div className="p-3">
        <h3 className="line-clamp-2 min-h-[40px] text-[15px] font-bold leading-snug text-foreground">
          {image.name}
        </h3>
        <div className="mt-2 flex items-center gap-2 text-xs text-foreground-muted">
          <span className="font-bold text-accent">{formatDate(date)}</span>
          <span className="opacity-50">·</span>
          <span>{report.topics.length} 话题</span>
        </div>
        <div className="mt-3 flex max-h-6 flex-wrap gap-2 overflow-hidden">
          {previewTags.map((tag) => (
            <TagBadge key={tag}>{tag}</TagBadge>
          ))}
        </div>
      </div>
    </Link>
  );
}

function KnowledgeFeature({ item }: { item: TrustedKnowledgeItem }) {
  const verdict = item.rating === "AAA" ? "AAA" : item.rating === "AA" ? "AA" : "待验证";

  return (
    <Link
      href={`/knowledge/${item.slug}`}
      className="group relative flex min-h-[196px] flex-col gap-3 overflow-hidden rounded-2xl border border-accent/25 bg-[#111116] p-5 transition-all hover:-translate-y-1 hover:border-accent/60 hover:shadow-[0_18px_42px_-20px_rgba(0,0,0,0.85)]"
    >
      <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(255,143,42,0.10),rgba(255,143,42,0.015))]" />
      <div className="relative flex items-center gap-2">
        <span className="rounded-full bg-success px-3 py-1 text-xs font-black text-background">
          {verdict}
        </span>
        <span className="text-xs text-foreground-muted">
          {item.category} · {item.tags[0] ?? "知识"}
        </span>
        <span className="ml-auto text-xs font-bold text-success">可信知识</span>
      </div>
      <h3 className="relative line-clamp-2 text-lg font-black leading-snug text-foreground group-hover:text-accent-light">
        {item.title}
      </h3>
      <p className="relative line-clamp-3 flex-1 text-sm leading-6 text-foreground-muted">
        {item.summary}
      </p>
      <div className="relative flex flex-wrap items-center gap-3 border-t border-white/[0.08] pt-3 text-xs text-foreground-muted">
        <span>
          <span className="mono-num text-xl font-black text-accent">{item.rating ?? "A"}</span>
          <span className="ml-1">评级</span>
        </span>
        <span>证据 {item.evidenceCount}</span>
        <span>来源 {item.sourceCount ?? item.evidenceCount}</span>
        <span>引用 {item.citationCount}</span>
      </div>
    </Link>
  );
}

function ArchiveCard({ card }: { card: DailyIndexItem }) {
  const status = getDigestStatus(card.date);

  return (
    <Link
      href={`/daily/${card.date}`}
      className="group overflow-hidden rounded-[14px] border border-white/[0.07] bg-[#16161b] p-4 transition-all hover:-translate-y-1 hover:border-accent/50"
    >
      <div className="flex items-center justify-between gap-3">
        <time className="mono-num text-xs font-bold text-accent">{formatDate(card.date)}</time>
        <span className="rounded-md bg-[#202027] px-2 py-1 text-xs font-bold text-foreground-muted">
          {status.readyCount}/{status.totalCount}
        </span>
      </div>
      <h3 className="mt-3 line-clamp-2 min-h-[44px] text-base font-black leading-snug text-foreground group-hover:text-accent-light">
        {card.title}
      </h3>
      <div className="mt-4 grid grid-cols-3 gap-2 text-center">
        <span className="rounded-lg bg-white/[0.035] p-2">
          <span className="mono-num block text-sm font-black text-success">
            {card.total_messages}
          </span>
          <span className="text-[11px] text-foreground-muted">消息</span>
        </span>
        <span className="rounded-lg bg-white/[0.035] p-2">
          <span className="mono-num block text-sm font-black text-purple">
            {card.active_members}
          </span>
          <span className="text-[11px] text-foreground-muted">活跃</span>
        </span>
        <span className="rounded-lg bg-white/[0.035] p-2">
          <span className="mono-num block text-sm font-black text-accent">
            {card.topic_count}
          </span>
          <span className="text-[11px] text-foreground-muted">话题</span>
        </span>
      </div>
    </Link>
  );
}

function TopicRail({ topics }: { topics: KnowledgeTopic[] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {topics.slice(0, 8).map((topic) => (
        <Link
          key={topic.slug}
          href={`/topics/${topic.slug}`}
          className="inline-flex items-center gap-2 rounded-full border border-white/[0.09] bg-[#191920] px-3 py-2 text-xs font-semibold text-foreground-muted transition-colors hover:border-accent/40 hover:text-accent"
        >
          {topic.name}
          <span className="mono-num font-black text-accent">{topic.count}</span>
        </Link>
      ))}
    </div>
  );
}

export default async function Home() {
  const dailyCards = getDailyIndex().sort((a, b) => b.date.localeCompare(a.date));
  const reports = dailyCards.map((card) => getDailyReport(card.date));
  const latest = dailyCards[0] ?? null;
  const latestReport = reports[0] ?? null;
  const digestStatus = latest ? getDigestStatus(latest.date) : null;
  const topics = getKnowledgeTopics();
  const trustedItems = getTrustedKnowledgeItems().filter((item) => item.rating === "AAA");
  const questions = getQuestionItems();
  const tokenRankBase = getTokenRankData();
  const tokenRankLeaderboard = await getTokenRankLeaderboard({
    board: "total",
    range: "today",
    metric: "total",
  });
  const tokenRank = {
    ...tokenRankBase,
    entries: tokenRankLeaderboard.entries,
    totalMembers: tokenRankLeaderboard.totalMembers,
    updatedAt: tokenRankLeaderboard.updatedAt,
    aggregate: tokenRankLeaderboard.aggregate,
  };
  const stats = buildAssetStats(dailyCards, reports);
  const archiveCards = dailyCards.slice(1, 9);
  const latestTopics = latestReport?.topics.slice(0, 5) ?? [];
  const tokenRows = tokenRank.entries.slice(0, 8);

  return (
    <section className="relative overflow-hidden">
      {dailyCards.length === 0 || !latest || !latestReport || !digestStatus ? (
        <div className="glass-card relative px-5 py-12 text-center text-sm text-foreground-muted">
          暂无可展示内容
        </div>
      ) : (
        <div className="relative space-y-7">
          <section className="flex flex-wrap items-center gap-4 rounded-[14px] border border-accent/25 bg-[linear-gradient(100deg,rgba(255,143,42,0.15),rgba(255,143,42,0.02))] px-5 py-4">
            <span className="inline-flex items-center gap-2 text-xs font-black uppercase tracking-[0.08em] text-accent">
              <span className="h-2 w-2 rounded-full bg-accent shadow-[0_0_10px_#ff6a00] animate-pulse" />
              今日更新
            </span>
            <div className="font-black text-foreground">最新一期 · {formatDate(latest.date)}</div>
            <div className="text-sm text-foreground-muted">
              {latestTopics.slice(0, 2).map((topic) => topic.title).join(" · ")}
            </div>
            <span className="rounded-full border border-success/30 bg-success/15 px-3 py-1 text-xs font-black text-success">
              {digestStatus.readyCount}/{digestStatus.totalCount} 群精华
            </span>
            <Link
              href={`/daily/${latest.date}`}
              className="ml-auto inline-flex h-10 items-center rounded-lg bg-gradient-to-b from-accent-light to-accent px-5 text-sm font-black text-background transition-transform hover:-translate-y-0.5"
            >
              打开本期 →
            </Link>
          </section>

          <section className="grid gap-7 xl:grid-cols-[minmax(0,1fr)_360px]">
            <div className="min-w-0 space-y-8">
              <section>
                <SectionTitle
                  title="编辑精选 · 可信知识"
                  meta="最有价值"
                  href="/knowledge"
                  cta="全部知识 →"
                  tone="green"
                />
                <div className="grid gap-4 md:grid-cols-3">
                  {trustedItems.slice(0, 3).map((item) => (
                    <KnowledgeFeature key={item.slug} item={item} />
                  ))}
                </div>
              </section>

              <section>
                <SectionTitle
                  title="今日五群精华"
                  meta={formatDate(latest.date)}
                  href={`/daily/${latest.date}`}
                  cta="全部日报 →"
                />
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
                  {digestStatus.images.map((image, index) => (
                    <DigestCard
                      key={image.key}
                      image={image}
                      date={latest.date}
                      report={latestReport}
                      index={index}
                    />
                  ))}
                </div>
              </section>

              <section>
                <SectionTitle
                  title="往期精华"
                  meta={`${archiveCards.length} 条精华`}
                  href="/daily"
                  cta="全部期刊 →"
                />
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {archiveCards.map((card) => (
                    <ArchiveCard key={card.date} card={card} />
                  ))}
                </div>
              </section>

              <section>
                <SectionTitle title="本期弹药索引" href={`/daily/${latest.date}`} cta="查看完整 →" />
                <div className="grid gap-3 md:grid-cols-2">
                  {latestTopics.map((topic) => (
                    <Link
                      key={topic.title}
                      href={`/daily/${latest.date}`}
                      className="rounded-[14px] border border-white/[0.07] bg-[#16161b] p-4 transition-all hover:-translate-y-1 hover:border-accent/50"
                    >
                      <h3 className="line-clamp-2 text-sm font-black leading-6 text-foreground">
                        {topic.title}
                      </h3>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {topic.tags.slice(0, 3).map((tag) => (
                          <TagBadge key={tag}>{tag}</TagBadge>
                        ))}
                      </div>
                    </Link>
                  ))}
                </div>
              </section>
            </div>

            <aside className="space-y-5 xl:sticky xl:top-24">
              <section className="overflow-hidden rounded-2xl border border-white/[0.07] bg-[#121217]">
                <div className="flex items-center gap-2 border-b border-white/[0.06] px-4 py-4">
                  <h2 className="text-base font-black text-foreground">Token 消耗榜</h2>
                  <span className="rounded-md bg-gradient-to-b from-accent-light to-accent px-2 py-1 text-[11px] font-black text-background">
                    昨日
                  </span>
                  <Link href="/token-rank" className="ml-auto text-xs font-bold text-accent">
                    完整 →
                  </Link>
                </div>
                <div className="p-3">
                  {tokenRows.length > 0 ? (
                    <div className="space-y-2">
                      {tokenRows.map((row) => {
                        const maxScore = Math.max(tokenRows[0]?.score ?? 1, 1);
                        const width = `${Math.max(6, Math.round((row.score / maxScore) * 100))}%`;
                        return (
                          <Link
                            key={row.userId}
                            href="/token-rank"
                            className="flex items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-white/[0.04]"
                          >
                            <span className="mono-num w-7 rounded-md bg-[#202027] py-1 text-center text-xs font-black text-foreground-muted">
                              {row.rank}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-bold text-foreground">
                                {row.name}
                              </span>
                              <span className="mt-1 block h-1 overflow-hidden rounded-full bg-[#22222a]">
                                <span
                                  className="block h-full rounded-full bg-gradient-to-r from-accent to-accent-light"
                                  style={{ width }}
                                />
                              </span>
                            </span>
                            <span className="mono-num text-sm font-black text-accent">
                              {compactNumber(row.score)}
                            </span>
                          </Link>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="px-2 py-4 text-sm leading-6 text-foreground-muted">
                      {tokenRank.updatedAt}
                    </p>
                  )}
                </div>
              </section>

              <section className="overflow-hidden rounded-2xl border border-white/[0.07] bg-[#121217]">
                <div className="flex items-center gap-2 border-b border-white/[0.06] px-4 py-4">
                  <h2 className="text-base font-black text-foreground">热门提问</h2>
                  <Link href="/questions" className="ml-auto text-xs font-bold text-accent">
                    全部 →
                  </Link>
                </div>
                <div>
                  {questions.slice(0, 3).map((question) => (
                    <Link
                      key={question.slug}
                      href="/questions"
                      className="block border-t border-white/[0.04] px-4 py-3 first:border-t-0 transition-colors hover:bg-white/[0.035]"
                    >
                      <h3 className="line-clamp-2 text-sm font-semibold leading-5 text-foreground">
                        {question.title}
                      </h3>
                      <p className="mt-2 text-xs text-foreground-muted">
                        {question.answers} 个回答 · {question.votes}% 热度
                      </p>
                    </Link>
                  ))}
                </div>
              </section>

              <section className="rounded-2xl border border-white/[0.07] bg-[#121217] p-4">
                <h2 className="mb-3 text-base font-black text-foreground">正在形成的知识脉络</h2>
                <TopicRail topics={topics} />
              </section>
            </aside>
          </section>

          <section className="grid gap-4 border-t border-white/[0.06] pt-6 sm:grid-cols-2 lg:grid-cols-6">
            {[
              { value: `${stats.issueCount}`, label: "期内容" },
              { value: `${stats.topicCount}`, label: "话题索引" },
              { value: compactNumber(stats.messageCount), label: "条消息" },
              { value: `${stats.insightCount}`, label: "高价值观点" },
              { value: `${stats.toolCount}`, label: "工具线索" },
              { value: `${stats.contributorCount}`, label: "贡献者" },
            ].map((item) => (
              <div key={item.label} className="text-center">
                <div className="mono-num bg-gradient-to-b from-accent-light to-accent bg-clip-text text-3xl font-black leading-none text-transparent">
                  {item.value}
                </div>
                <div className="mt-2 text-sm text-foreground-muted">{item.label}</div>
              </div>
            ))}
          </section>
        </div>
      )}
    </section>
  );
}
