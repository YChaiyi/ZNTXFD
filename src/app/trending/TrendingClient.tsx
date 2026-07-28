"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { DailyIndexItem } from "@/lib/data";

type TagSummary = {
  tag: string;
  count: number;
  reports: DailyIndexItem[];
};

type TrendingClientProps = {
  tagSummaries: TagSummary[];
};

function formatDate(date: string) {
  const value = new Date(`${date}T00:00:00`);
  return `${value.getFullYear()}年${value.getMonth() + 1}月${value.getDate()}日`;
}

export function TrendingClient({ tagSummaries }: TrendingClientProps) {
  const [selectedTag, setSelectedTag] = useState(tagSummaries[0]?.tag ?? "");
  const selected = useMemo(
    () =>
      tagSummaries.find((item) => item.tag === selectedTag) ??
      tagSummaries[0] ??
      null,
    [selectedTag, tagSummaries],
  );

  if (tagSummaries.length === 0) {
    return (
      <div className="glass-card px-5 py-12 text-center text-sm text-foreground-muted">
        暂无热门话题
      </div>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
      <aside className="glass-card p-4">
        <div className="mb-4 flex items-center justify-between gap-4">
          <h2 className="text-sm font-bold text-foreground">标签脉络</h2>
          <span className="mono-num text-xs text-foreground-muted">
            {tagSummaries.length}
          </span>
        </div>
        <div className="flex max-h-[620px] flex-wrap gap-2 overflow-auto pr-1 lg:block lg:space-y-2">
          {tagSummaries.map((item) => {
            const isActive = item.tag === selected?.tag;

            return (
              <button
                key={item.tag}
                type="button"
                onClick={() => setSelectedTag(item.tag)}
                className={`glass mono-num inline-flex items-center justify-between rounded-[20px] px-3 py-2 text-left text-sm transition-colors lg:flex lg:w-full ${
                  isActive
                    ? "border-accent/60 bg-accent/10 text-accent"
                    : "text-foreground-muted hover:border-accent/30 hover:text-foreground"
                }`}
              >
                <span>{item.tag}</span>
                <span className="ml-3 text-xs">{item.count}</span>
              </button>
            );
          })}
        </div>
      </aside>

      <section className="glass-card p-4 md:p-5">
        {selected ? (
          <>
            <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="text-sm text-foreground-muted">当前话题</p>
                <h2 className="mt-1 text-xl font-bold text-accent">
                  {selected.tag}
                </h2>
              </div>
              <span className="mono-num text-sm text-foreground-muted">
                {selected.count} 期期刊
              </span>
            </div>
            <div className="space-y-3">
              {selected.reports.map((report) => (
                <Link
                  key={`${selected.tag}-${report.date}`}
                  href={`/daily/${report.date}`}
                  className="card-hover block rounded-xl border border-border/80 bg-background-card/40 p-4"
                >
                  <time className="mono-num text-xs font-medium text-accent">
                    {formatDate(report.date)}
                  </time>
                  <h3 className="mt-2 text-base font-bold leading-7 text-foreground">
                    {report.title}
                  </h3>
                </Link>
              ))}
            </div>
          </>
        ) : null}
      </section>
    </div>
  );
}
