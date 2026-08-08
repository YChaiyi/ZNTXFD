"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { KnowledgeCard } from "@/components/KnowledgeCard";
import { RatingBadge } from "@/components/RatingBadge";
import { TagBadge } from "@/components/TagBadge";

type DirectoryItem = {
  slug: string;
  title: string;
  claim: string;
  summary: string;
  category: string;
  rating?: string;
  tags: string[];
  tools: string[];
  contributors: string[];
  sourceCount: number;
  evidenceCount: number;
  citationCount: number;
  sourceDate: string;
  updatedAt: string;
};

type Hub = {
  key: string;
  title: string;
  subtitle: string;
  count: number;
  latestDate: string;
  accent: string;
  matchTerms: string[];
};

type Stat = {
  label: string;
  value: string;
  tone: string;
};

type KnowledgeDirectoryClientProps = {
  items: DirectoryItem[];
  hubs: Hub[];
  stats: Stat[];
  categories: { name: string; count: number }[];
  tools: { name: string; count: number }[];
};

const ALL = "全部";
const RECENT_LIMIT = 18;
const FEATURE_LIMIT = 3;

function normalize(value: string) {
  return value.trim().toLowerCase();
}

function matchesQuery(item: DirectoryItem, query: string) {
  const q = normalize(query);
  if (!q) return true;
  const text = [
    item.title,
    item.claim,
    item.category,
    item.rating ?? "",
    ...item.tags,
    ...item.tools,
    ...item.contributors,
  ]
    .join(" ")
    .toLowerCase();
  return text.includes(q);
}

function formatDate(date: string) {
  if (!date) return "未标注";
  const parts = date.split("-");
  if (parts.length !== 3) return date;
  return `${Number(parts[1])}月${Number(parts[2])}日`;
}

