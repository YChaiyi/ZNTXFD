import Link from "next/link";
import { TagBadge } from "@/components/TagBadge";
import { getDailyIndex, getDigestStatus } from "@/lib/data";

export const dynamic = "force-dynamic";

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

function formatDate(date: string) {
  const d = new Date(`${date}T00:00:00`);
  return `${d.getMonth() + 1}月${d.getDate()}日 · 周${WEEKDAYS[d.getDay()]}`;
}

export default function DailyListPage() {
  const cards = getDailyIndex().sort((a, b) => b.date.localeCompare(a.date));

  return (
    <section className="relative mx-auto w-full max-w-6xl">
      <div className="pointer-events-none absolute -left-24 top-4 h-72 w-72 rounded-full bg-[radial-gradient(circle,rgba(240,185,11,0.16)_0%,rgba(240,185,11,0)_68%)] blur-2xl" />

      <div className="relative mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-bold tracking-[0.24em] text-accent">
            ARCHIVE
          </p>
          <h1 className="mt-2 text-2xl font-bold text-foreground md:text-3xl">
            期刊归档
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-foreground-muted">
            每一期对应一次已沉淀的社群切片：先看多群精华，再进入本期提炼出的工具、观点、教程和案例。
          </p>
        </div>
        <span className="mono-num text-sm text-foreground-muted">
          共 {cards.length} 期
        </span>
      </div>

      {cards.length === 0 ? (
        <div className="glass-card px-5 py-12 text-center text-sm text-foreground-muted">
          暂无期刊
        </div>
      ) : (
        <div className="relative grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {cards.map((card) => {
            const status = getDigestStatus(card.date);
            const digestLabel = status.available
              ? `${status.readyCount}/${status.totalCount} 群已归档`
              : "未纳入";
            return (
              <article
                key={card.date}
                data-archive-card
                className="glass-card card-hover group relative flex min-h-[210px] flex-col p-5 hover:border-white/[0.14]"
              >
                <div className="mb-3 flex items-center justify-between gap-3">
                  <time className="mono-num text-xs text-foreground-muted">
                    {formatDate(card.date)}
                  </time>
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                      !status.available
                        ? "bg-white/[0.05] text-foreground-muted"
                        : status.complete
                        ? "bg-success/10 text-success"
                        : "bg-accent/10 text-accent"
                    }`}
                  >
                    群精华 {digestLabel}
                  </span>
                </div>

                <h2 className="line-clamp-2 text-base font-bold leading-7">
                  <Link
                    href={`/daily/${card.date}`}
                    aria-label={`${card.title}（${formatDate(card.date)}）`}
                    className="text-foreground transition-colors after:absolute after:inset-0 after:content-[''] group-hover:text-accent"
                  >
                    {card.title}
                  </Link>
                </h2>

                <div className="mt-4 flex flex-wrap gap-2">
                  {card.tags.slice(0, 4).map((tag) => (
                    <TagBadge key={tag}>{tag}</TagBadge>
                  ))}
                </div>

                <div className="mt-auto grid grid-cols-3 gap-2 border-t border-white/[0.06] pt-4 text-xs">
                  <span>
                    <span className="mono-num block font-semibold text-accent">
                      {card.total_messages}
                    </span>
                    <span className="text-foreground-muted">消息</span>
                  </span>
                  <span>
                    <span className="mono-num block font-semibold text-accent">
                      {card.topic_count}
                    </span>
                    <span className="text-foreground-muted">话题</span>
                  </span>
                  <span>
                    <span className="mono-num block font-semibold text-accent">
                      {card.active_members}
                    </span>
                    <span className="text-foreground-muted">成员</span>
                  </span>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
