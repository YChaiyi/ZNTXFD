import Link from "next/link";
import { notFound } from "next/navigation";
import { TagBadge } from "@/components/TagBadge";
import {
  getTrustedKnowledgeItem,
} from "@/lib/data";
import type { TrustStatus } from "@/lib/data";

export const dynamic = "force-dynamic";

type KnowledgeDetailPageProps = {
  params: Promise<{
    slug: string;
  }>;
};

const statusText: Record<TrustStatus, string> = {
  unverified: "待验证",
  has_evidence: "有证据",
  verified: "已验证",
  ai_reviewed: "AI 初审",
  needs_repro: "有争议",
  reproducing: "待验证",
};

const statusTone: Record<TrustStatus, string> = {
  unverified: "text-accent",
  has_evidence: "text-success",
  verified: "text-success",
  ai_reviewed: "text-accent",
  needs_repro: "text-danger",
  reproducing: "text-purple",
};

function TrustCard({
  label,
  value,
  tone = "text-foreground",
}: {
  label: string;
  value: string | number;
  tone?: string;
}) {
  return (
    <div className="border-b border-white/[0.06] px-4 py-4 last:border-b-0 md:px-5">
      <p className="text-xs text-foreground-muted">{label}</p>
      <p className={`mono-num mt-2 text-xl font-bold ${tone}`}>{value}</p>
    </div>
  );
}