function HubButton({
  hub,
  active,
  onClick,
}: {
  hub: Hub;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group min-h-[172px] rounded-[14px] border p-4 text-left transition-all hover:-translate-y-0.5 ${
        active
          ? "border-accent/70 bg-accent/[0.08] shadow-[0_20px_50px_-34px_rgba(255,143,42,0.7)]"
          : "border-white/[0.07] bg-[#141419] hover:border-white/[0.14]"
      }`}
    >
      <div className="mb-5 flex items-center justify-between gap-3">
        <span className={`h-2.5 w-2.5 rounded-full ${hub.accent}`} />
        <span className="mono-num rounded-md border border-white/[0.08] bg-white/[0.035] px-2 py-1 text-xs font-bold text-foreground-muted">
          {hub.count}
        </span>
      </div>
      <h3 className="text-lg font-black leading-7 text-foreground group-hover:text-accent-light">
        {hub.title}
      </h3>
      <p className="mt-2 line-clamp-2 text-sm leading-6 text-foreground-muted">
        {hub.subtitle}
      </p>
      <div className="mt-5 border-t border-white/[0.06] pt-4 text-xs text-foreground-muted">
        查看 <b className="mono-num text-accent">{hub.count}</b> 条 · 更新{" "}
        <b className="mono-num text-foreground">{formatDate(hub.latestDate)}</b>
      </div>
    </button>
  );
}

function itemMatchesHub(item: DirectoryItem, hub: Hub) {
  if (hub.key === "高价值") return true;
  const text = [
    item.title,
    item.claim,
    item.category,
    item.rating ?? "",
    ...item.tags,
    ...item.tools,
  ].join(" ");
  return hub.matchTerms.some((term) => text.includes(term));
}

function FeaturedQuestion({ item, index }: { item: DirectoryItem; index: number }) {
  return (
    <Link
      href={`/knowledge/${item.slug}`}
      className="group rounded-[14px] border border-white/[0.07] bg-[#141419] p-4 transition-all hover:-translate-y-0.5 hover:border-accent/45"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="mono-num text-xs font-black text-accent">0{index + 1}</span>
        <RatingBadge rating={item.rating} />
      </div>
      <h3 className="mt-4 line-clamp-2 text-base font-black leading-6 text-foreground group-hover:text-accent-light">
        {item.title}
      </h3>
      <p className="mt-2 line-clamp-2 text-sm leading-6 text-foreground-muted">
        {item.claim}
      </p>
    </Link>
  );
}

function HubDetail({
  hub,
  items,
}: {
  hub: Hub;
  items: DirectoryItem[];
}) {
  const leading = items.slice(0, 4);
  const questionSeeds = items.slice(0, 3);

  return (
    <div className="mt-4 rounded-[14px] border border-accent/20 bg-[linear-gradient(135deg,rgba(255,143,42,0.08),rgba(18,18,23,0.86)_42%,rgba(2,192,118,0.045))] p-4 md:p-5">
      <div className="grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
        <div>
          <div className="flex items-center gap-3">
            <span className={`h-3 w-3 rounded-full ${hub.accent}`} />
            <h3 className="text-xl font-black text-foreground">{hub.title}</h3>
          </div>
          <p className="mt-3 text-sm leading-6 text-foreground-muted">{hub.subtitle}</p>
          <div className="mt-5 grid grid-cols-2 gap-2">
            <div className="rounded-[10px] border border-white/[0.07] bg-[#09090b]/55 p-3">
              <p className="mono-num text-2xl font-black text-accent">{items.length}</p>
              <p className="mt-1 text-xs text-foreground-muted">条目</p>
            </div>
            <div className="rounded-[10px] border border-white/[0.07] bg-[#09090b]/55 p-3">
              <p className="mono-num text-2xl font-black text-success">
                {items.reduce((sum, item) => sum + item.sourceCount, 0)}
              </p>
              <p className="mt-1 text-xs text-foreground-muted">来源</p>
            </div>
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div>
            <h4 className="mb-3 text-sm font-black tracking-[0.16em] text-accent">
              专题条目
            </h4>
            <div className="grid gap-3 md:grid-cols-2">
              {leading.map((item) => (
                <Link
                  key={item.slug}
                  href={`/knowledge/${item.slug}`}
                  className="rounded-[12px] border border-white/[0.07] bg-[#111116]/85 p-3 transition-colors hover:border-accent/45"
                >
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    {item.tools.slice(0, 2).map((tool) => (
                      <TagBadge key={tool}>{tool}</TagBadge>
                    ))}
                  </div>
                  <p className="line-clamp-2 text-sm font-black leading-6 text-foreground">
                    {item.title}
                  </p>
                  <p className="mt-2 line-clamp-2 text-xs leading-5 text-foreground-muted">
                    {item.claim}
                  </p>
                </Link>
              ))}
            </div>
          </div>

          <div>
            <h4 className="mb-3 text-sm font-black tracking-[0.16em] text-success">
              问题线索
            </h4>
            <div className="space-y-2">
              {questionSeeds.map((item) => (
                <Link
                  key={item.slug}
                  href={`/knowledge/${item.slug}`}
                  className="block rounded-[10px] border border-white/[0.06] bg-[#09090b]/55 px-3 py-2 text-sm font-semibold leading-6 text-foreground-muted hover:border-white/[0.14] hover:text-foreground"
                >
                  {item.title}
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function KnowledgeRow({ item }: { item: DirectoryItem }) {
  return <KnowledgeCard item={item} />;
}

export function KnowledgeDirectoryClient({
  items,
  hubs,
  stats,
  categories,
  tools,
}: KnowledgeDirectoryClientProps) {
  const [query, setQuery] = useState("");
  const [hubKey, setHubKey] = useState(hubs[0]?.key ?? ALL);
  const [category, setCategory] = useState(ALL);
  const detailRef = useRef<HTMLDivElement | null>(null);

  const featuredItems = items.slice(0, FEATURE_LIMIT);
  const selectedHub = hubKey === ALL ? undefined : hubs.find((hub) => hub.key === hubKey);
  const selectedHubItems = selectedHub
    ? items.filter((item) => itemMatchesHub(item, selectedHub))
    : [];

  const filtered = useMemo(() => {
    return items.filter((item) => {
      const byQuery = matchesQuery(item, query);
      const byCategory = category === ALL || item.category === category;
      const byHub =
        hubKey === ALL ||
        hubs
          .filter((hub) => hub.key === hubKey)
          .some((hub) => itemMatchesHub(item, hub)) ||
        item.tools.includes(hubKey) ||
        item.tags.some((tag) => tag.includes(hubKey)) ||
        item.title.includes(hubKey) ||
        item.claim.includes(hubKey);

      return byQuery && byCategory && byHub;
    });
  }, [category, hubKey, hubs, items, query]);

  const recent = filtered.slice(0, RECENT_LIMIT);

  function selectHub(key: string) {
    setHubKey(key);
    if (key !== ALL && hubs.some((hub) => hub.key === key)) {
      window.requestAnimationFrame(() => {
        detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
  }

  return (
    <section className="relative mx-auto w-full max-w-7xl overflow-hidden pb-8">
      <header className="relative border-b border-white/[0.07] pb-6">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_420px]">
          <div>
            <p className="text-xs font-black tracking-[0.24em] text-accent">
              TRUSTED KNOWLEDGE
            </p>
            <h1 className="mt-4 max-w-4xl text-3xl font-black leading-tight text-foreground md:text-5xl">
              智能体先锋队知识库
            </h1>
            <div className="mt-8 grid gap-3 md:grid-cols-3">
              {featuredItems.map((item, index) => (
                <FeaturedQuestion key={item.slug} item={item} index={index} />
              ))}
            </div>
          </div>

          <div className="rounded-[14px] border border-white/[0.07] bg-[#121217] p-4">
            <label className="flex min-h-12 items-center gap-3 rounded-[10px] border border-white/[0.08] bg-[#09090b] px-4 transition-colors focus-within:border-accent/60">
              <span className="text-lg text-accent">⌕</span>
              <span className="sr-only">搜索知识库</span>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Codex / Claude / 风控 / 视频 / 电商"
                className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-foreground outline-none placeholder:text-foreground-disabled"
              />
            </label>
            <div className="mt-4 grid grid-cols-2 gap-2">
              {stats.map((stat) => (
                <div key={stat.label} className="rounded-[10px] border border-white/[0.06] bg-white/[0.025] p-3">
                  <p className={`mono-num text-xl font-black ${stat.tone}`}>
                    {stat.value}
                  </p>
                  <p className="mt-1 text-xs text-foreground-muted">{stat.label}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </header>

      <section className="border-b border-white/[0.07] py-6">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <h2 className="text-xl font-black text-foreground">专题入口</h2>
          <button
            type="button"
            onClick={() => selectHub(ALL)}
            className={`rounded-lg border px-3 py-2 text-sm font-bold transition-colors ${
              hubKey === ALL
                ? "border-accent/50 bg-accent/[0.10] text-accent"
                : "border-white/[0.08] bg-white/[0.03] text-foreground-muted hover:text-foreground"
            }`}
          >
            全部专题
          </button>
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {hubs.map((hub) => (
            <HubButton
              key={hub.key}
              hub={hub}
              active={hubKey === hub.key}
              onClick={() => selectHub(hub.key)}
            />
          ))}
        </div>

        {selectedHub && selectedHubItems.length > 0 ? (
          <div ref={detailRef}>
            <HubDetail hub={selectedHub} items={selectedHubItems} />
          </div>
        ) : null}
      </section>

      <section className="grid gap-6 py-6 xl:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="space-y-5 xl:sticky xl:top-24 xl:self-start">
          <div>
            <h2 className="text-base font-black text-foreground">分类</h2>
            <div className="mt-3 space-y-2">
              {[{ name: ALL, count: items.length }, ...categories].map((entry) => (
                <button
                  key={entry.name}
                  type="button"
                  onClick={() => setCategory(entry.name)}
                  className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                    category === entry.name
                      ? "border-accent/50 bg-accent/[0.10] text-accent"
                      : "border-white/[0.07] bg-[#141419] text-foreground-muted hover:border-white/[0.14] hover:text-foreground"
                  }`}
                >
                  <span className="font-semibold">{entry.name}</span>
                  <span className="mono-num text-xs">{entry.count}</span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <h2 className="text-base font-black text-foreground">高频工具</h2>
            <div className="mt-3 flex flex-wrap gap-2">
              {tools.slice(0, 12).map((tool) => (
                <button
                  key={tool.name}
                  type="button"
                  onClick={() => selectHub(tool.name)}
                  className={`rounded-md border px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                    hubKey === tool.name
                      ? "border-accent/50 bg-accent/[0.10] text-accent"
                      : "border-white/[0.07] bg-[#141419] text-foreground-muted hover:text-foreground"
                  }`}
                >
                  {tool.name} <span className="mono-num">{tool.count}</span>
                </button>
              ))}
            </div>
          </div>
        </aside>

        <div className="min-w-0">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-xl font-black text-foreground">最近更新</h2>
              <p className="mt-1 text-sm text-foreground-muted">
                {recent.length}/{filtered.length} 条
              </p>
            </div>
            <Link
              href="/daily"
              className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-sm font-bold text-foreground-muted hover:border-white/[0.16] hover:text-foreground"
            >
              期刊归档
            </Link>
          </div>

          <div className="space-y-3">
            {recent.map((item) => (
              <KnowledgeRow key={item.slug} item={item} />
            ))}
          </div>
        </div>
      </section>
    </section>
  );
}
