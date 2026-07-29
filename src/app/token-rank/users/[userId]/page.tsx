import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getTokenRankPublicProfile,
  type TokenRankPublicProfile,
} from "@/lib/tokenRankStore";

export const metadata: Metadata = {
  title: "Token 主页 | 智能体先锋队",
  description: "智能体先锋队 Token 消耗榜成员的公开统计主页",
};

export const dynamic = "force-dynamic";

const TOOL_LABELS: Record<string, string> = {
  codex: "Codex",
  "claude-code": "Claude Code",
  hermes: "Hermes",
  cursor: "Cursor",
  openclaw: "OpenClaw",
  workbuddy: "WorkBuddy",
  opencode: "opencode",
  zcode: "ZCode",
  gemini: "Gemini",
  kimi: "Kimi",
  qwen: "Qwen",
  cline: "Cline",
  "roo-code": "Roo Code",
  "kilo-code": "Kilo Code",
  "copilot-cli": "Copilot CLI",
  amp: "Amp",
  droid: "Droid",
  kiro: "Kiro",
  grok: "Grok",
  reasonix: "Reasonix Code",
  minimax: "MiniMax",
  codebuddy: "CodeBuddy",
  antigravity: "Antigravity",
};

type PageProps = {
  params: Promise<{ userId: string }>;
};

function parseUserId(value: string) {
  // User IDs are positive 48-bit integers. Reject alternate spellings so every
  // public profile has exactly one canonical URL.
  if (!/^[1-9]\d{0,14}$/.test(value)) return null;
  const userId = Number(value);
  return Number.isSafeInteger(userId) && userId > 0 ? userId : null;
}

function formatTokens(value: number) {
  if (value >= 100000000) return `${(value / 100000000).toFixed(2)}亿`;
  if (value >= 10000) return `${(value / 10000).toFixed(1)}万`;
  return Math.round(value).toLocaleString("zh-CN");
}

function formatUsd(value: number) {
  if (value >= 100) return `$${Math.round(value).toLocaleString("en-US")}`;
  return `$${value.toFixed(2)}`;
}

