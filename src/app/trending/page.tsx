import { TrendingClient } from "./TrendingClient";
import { getDailyIndex } from "@/lib/data";
import type { DailyIndexItem } from "@/lib/data";

export const dynamic = "force-dynamic";

type TagSummary = {
  tag: string;
  count: number;
  reports: DailyIndexItem[];
};

function getTagSummaries(reports: DailyIndexItem[]): TagSummary[] {
  const tagMap = new Map<string, DailyIndexItem[]>();

  reports.forEach((report) => {
    report.tags.forEach((tag) => {
      const existing = tagMap.get(tag) ?? [];
      tagMap.set(tag, [...existing, report]);
    });
  });

  return [...tagMap.entries()]
    .map(([tag, taggedReports]) => ({
      tag,
      count: taggedReports.length,
      reports: taggedReports.sort((a, b) => b.date.localeCompare(a.date)),
    }))
    .sort(
      (a, b) =>
        b.count - a.count || a.tag.localeCompare(b.tag, "zh-CN"),
    );
}

export default function TrendingPage() {
  const reports = getDailyIndex().sort((a, b) => b.date.localeCompare(a.date));
  const tagSummaries = getTagSummaries(reports);

  return (
    <section className="relative mx-auto w-full max-w-7xl overflow-hidden">
      <div className="pointer-events-none absolute -left-24 top-4 h-72 w-72 rounded-full bg-[radial-gradient(circle,rgba(240,185,11,0.18)_0%,rgba(240,185,11,0)_68%)] blur-2xl" />
      <div className="pointer-events-none absolute right-0 top-48 h-80 w-80 rounded-full bg-[radial-gradient(circle,rgba(255,100,130,0.12)_0%,rgba(255,100,130,0)_70%)] blur-2xl" />

      <div className="relative mb-6">
        <h1 className="text-2xl font-bold text-foreground">话题脉络</h1>
        <p className="mt-2 text-sm text-foreground-muted">
          从全部期刊标签聚合出现频率，并关联回原始期刊
        </p>
      </div>

      <div className="relative">
        <TrendingClient tagSummaries={tagSummaries} />
      </div>
    </section>
  );
}
