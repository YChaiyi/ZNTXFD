import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ContributorList } from "@/components/ContributorList";
import { MarkdownContent } from "@/components/MarkdownContent";
import { TagBadge } from "@/components/TagBadge";
import {
  getAllDates,
  getDailyReport,
  getDigestImages,
  isRawishReport,
} from "@/lib/data";
import type { DailyReport } from "@/lib/data";

export const dynamic = "force-dynamic";

type DailyPageProps = {
  params: Promise<{
    date: string;
  }>;
};

const weekdays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

function formatDate(date: string) {
  const value = new Date(`${date}T00:00:00`);
  return `${value.getMonth() + 1}月${value.getDate()}日 · ${weekdays[value.getDay()]}`;
}

function StatIcon({ type }: { type: "messages" | "members" | "topics" | "groups" }) {
  if (type === "messages") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z" />
      </svg>
    );
  }

  if (type === "members") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    );
  }

  if (type === "groups") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="7" height="7" rx="1.5" />
        <rect x="14" y="4" width="7" height="7" rx="1.5" />
        <rect x="3" y="15" width="7" height="7" rx="1.5" />
        <rect x="14" y="15" width="7" height="7" rx="1.5" />
      </svg>
    );
  }

  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 5h16" />
      <path d="M4 12h16" />
      <path d="M4 19h16" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function IssueSwitcher({
  previousDate,
  currentDate,
  nextDate,
  prominent = false,
}: {
  previousDate: string | null;
  currentDate: string;
  nextDate: string | null;
  prominent?: boolean;
}) {
  const baseLink =
    "glass-card card-hover flex min-h-[72px] flex-col justify-center p-4 transition-all hover:-translate-y-0.5 hover:border-white/[0.16] hover:text-accent";
  const disabled =
    "glass-card flex min-h-[72px] flex-col justify-center p-4 text-foreground-disabled";

  return (
    <nav
      className={`grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] gap-3 ${
        prominent
          ? "sticky top-[4.75rem] z-30 mb-6 rounded-[22px] border border-white/[0.06] bg-background/88 p-2 backdrop-blur-[20px] shadow-2xl shadow-black/20"
          : "mt-6"
      }`}
      aria-label="切换期刊"
    >
      {previousDate ? (
        <Link
          href={`/daily/${previousDate}`}
          className={`${baseLink} text-left text-sm font-semibold text-foreground-muted md:text-base`}
        >
          <span>← 上一期</span>
          <span className="mono-num mt-1 text-xs font-medium md:text-sm">
            {formatDate(previousDate)}
          </span>
        </Link>
      ) : (
        <span className={`${disabled} text-left text-sm md:text-base`}>
          ← 上一期
        </span>
      )}

      <Link
        href="/daily"
        className="glass-card card-hover flex min-h-[72px] w-24 flex-col items-center justify-center p-3 text-center text-sm font-semibold text-foreground hover:border-white/[0.16] hover:text-accent md:w-36 md:text-base"
      >
        <span>本期</span>
        <span className="mono-num mt-1 text-xs text-foreground-muted md:text-sm">
          {formatDate(currentDate)}
        </span>
      </Link>

      {nextDate ? (
        <Link
          href={`/daily/${nextDate}`}
          className={`${baseLink} text-right text-sm font-semibold text-foreground-muted md:text-base`}
        >
          <span>下一期 →</span>
          <span className="mono-num mt-1 text-xs font-medium md:text-sm">
            {formatDate(nextDate)}
          </span>
        </Link>
      ) : (
        <span className={`${disabled} text-right text-sm md:text-base`}>
          下一期 →
        </span>
      )}
    </nav>
  );
}