export default async function KnowledgeDetailPage({ params }: KnowledgeDetailPageProps) {
  const { slug } = await params;
  const item = getTrustedKnowledgeItem(slug);

  if (!item) {
    notFound();
  }

  return (
    <section className="relative mx-auto w-full max-w-6xl overflow-hidden">
      <div className="pointer-events-none absolute -left-28 top-4 h-72 w-72 rounded-full bg-[radial-gradient(circle,rgba(240,185,11,0.18)_0%,rgba(240,185,11,0)_68%)] blur-2xl" />
      <div className="pointer-events-none absolute right-0 top-44 h-80 w-80 rounded-full bg-[radial-gradient(circle,rgba(2,192,118,0.12)_0%,rgba(2,192,118,0)_70%)] blur-2xl" />

      <Link
        href="/knowledge"
        className="glass card-hover relative mb-5 inline-flex items-center rounded-full px-3 py-2 text-sm font-medium text-foreground-muted hover:border-white/[0.14] hover:text-accent"
      >
        ← 返回可信知识库
      </Link>

      <div className="relative grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <article className="space-y-5">
          <header className="glass-card glow-border p-5 md:p-7">
            <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
              <span className={statusTone[item.status]}>{statusText[item.status]}</span>
              <span className="text-foreground-disabled">·</span>
              <span className="text-foreground-muted">{item.category}</span>
              <span className="text-foreground-disabled">·</span>
              <time className="mono-num text-foreground-muted">更新 {item.updatedAt}</time>
            </div>
            <h1 className="mt-4 text-3xl font-bold leading-tight text-foreground md:text-5xl">
              {item.title}
            </h1>
            <p className="mt-5 rounded-[14px] border border-accent/10 bg-accent/[0.05] p-4 text-base font-semibold leading-8 text-foreground md:text-lg">
              {item.claim}
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              {item.tags.map((tag) => (
                <TagBadge key={tag}>{tag}</TagBadge>
              ))}
            </div>
          </header>

          <section className="glass-card card-hover p-5 hover:border-white/[0.14]">
            <h2 className="text-xl font-bold text-foreground">证据链</h2>
            <div className="mt-5 space-y-3">
              {item.evidences.map((evidence) => (
                <div
                  key={`${evidence.label}-${evidence.text}`}
                  className="rounded-[14px] border border-white/[0.06] bg-white/[0.025] p-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <span className="text-sm font-bold text-accent">
                      {evidence.label}
                      {evidence.sourceGroup ? ` · ${evidence.sourceGroup}` : ""}
                    </span>
                    <Link
                      href={evidence.sourceHref}
                      className="mono-num text-xs font-semibold text-foreground-muted hover:text-accent"
                    >
                      {evidence.sourceDate} · {evidence.sourceTitle}
                    </Link>
                  </div>
                  <p className="mt-3 text-sm leading-7 text-foreground-muted">
                    {evidence.text}
                  </p>
                </div>
              ))}
            </div>
          </section>

          <section className="glass-card card-hover p-5 hover:border-white/[0.14]">
            <h2 className="text-xl font-bold text-foreground">来源与证据</h2>
            <div className="mt-5 grid gap-3 md:grid-cols-3">
              <div className="rounded-[14px] border border-white/[0.06] bg-white/[0.025] p-4">
                <p className="text-xs text-foreground-muted">群聊来源</p>
                <p className="mono-num mt-2 text-2xl font-bold text-accent">
                  {item.sourceCount ?? item.evidenceCount}
                </p>
              </div>
              <div className="rounded-[14px] border border-white/[0.06] bg-white/[0.025] p-4">
                <p className="text-xs text-foreground-muted">贡献者</p>
                <p className="mono-num mt-2 text-2xl font-bold text-success">
                  {item.contributors.length}
                </p>
              </div>
              <div className="rounded-[14px] border border-white/[0.06] bg-white/[0.025] p-4">
                <p className="text-xs text-foreground-muted">评级</p>
                <p className="mono-num mt-2 text-2xl font-bold text-purple">
                  {item.rating ?? "A"}
                </p>
              </div>
            </div>
          </section>

          {item.applicability.length > 0 || item.risks.length > 0 ? (
            <section className="grid gap-4 md:grid-cols-2">
              {item.applicability.length > 0 ? (
                <div className="glass-card card-hover p-5 hover:border-white/[0.14]">
                  <h2 className="text-lg font-bold text-foreground">适用边界</h2>
                  <div className="mt-4 space-y-3">
                    {item.applicability.map((text) => (
                      <p key={text} className="flex gap-3 text-sm leading-6 text-foreground-muted">
                        <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-success" />
                        <span>{text}</span>
                      </p>
                    ))}
                  </div>
                </div>
              ) : null}
              {item.risks.length > 0 ? (
                <div className="glass-card card-hover p-5 hover:border-white/[0.14]">
                  <h2 className="text-lg font-bold text-foreground">风险提醒</h2>
                  <div className="mt-4 space-y-3">
                    {item.risks.map((text) => (
                      <p key={text} className="flex gap-3 text-sm leading-6 text-foreground-muted">
                        <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-danger" />
                        <span>{text}</span>
                      </p>
                    ))}
                  </div>
                </div>
              ) : null}
            </section>
          ) : null}
        </article>

        <aside className="space-y-4">
          <section className="glass-card overflow-hidden">
            <div className="flex items-center gap-4 border-b border-white/[0.06] p-5">
              <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full border border-accent/25 bg-accent/[0.06]">
                <span className="mono-num text-2xl font-bold text-accent">
                  {item.rating ?? "A"}
                </span>
              </div>
              <div>
                <h2 className="text-lg font-bold text-foreground">知识档案</h2>
                <p className="mt-1 text-sm text-foreground-muted">评级 · 来源 · 贡献者</p>
              </div>
            </div>
            <TrustCard label="证据" value={item.evidenceCount} tone="text-accent" />
            <TrustCard
              label="来源"
              value={item.sourceCount ?? item.evidenceCount}
              tone="text-success"
            />
            <TrustCard label="评级" value={item.rating ?? "A"} tone="text-purple" />
            <TrustCard label="状态" value={statusText[item.status]} tone={statusTone[item.status]} />
            <TrustCard label="引用" value={item.citationCount} tone="text-foreground" />
          </section>

          <section className="glass-card card-hover p-5 hover:border-white/[0.14]">
            <h2 className="text-lg font-bold text-foreground">来源</h2>
            <Link
              href={item.sourceHref}
              className="mt-4 block rounded-[14px] border border-white/[0.06] bg-white/[0.025] p-4 hover:border-white/[0.14]"
            >
              <time className="mono-num text-xs text-accent">{item.sourceDate}</time>
              <p className="mt-2 text-sm font-bold leading-6 text-foreground">
                {item.sourceTitle}
              </p>
            </Link>
          </section>

          <section className="glass-card card-hover p-5 hover:border-white/[0.14]">
            <h2 className="text-lg font-bold text-foreground">贡献者</h2>
            <div className="mt-4 flex flex-wrap gap-2">
              {item.contributors.map((name) => (
                <span
                  key={name}
                  className="rounded-full border border-white/[0.06] bg-white/[0.03] px-3 py-1.5 text-xs text-foreground-muted"
                >
                  {name}
                </span>
              ))}
            </div>
          </section>

          <section className="glass-card card-hover p-5 hover:border-white/[0.14]">
            <h2 className="text-lg font-bold text-foreground">相关工具</h2>
            <div className="mt-4 flex flex-wrap gap-2">
              {item.tools.length > 0 ? (
                item.tools.map((tool) => <TagBadge key={tool}>{tool}</TagBadge>)
              ) : (
                <p className="text-sm text-foreground-muted">暂无工具标签</p>
              )}
            </div>
          </section>
        </aside>
      </div>
    </section>
  );
}