function formatLastSync(value: string) {
  if (!value) return "等待首次同步";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "等待首次同步";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function getInitial(name: string) {
  return Array.from(name.trim())[0] ?? "T";
}

function sortUsage(values: Record<string, number>) {
  return Object.entries(values).sort(([leftName, leftValue], [rightName, rightValue]) => {
    if (rightValue !== leftValue) return rightValue - leftValue;
    return leftName.localeCompare(rightName, "zh-CN");
  });
}

function StatTile({
  label,
  value,
  tone = "text-foreground",
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div className="rounded-[14px] border border-white/[0.06] bg-white/[0.025] p-4">
      <p className={`mono-num break-words text-xl font-bold md:text-2xl ${tone}`}>{value}</p>
      <p className="mt-1 text-sm text-foreground-muted">{label}</p>
    </div>
  );
}

function UsageList({
  title,
  items,
  label,
}: {
  title: string;
  items: [string, number][];
  label: (value: string) => string;
}) {
  return (
    <section className="glass-card overflow-hidden">
      <div className="border-b border-white/[0.06] px-5 py-4">
        <h2 className="font-bold text-foreground">{title}</h2>
      </div>
      {items.length > 0 ? (
        <ul className="divide-y divide-white/[0.06]">
          {items.map(([name, total]) => (
            <li key={name} className="flex items-center justify-between gap-4 px-5 py-3.5">
              <span className="min-w-0 break-words text-sm font-medium text-foreground">
                {label(name)}
              </span>
              <span className="mono-num shrink-0 text-sm font-bold text-accent">
                {formatTokens(total)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-5 py-6 text-sm text-foreground-muted">等待首次同步</p>
      )}
    </section>
  );
}

function History({ daily }: { daily: TokenRankPublicProfile["daily"] }) {
  return (
    <section className="glass-card overflow-hidden">
      <div className="border-b border-white/[0.06] px-5 py-4">
        <h2 className="font-bold text-foreground">逐日历史</h2>
        <p className="mt-1 text-sm text-foreground-muted">按北京时间汇总的全部已上报数据</p>
      </div>
      {daily.length > 0 ? (
        <div className="overflow-x-auto">
          <div className="min-w-[620px]">
            <div className="grid grid-cols-[150px_repeat(3,minmax(0,1fr))] gap-4 border-b border-white/[0.06] bg-white/[0.02] px-5 py-3 text-xs font-bold text-foreground-muted">
              <span>日期</span>
              <span className="text-right">总用量</span>
              <span className="text-right">不含缓存</span>
              <span className="text-right">预估费用</span>
            </div>
            <ul className="divide-y divide-white/[0.06]">
              {daily.map((item) => (
                <li
                  key={item.date}
                  className="grid grid-cols-[150px_repeat(3,minmax(0,1fr))] gap-4 px-5 py-3.5 text-sm"
                >
                  <time className="mono-num font-medium text-foreground">{item.date}</time>
                  <span className="mono-num text-right font-semibold text-foreground">
                    {formatTokens(item.total)}
                  </span>
                  <span className="mono-num text-right font-semibold text-success">
                    {formatTokens(item.norm)}
                  </span>
                  <span className="mono-num text-right font-semibold text-pink">
                    {formatUsd(item.cost)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : (
        <p className="px-5 py-8 text-sm text-foreground-muted">等待首次同步</p>
      )}
    </section>
  );
}

function ProfileContent({ profile }: { profile: TokenRankPublicProfile }) {
  const hasUsage = profile.totals.total > 0;
  const tools = sortUsage(profile.byTool);
  const models = sortUsage(profile.byModel);
  const daily = [...profile.daily].reverse();
  const lastSync = formatLastSync(profile.totals.lastSync);

  return (
    <div className="space-y-5">
      <Link
        href="/token-rank"
        className="inline-flex items-center gap-2 text-sm font-bold text-accent transition-colors hover:text-accent-light"
      >
        <span aria-hidden="true">←</span>
        返回 Token 消耗榜
      </Link>

      <section className="glass-card glow-border p-6 md:p-7">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div className="flex min-w-0 items-center gap-4">
            <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-xl font-bold text-foreground ring-2 ring-accent/45">
              {getInitial(profile.user.name)}
            </span>
            <div className="min-w-0">
              <p className="text-xs font-bold tracking-[0.24em] text-accent">公开 Token 主页</p>
              <h1 className="mt-2 break-words text-3xl font-bold text-foreground md:text-4xl">
                {profile.user.name}
              </h1>
              <p className="mt-2 text-sm text-foreground-muted">
                {profile.user.role || "未设置角色"}
              </p>
            </div>
          </div>
          <span className="rounded-full bg-success/15 px-3 py-1.5 text-sm font-bold text-success">
            统计公开
          </span>
        </div>
        <p className="mt-5 max-w-3xl text-sm leading-7 text-foreground-muted">
          展示由客户端上报后汇总的 Token 使用统计，不包含专属令牌、设备标识或原始上报记录。
        </p>
      </section>

      {hasUsage ? (
        <>
          <section>
            <div className="mb-3 flex items-baseline justify-between gap-4">
              <h2 className="font-bold text-foreground">今日用量</h2>
              <span className="mono-num text-sm text-foreground-muted">{profile.today}</span>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <StatTile label="今日总用量" value={formatTokens(profile.todayTotals.total)} tone="text-accent" />
              <StatTile label="今日不含缓存" value={formatTokens(profile.todayTotals.norm)} tone="text-success" />
              <StatTile label="今日预估费用" value={formatUsd(profile.todayTotals.cost)} tone="text-pink" />
            </div>
          </section>

          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile label="累计 Token" value={formatTokens(profile.totals.total)} tone="text-accent" />
            <StatTile label="活跃天数" value={`${profile.totals.activeDays}`} tone="text-purple" />
            <StatTile label="设备数" value={`${profile.totals.deviceCount}`} tone="text-success" />
            <StatTile label="最近同步（北京时间）" value={lastSync} tone="text-foreground" />
          </section>

          <section className="grid gap-5 lg:grid-cols-2">
            <UsageList title="工具用量" items={tools} label={(tool) => TOOL_LABELS[tool] ?? tool} />
            <UsageList title="模型用量" items={models} label={(model) => model} />
          </section>

          <History daily={daily} />
        </>
      ) : (
        <section className="glass-card p-6 text-center md:p-8">
          <span className="pulse-dot" aria-hidden="true" />
          <h2 className="mt-4 text-xl font-bold text-foreground">等待首次同步</h2>
          <p className="mx-auto mt-2 max-w-xl text-sm leading-7 text-foreground-muted">
            该公开主页已经创建。运行专属客户端并完成第一次上报后，这里会显示真实的 Token 使用统计。
          </p>
        </section>
      )}
    </div>
  );
}

export default async function TokenRankPublicProfilePage({ params }: PageProps) {
  const { userId: rawUserId } = await params;
  const userId = parseUserId(rawUserId);
  if (userId === null) notFound();

  const profile = await getTokenRankPublicProfile(userId);
  if (!profile) notFound();

  return <ProfileContent profile={profile} />;
}