export default async function DailyPage({ params }: DailyPageProps) {
  const { date } = await params;
  const allDates = getAllDates().sort((a, b) => a.localeCompare(b));
  let report: DailyReport;

  try {
    report = getDailyReport(date);
  } catch {
    notFound();
  }

  const images = getDigestImages(date);
  const readyImages = images.filter((image) => image.exists);
  const digestValue =
    images.length > 0 ? `${readyImages.length}/${images.length}` : "未纳入";
  const digestReadyLabel =
    images.length > 0 ? `${readyImages.length}/${images.length} 已就绪` : "未纳入";
  const reportNeedsRefine = isRawishReport(report);
  const dateIndex = allDates.indexOf(date);
  const previousDate = dateIndex > 0 ? allDates[dateIndex - 1] : null;
  const nextDate =
    dateIndex >= 0 && dateIndex < allDates.length - 1
      ? allDates[dateIndex + 1]
      : null;

  const stats = [
    {
      label: "群精华",
      value: digestValue,
      type: "groups" as const,
      tone: images.length > 0 ? "text-accent" : "text-foreground-disabled",
    },
    {
      label: "消息数",
      value: report.stats.total_messages,
      type: "messages" as const,
      tone: "text-success",
    },
    {
      label: "活跃人数",
      value: report.stats.active_members,
      type: "members" as const,
      tone: "text-purple",
    },
    {
      label: "弹药索引",
      value: report.topics.length,
      type: "topics" as const,
      tone: "text-pink",
    },
  ];

  return (
    <section className="relative mx-auto w-full max-w-6xl overflow-hidden">
      <div className="pointer-events-none absolute -left-28 top-6 h-72 w-72 rounded-full bg-[radial-gradient(circle,rgba(240,185,11,0.16)_0%,rgba(240,185,11,0)_68%)] blur-2xl" />
      <div className="pointer-events-none absolute right-0 top-32 h-72 w-72 rounded-full bg-[radial-gradient(circle,rgba(2,192,118,0.10)_0%,rgba(2,192,118,0)_70%)] blur-2xl" />

      <div className="relative mb-4">
        <Link
          href="/daily"
          className="glass card-hover inline-flex items-center rounded-full px-4 py-2 text-sm font-semibold text-foreground-muted hover:border-white/[0.14] hover:text-accent md:text-base"
        >
          ← 返回期刊归档
        </Link>
      </div>

      <IssueSwitcher
        previousDate={previousDate}
        currentDate={date}
        nextDate={nextDate}
        prominent
      />

      <header className="relative mb-6">
        <p className="text-xs font-bold tracking-[0.24em] text-accent">
          本期精华
        </p>
        <time className="mono-num mt-3 block text-sm font-medium text-foreground-muted">
          更新至 {formatDate(report.date)}
        </time>
        <h1 className="mt-2 text-2xl font-bold leading-9 text-foreground md:text-4xl md:leading-[1.25]">
          {report.title}
        </h1>
        <p className="mt-3 max-w-3xl text-sm leading-7 text-foreground-muted">
          这里先展示各群当天已沉淀的精华长图，后面是从本期讨论中抽出的工具、观点、教程和案例索引。
        </p>
      </header>

      <div className="glass-card relative mb-6 grid overflow-hidden sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((item) => (
          <div
            key={item.label}
            className="border-b border-white/[0.06] px-4 py-4 last:border-b-0 sm:border-r sm:even:border-r-0 lg:border-b-0 lg:even:border-r lg:last:border-r-0 md:flex md:items-center md:gap-3 md:px-5"
          >
            <div className={`mb-2 ${item.tone} md:mb-0`}>
              <StatIcon type={item.type} />
            </div>
            <div>
              <p className="text-xs text-foreground-muted">{item.label}</p>
              <p className={`mono-num mt-1 text-lg font-bold ${item.tone}`}>
                {item.value}
              </p>
            </div>
          </div>
        ))}
      </div>

      <section className="relative mb-8">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold text-foreground">多群精华长图</h2>
            <p className="mt-1 text-sm text-foreground-muted">
              当前按当期已归档社群展示；未纳入运营归档的群不参与统计。
            </p>
          </div>
          <span className="mono-num text-sm text-foreground-muted">
            {digestReadyLabel}
          </span>
        </div>

        {images.length > 0 ? (
          <div className="grid gap-4 md:grid-cols-2">
            {images.map((img) => (
              <div
                key={img.key}
                id={`digest-${img.key}`}
                className={`glass-card card-hover scroll-mt-24 overflow-hidden hover:border-white/[0.14] ${
                  img.exists ? "" : "border-danger/20 bg-danger/[0.04]"
                }`}
              >
                <div className="flex items-center justify-between gap-3 border-b border-white/[0.06] px-4 py-3">
                  <span className="text-sm font-semibold text-accent">
                    {img.name}
                  </span>
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                      img.exists
                        ? "bg-success/10 text-success"
                        : "bg-danger/10 text-danger"
                    }`}
                  >
                    {img.exists ? "已生成" : "缺失"}
                  </span>
                </div>

                {img.exists ? (
                  <a href={img.src} target="_blank" rel="noopener noreferrer">
                    <div className="max-h-[760px] overflow-hidden bg-background">
                      <Image
                        src={img.src}
                        alt={`${img.name} ${formatDate(date)} 群精华`}
                        width={1290}
                        height={18000}
                        unoptimized
                        className="w-full"
                      />
                    </div>
                  </a>
                ) : (
                  <div className="flex min-h-[260px] items-center justify-center px-6 text-center text-sm leading-7 text-foreground-muted">
                    这一群的精华图片还没有进入网站素材目录。补齐后会自动出现在本期。
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="glass-card px-6 py-10 text-center text-sm leading-7 text-foreground-muted">
            这一期早于群精华运营归档体系纳入时间，暂不参与统计。
          </div>
        )}
      </section>

      <section className="relative">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold text-foreground">本期弹药索引</h2>
            <p className="mt-1 text-sm text-foreground-muted">
              用来快速定位本期出现的观点、工具、教程、案例和风险提醒。
            </p>
          </div>
          {reportNeedsRefine ? (
            <span className="rounded-full border border-accent/20 bg-accent/[0.08] px-3 py-1.5 text-xs font-semibold text-accent">
              部分内容待编辑精修
            </span>
          ) : null}
        </div>

        <div className="space-y-4">
          {report.topics.map((topic) => (
            <article
              key={topic.title}
              className="glass-card card-hover relative p-4 hover:border-white/[0.14] md:p-5"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <h3 className="border-l-2 border-accent pl-4 text-lg font-bold leading-8 text-foreground">
                  {topic.title}
                </h3>
                <div className="flex flex-wrap gap-2">
                  {topic.tags.slice(0, 4).map((tag) => (
                    <TagBadge key={tag}>{tag}</TagBadge>
                  ))}
                </div>
              </div>

              {topic.key_insights.length > 0 ? (
                <section className="mt-4 rounded-[14px] border border-accent/10 bg-accent/[0.04] p-4">
                  <h4 className="text-sm font-bold text-accent">核心观点</h4>
                  <div className="mt-3 space-y-2">
                    {topic.key_insights.slice(0, 3).map((insight) => (
                      <p
                        key={insight}
                        className="flex gap-3 text-sm leading-6 text-foreground-muted"
                      >
                        <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-accent" />
                        <span>{insight}</span>
                      </p>
                    ))}
                  </div>
                </section>
              ) : null}

              <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
                <div className="space-y-4">
                  {topic.action_items.length > 0 ? (
                    <section className="rounded-[14px] border border-success/10 bg-success/[0.04] p-4">
                      <h4 className="text-sm font-bold text-success">可执行建议</h4>
                      <div className="mt-3 space-y-2">
                        {topic.action_items.slice(0, 3).map((item) => (
                          <p
                            key={item}
                            className="flex gap-3 text-sm leading-6 text-foreground-muted"
                          >
                            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-success/10 text-success">
                              <CheckIcon />
                            </span>
                            <span>{item}</span>
                          </p>
                        ))}
                      </div>
                    </section>
                  ) : null}

                  <details className="rounded-[14px] border border-white/[0.06] bg-white/[0.02] p-4">
                    <summary className="cursor-pointer text-sm font-semibold text-foreground-muted transition-colors hover:text-accent">
                      展开知识正文
                    </summary>
                    <div className="mt-4 border-t border-white/[0.06] pt-4">
                      <MarkdownContent content={topic.content} />
                    </div>
                  </details>
                </div>

                <aside className="space-y-4">
                  {topic.tools_mentioned.length > 0 ? (
                    <section>
                      <h4 className="text-sm font-bold text-foreground">提到的工具</h4>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {topic.tools_mentioned.slice(0, 8).map((tool) => (
                          <span
                            key={tool}
                            className="rounded-full border border-purple/20 bg-purple/10 px-3 py-1.5 text-xs font-semibold text-purple"
                          >
                            {tool}
                          </span>
                        ))}
                      </div>
                    </section>
                  ) : null}

                  <ContributorList contributors={topic.contributors.slice(0, 8)} />
                </aside>
              </div>
            </article>
          ))}
        </div>
      </section>

      <IssueSwitcher
        previousDate={previousDate}
        currentDate={date}
        nextDate={nextDate}
      />
    </section>
  );
}
