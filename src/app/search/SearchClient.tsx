"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { TagBadge } from "@/components/TagBadge";
import type { SearchIndexItem } from "@/lib/data";

type SearchClientProps = {
  searchIndex: SearchIndexItem[];
};

type SearchResult = {
  item: SearchIndexItem;
  score: number;
};

const MAX_RESULTS = 50;

function normalize(value: string) {
  return value.trim().toLowerCase();
}

function getTerms(query: string) {
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  return [...new Set(terms)];
}

function countMatches(value: string, term: string) {
  if (!term) return 0;

  let count = 0;
  let position = value.indexOf(term);
  while (position !== -1) {
    count += 1;
    position = value.indexOf(term, position + term.length);
  }
  return count;
}

function scoreItem(item: SearchIndexItem, terms: string[]) {
  const title = item.title.toLowerCase();
  const content = item.content.toLowerCase();
  const tags = item.tags.join(" ").toLowerCase();
  const tools = item.tools.join(" ").toLowerCase();
  const insights = item.insights.join(" ").toLowerCase();
  let score = 0;

  for (const term of terms) {
    score += countMatches(title, term) * 80;
    score += countMatches(tags, term) * 50;
    score += countMatches(tools, term) * 35;
    score += countMatches(insights, term) * 20;
    score += countMatches(content, term) * 10;
  }

  return score;
}

function formatDate(date: string) {
  const value = new Date(`${date}T00:00:00`);
  return `${value.getFullYear()}年${value.getMonth() + 1}月${value.getDate()}日`;
}

function HighlightText({ text, terms }: { text: string; terms: string[] }) {
  if (terms.length === 0 || text.length === 0) {
    return <>{text}</>;
  }

  const pattern = new RegExp(
    `(${terms.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`,
    "gi",
  );
  const parts = text.split(pattern);

  return (
    <>
      {parts.map((part, index) => {
        const isMatch = terms.some((term) => part.toLowerCase() === term);

        if (!isMatch) {
          return <span key={`${part}-${index}`}>{part}</span>;
        }

        return (
          <mark
            key={`${part}-${index}`}
            className="rounded bg-accent/20 px-0.5 text-accent"
          >
            {part}
          </mark>
        );
      })}
    </>
  );
}

function SearchIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m21 21-4.35-4.35" />
      <circle cx="11" cy="11" r="7" />
    </svg>
  );
}

export function SearchClient({ searchIndex }: SearchClientProps) {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedQuery(query);
    }, 300);

    return () => window.clearTimeout(timer);
  }, [query]);

  const terms = useMemo(() => getTerms(debouncedQuery), [debouncedQuery]);

  const results = useMemo<SearchResult[]>(() => {
    if (terms.length === 0) return [];

    return searchIndex
      .map((item) => ({
        item,
        score: scoreItem(item, terms),
      }))
      .filter((result) => result.score > 0)
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return b.item.date.localeCompare(a.item.date);
      })
      .slice(0, MAX_RESULTS);
  }, [searchIndex, terms]);

  const hasQuery = normalize(debouncedQuery).length > 0;

  return (
    <>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground md:text-3xl">
            搜索弹药
          </h1>
          <p className="mt-2 text-sm text-foreground-muted">
            搜索全部期刊的话题、工具、标签和核心观点
          </p>
        </div>
        <span className="mono-num text-sm text-foreground-muted">
          {searchIndex.length} 个话题
        </span>
      </div>

      <div className="glass-card mb-5 p-4 md:p-6">
        <label className="flex items-center gap-3">
          <SearchIcon className="h-5 w-5 shrink-0 text-accent" />
          <span className="sr-only">搜索关键词</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索工具、教程、案例、观点..."
            className="min-w-0 flex-1 bg-transparent text-base text-foreground outline-none placeholder:text-foreground-disabled md:text-lg"
          />
        </label>
      </div>

      <div className="mb-4 flex items-center justify-between gap-4 text-sm">
        <p className="text-foreground-muted">
          {hasQuery ? (
            <>
              找到{" "}
              <span className="mono-num font-semibold text-accent">
                {results.length}
              </span>{" "}
              条结果
            </>
          ) : (
            "输入关键词开始搜索"
          )}
        </p>
        {hasQuery && results.length === MAX_RESULTS ? (
          <span className="text-foreground-muted">最多显示前 50 条</span>
        ) : null}
      </div>

      {hasQuery && results.length === 0 ? (
        <div className="glass-card px-5 py-12 text-center">
          <SearchIcon className="mx-auto mb-4 h-12 w-12 text-foreground-disabled" />
          <p className="text-foreground-muted">没有找到匹配内容</p>
        </div>
      ) : null}

      <div className="space-y-3">
        {results.map(({ item }) => (
          <Link
            key={item.id}
            href={`/daily/${item.date}`}
            className="glass-card card-hover block p-4 hover:border-white/[0.14] md:p-5"
          >
            <div className="flex flex-wrap items-center gap-3">
              <time className="mono-num text-xs font-medium text-accent">
                {formatDate(item.date)}
              </time>
              <span className="text-xs text-foreground-muted">
                {item.reportTitle}
              </span>
            </div>
            <h2 className="mt-2 text-base font-bold leading-7 text-foreground md:text-lg">
              <HighlightText text={item.title} terms={terms} />
            </h2>
            <p className="mt-3 line-clamp-3 text-sm leading-7 text-foreground-muted">
              <HighlightText text={item.content} terms={terms} />
            </p>
            {item.tags.length > 0 ? (
              <div className="mt-4 flex flex-wrap gap-2">
                {item.tags.map((tag) => (
                  <TagBadge key={tag}>{tag}</TagBadge>
                ))}
              </div>
            ) : null}
          </Link>
        ))}
      </div>
    </>
  );
}
