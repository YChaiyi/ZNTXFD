import Link from "next/link";
import {
  getDailyIndex,
  getDailyReport,
  getDigestStatus,
  getQuestionItems,
  getTrustedKnowledgeItems,
} from "@/lib/data";
import type { DailyIndexItem, DailyReport, TrustedKnowledgeItem } from "@/lib/data";

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

export default async function Home() {
  const dailyCards = getDailyIndex().sort((a, b) => b.date.localeCompare(a.date));
  const reports = dailyCards.map((card) => getDailyReport(card.date));
  const latest = dailyCards[0] ?? null;
  const latestReport = reports[0] ?? null;
  const digestStatus = latest ? getDigestStatus(latest.date) : null;
  const trustedItems = getTrustedKnowledgeItems().filter((item) => item.rating === "AAA");
  const questions = getQuestionItems();
  const stats = buildAssetStats(dailyCards, reports);
  const latestTopics = latestReport?.topics.slice(0, 2) ?? [];
  const groupChips = (digestStatus?.images ?? []).map((image) => ({
    key: image.key,
    label: image.label,
    count:
      latestReport?.stats.groups?.find((group) => group.name === image.name)
        ?.message_count ?? null,
  }));

  return (
    <section className="relative overflow-hidden">
      {dailyCards.length === 0 || !latest || !latestReport || !digestStatus ? (
        <div className="glass-card relative px-5 py-12 text-center text-sm text-foreground-muted">
          暂无可展示内容
        </div>
      ) : (
        <div className="relative space-y-10">
          <section className="grid items-center gap-8 rounded-[20px] border border-accent/20 bg-[linear-gradient(115deg,rgba(255,143,42,0.10),rgba(255,143,42,0.015))] p-6 md:p-10 lg:grid-cols-[minmax(0,1fr)_420px]">
            <div className="space-y-5">
              <h1 className="text-3xl font-black leading-tight text-foreground md:text-4xl">
                每天从 5 个 AI 实战社群沉淀可信知识
              </h1>
              <p className="max-w-[560px] text-sm leading-7 text-foreground-muted md:text-base">
                观点带来源与证据链：日更期刊、可信知识库和热门提问，帮你不爬楼也能跟上一线实践。
              </p>
              <div className="flex flex-wrap gap-3">
                <a
                  href="#join"
                  className="inline-flex h-11 items-center rounded-lg bg-gradient-to-b from-accent-light to-accent px-6 text-sm font-black text-background transition-transform hover:-translate-y-0.5"
                >
                  加入社群
                </a>
                <Link
                  href={`/daily/${latest.date}`}
                  className="inline-flex h-11 items-center rounded-lg border border-accent/40 px-6 text-sm font-black text-accent transition-colors hover:border-accent hover:text-accent-light"
                >
                  看今日期刊
                </Link>
              </div>
            </div>

            <div className="glass-card space-y-4 p-5">
              <div className="flex flex-wrap items-center gap-2 text-xs font-black text-accent">
                <span className="pulse-dot" aria-hidden="true" />
                今日更新 · {formatDate(latest.date)}
                <span className="ml-auto rounded-full border border-success/30 bg-success/15 px-3 py-1 font-black text-success">
                  {digestStatus.readyCount}/{digestStatus.totalCount} 群已归档
                </span>
              </div>
              <h2 className="line-clamp-2 text-lg font-black leading-snug text-foreground">
                {latestReport.title}
              </h2>
              <p className="line-clamp-2 text-sm leading-6 text-foreground-muted">
                {latestTopics.map((topic) => topic.title).join(" · ")}
              </p>
              <div className="flex flex-wrap gap-2">
                {groupChips.map((chip) => (
                  <Link
                    key={chip.key}
                    href={`/daily/${latest.date}#digest-${chip.key}`}
                    className="inline-flex min-h-8 items-center gap-2 rounded-full border border-white/[0.09] bg-[#191920] px-3 py-1.5 text-xs font-semibold text-foreground-muted transition-colors hover:border-accent/40 hover:text-accent"
                  >
                    {chip.label}
                    {chip.count != null ? (
                      <span
                        className="mono-num font-black text-accent"
                        data-group-count={chip.key}
                      >
                        {compactNumber(chip.count)}
                      </span>
                    ) : null}
                  </Link>
                ))}
              </div>
              <Link
                href={`/daily/${latest.date}`}
                className="inline-flex h-10 items-center rounded-lg bg-gradient-to-b from-accent-light to-accent px-5 text-sm font-black text-background transition-transform hover:-translate-y-0.5"
              >
                打开本期 →
              </Link>
            </div>
          </section>

          <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
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
            <SectionTitle title="热门提问" href="/questions" cta="全部提问 →" />
            <div className="grid gap-3 md:grid-cols-3">
              {questions.slice(0, 3).map((question) => (
                <Link
                  key={question.slug}
                  href="/questions"
                  className="glass-card card-hover p-4 transition-all hover:-translate-y-1 hover:border-accent/50"
                >
                  <h3 className="line-clamp-2 min-h-[40px] text-sm font-bold leading-5 text-foreground">
                    {question.title}
                  </h3>
                  <p className="mt-2 text-xs text-foreground-muted">
                    {question.answers} 个回答
                  </p>
                </Link>
              ))}
            </div>
          </section>

          <nav
            aria-label="更多入口"
            className="flex flex-wrap gap-x-6 gap-y-3 border-t border-white/[0.06] pt-5 text-sm font-semibold"
          >
            <Link href="/daily" className="text-foreground-muted hover:text-accent">
              全部期刊归档 →
            </Link>
            <Link
              href={`/daily/${latest.date}`}
              className="text-foreground-muted hover:text-accent"
            >
              本期索引 →
            </Link>
            <Link href="/token-rank" className="text-foreground-muted hover:text-accent">
              Token 消耗榜 →
            </Link>
            <Link href="/topics" className="text-foreground-muted hover:text-accent">
              知识脉络 →
            </Link>
            <Link href="/search" className="text-foreground-muted hover:text-accent">
              搜索 →
            </Link>
          </nav>
        </div>
      )}
    </section>
  );
}
