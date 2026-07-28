"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { TokenRankData, TokenRankEntry } from "@/lib/data";

type TabKey = "leaderboard" | "connect" | "mine" | "rules";
type MetricKey = "total" | "norm" | "cost";
type RankedEntry = TokenRankEntry & {
  displayRank: number;
  displayScore: number;
  displayNorm: number;
  displayCost: number;
};
type RegisteredConnection = {
  token: string;
  installMac: string;
  installWin: string;
  agentPrompt: string;
  user: {
    userId: number;
    name: string;
    role: string;
  };
};

const tabs: { key: TabKey; label: string }[] = [
  { key: "leaderboard", label: "排行榜" },
  { key: "connect", label: "如何上榜" },
  { key: "mine", label: "我的" },
  { key: "rules", label: "统计规则" },
];

const toolLabels: Record<string, string> = {
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
  minimax: "MiniMax Code",
  codebuddy: "CodeBuddy",
  antigravity: "Antigravity",
};

const toolColors: Record<string, string> = {
  codex: "#2563eb",
  "claude-code": "#d97757",
  hermes: "#6d28d9",
  cursor: "#0ea5e9",
  openclaw: "#0891b2",
  workbuddy: "#dc2626",
  opencode: "#64748b",
  zcode: "#c026d3",
  gemini: "#16a34a",
  kimi: "#0d9488",
  qwen: "#f59e0b",
  cline: "#0d9488",
  "roo-code": "#db2777",
  "kilo-code": "#65a30d",
  "copilot-cli": "#84cc16",
  amp: "#f97316",
  droid: "#10b981",
  kiro: "#e11d48",
  grok: "#525252",
  reasonix: "#4f46e5",
  minimax: "#ef4444",
  codebuddy: "#3b82f6",
  antigravity: "#0284c7",
};

function formatTokens(value: number) {
  if (value >= 100000000) return `${(value / 100000000).toFixed(2)}亿`;
  if (value >= 10000) return `${(value / 10000).toFixed(1)}万`;
  return Math.round(value).toLocaleString("zh-CN");
}

function formatUsd(value: number) {
  if (value >= 100) return `$${Math.round(value).toLocaleString("en-US")}`;
  return `$${value.toFixed(2)}`;
}

function formatMetricValue(entry: RankedEntry, metric: MetricKey) {
  if (metric === "cost") return `≈${formatUsd(entry.displayCost)}`;
  return `${formatTokens(metric === "norm" ? entry.displayNorm : entry.displayScore)} tokens`;
}

function getInitial(name: string) {
  return Array.from(name.trim())[0] ?? "T";
}

function toolLabel(tool: string) {
  return toolLabels[tool] ?? tool;
}

function toolColor(tool: string) {
  return toolColors[tool] ?? "#8364ff";
}

function metricScore(entry: RankedEntry, metric: MetricKey) {
  if (metric === "cost") return entry.displayCost;
  if (metric === "norm") return entry.displayNorm;
  return entry.displayScore;
}

function buildRankedEntries(
  entries: TokenRankEntry[],
  board: string,
  metric: MetricKey,
): RankedEntry[] {
  const adjusted = entries.map((entry) => {
      const boardTokens =
        board === "total" ? entry.score : (entry.byTool[board] ?? 0);
      const boardRatio = entry.score > 0 ? boardTokens / entry.score : 0;
      const score = board === "total" ? entry.score : boardTokens;
      return {
        ...entry,
        displayRank: entry.rank,
        displayScore: score,
        displayNorm: board === "total" ? entry.norm : entry.norm * boardRatio,
        displayCost: board === "total" ? entry.cost : entry.cost * boardRatio,
      };
    });

  return adjusted
    .sort((a, b) => metricScore(b, metric) - metricScore(a, metric))
    .map((entry, index) => ({ ...entry, displayRank: index + 1 }));
}

function InitialAvatar({ name, rank }: { name: string; rank?: number }) {
  const ring =
    rank === 1
      ? "ring-accent/55"
      : rank === 2
        ? "ring-white/30"
        : rank === 3
          ? "ring-pink/40"
          : "ring-white/[0.08]";

  return (
    <span
      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-sm font-bold text-foreground ring-2 ${ring}`}
    >
      {getInitial(name)}
    </span>
  );
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
      <p className={`mono-num text-2xl font-bold md:text-3xl ${tone}`}>{value}</p>
      <p className="mt-1 text-sm text-foreground-muted">{label}</p>
    </div>
  );
}

function FilterButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`shrink-0 rounded-full px-3 py-1.5 text-sm font-semibold transition-colors ${
        active
          ? "bg-accent text-background"
          : "border border-white/[0.08] bg-white/[0.03] text-foreground-muted hover:border-white/[0.16] hover:text-foreground"
      }`}
    >
      {label}
    </button>
  );
}

function CopyButton({
  value,
  copyKey,
  copied,
  onCopy,
  disabled = false,
}: {
  value: string;
  copyKey: string;
  copied: string;
  onCopy: (value: string, key: string) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => onCopy(value, copyKey)}
      disabled={disabled}
      className="shrink-0 rounded-full bg-accent px-4 py-2 text-sm font-bold text-background transition-transform hover:-translate-y-0.5 hover:bg-accent-light disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:translate-y-0"
    >
      {disabled ? "先生成" : copied === copyKey ? "已复制" : "复制"}
    </button>
  );
}

function CommandBox({
  title,
  description,
  value,
  copyKey,
  copied,
  onCopy,
  disabled = false,
}: {
  title: string;
  description: string;
  value: string;
  copyKey: string;
  copied: string;
  onCopy: (value: string, key: string) => void;
  disabled?: boolean;
}) {
  return (
    <section className="glass-card p-5">
      <div className="mb-3">
        <h2 className="font-bold text-foreground">{title}</h2>
        <p className="mt-1 text-sm leading-6 text-foreground-muted">{description}</p>
      </div>
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
        <code className="min-w-0 overflow-x-auto rounded-[12px] border border-white/[0.06] bg-background/70 px-3 py-3 text-xs leading-6 text-foreground-muted">
          {value}
        </code>
        <CopyButton
          value={value}
          copyKey={copyKey}
          copied={copied}
          onCopy={onCopy}
          disabled={disabled}
        />
      </div>
    </section>
  );
}

function LeaderboardView({
  data,
  activeBoard,
  setActiveBoard,
  activeRange,
  setActiveRange,
  activeMetric,
  setActiveMetric,
  setActiveTab,
  isRefreshing,
}: {
  data: TokenRankData;
  activeBoard: string;
  setActiveBoard: (value: string) => void;
  activeRange: string;
  setActiveRange: (value: string) => void;
  activeMetric: MetricKey;
  setActiveMetric: (value: MetricKey) => void;
  setActiveTab: (value: TabKey) => void;
  isRefreshing: boolean;
}) {
  const [followed, setFollowed] = useState(() => new Set<number>([10002, 10003]));
  const rankedEntries = useMemo(
    () => buildRankedEntries(data.entries, activeBoard, activeMetric),
    [activeBoard, activeMetric, data.entries],
  );
  const totalTokens = data.aggregate?.total
    ?? rankedEntries.reduce((sum, entry) => sum + entry.displayScore, 0);
  const totalNorm = data.aggregate?.norm
    ?? rankedEntries.reduce((sum, entry) => sum + entry.displayNorm, 0);
  const totalCost = data.aggregate?.cost
    ?? rankedEntries.reduce((sum, entry) => sum + entry.displayCost, 0);
  const myRank = rankedEntries.find((entry) => entry.userId === data.mySummary.userId);
  const rangeLabel = data.ranges.find((range) => range.key === activeRange)?.label ?? "今天";
  const boardLabel = data.boards.find((board) => board.key === activeBoard)?.label ?? "总榜";

  function toggleFollow(userId: number) {
    setFollowed((current) => {
      const next = new Set(current);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }

  return (
    <div className="space-y-5">
      <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <article className="glass-card glow-border p-6 md:p-7">
          <p className="text-xs font-bold tracking-[0.24em] text-accent">
            AI 编程工具用量
          </p>
          <h1 className="mt-4 text-3xl font-bold leading-tight text-foreground md:text-5xl">
            Token 消耗榜
          </h1>
          <p className="mt-4 max-w-3xl text-sm leading-7 text-foreground-muted md:text-base md:leading-8">
            统计智能体先锋队群友在 Codex、Claude Code、Cursor 等工具里的 token 消耗，按北京时间每日刷新。群友生成专属命令后，本机客户端会自动上报并进入榜单。
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => setActiveTab("connect")}
              className="inline-flex h-11 items-center rounded-full bg-accent px-5 text-sm font-bold text-background transition-transform hover:-translate-y-0.5 hover:bg-accent-light"
            >
              如何上榜
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("rules")}
              className="inline-flex h-11 items-center rounded-full border border-white/[0.08] bg-white/[0.03] px-5 text-sm font-bold text-foreground transition-transform hover:-translate-y-0.5 hover:border-white/[0.16]"
            >
              统计规则
            </button>
          </div>
        </article>

        <aside className="glass-card p-5">
          <h2 className="text-lg font-bold text-foreground">榜单概览</h2>
          <div className="mt-5 grid grid-cols-2 gap-3">
            <StatTile label="参与人数" value={`${data.totalMembers}`} tone="text-accent" />
            <StatTile label="上榜工具" value={`${data.boards.length - 1}`} tone="text-success" />
            <StatTile label="总消耗" value={formatTokens(totalTokens)} tone="text-purple" />
            <StatTile label="预估费用" value={formatUsd(totalCost)} tone="text-pink" />
          </div>
          <p className="mt-4 text-xs leading-6 text-foreground-muted">
            最近同步 {data.updatedAt} · 每 {data.syncIntervalMinutes} 分钟更新一次{isRefreshing ? " · 正在刷新" : ""}。
          </p>
        </aside>
      </section>

      <section className="glass-card p-4 md:p-5">
        <div className="space-y-4">
          <div className="flex gap-2 overflow-x-auto pb-1">
            {data.boards.map((board) => (
              <FilterButton
                key={board.key}
                active={activeBoard === board.key}
                label={board.label}
                onClick={() => setActiveBoard(board.key)}
              />
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto pb-1">
              {data.ranges.map((range) => (
                <FilterButton
                  key={range.key}
                  active={activeRange === range.key}
                  label={range.label}
                  onClick={() => setActiveRange(range.key)}
                />
              ))}
            </div>
            <div className="grid w-full grid-cols-3 rounded-full border border-white/[0.08] bg-background/60 p-1 sm:w-auto">
              {data.metrics.map((metric) => (
                <button
                  key={metric.key}
                  type="button"
                  title={metric.description}
                  onClick={() => setActiveMetric(metric.key)}
                  className={`rounded-full px-3 py-1.5 text-xs font-bold transition-colors ${
                    activeMetric === metric.key
                      ? "bg-white text-background"
                      : "text-foreground-muted hover:text-foreground"
                  }`}
                >
                  {metric.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      {myRank ? (
        <section className="rounded-[16px] border border-accent/20 bg-accent/[0.07] p-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm font-bold text-foreground">我的{rangeLabel}{boardLabel}排名</span>
            <span className="mono-num text-2xl font-bold text-accent">#{myRank.displayRank}</span>
            <span className="mono-num text-sm text-foreground-muted">
              {formatMetricValue(myRank, activeMetric)}
            </span>
            <span className="ml-auto text-xs text-foreground-muted">
              {data.mySummary.deviceCount} 台设备 · 最近同步 {data.mySummary.lastSync}
            </span>
          </div>
        </section>
      ) : null}

      <section className="space-y-2">
        <div className="flex flex-wrap items-baseline gap-2">
          <h2 className="text-xl font-bold text-foreground">
            {rangeLabel}{boardLabel} Top 20
          </h2>
          <p className="text-sm text-foreground-muted">
            全员累计 {activeMetric === "cost"
              ? `≈${formatUsd(totalCost)}`
              : `${formatTokens(activeMetric === "norm" ? totalNorm : totalTokens)} tokens`}
          </p>
        </div>

        {rankedEntries.length === 0 ? (
          <div className="glass-card p-8 text-center">
            <h3 className="text-xl font-bold text-foreground">暂无真实上榜数据</h3>
            <p className="mx-auto mt-3 max-w-2xl text-sm leading-7 text-foreground-muted">
              现在没有展示任何编造数据。等群友生成专属命令并完成第一次同步后，这里会按真实 token 上报自动排序。
            </p>
            <button
              type="button"
              onClick={() => setActiveTab("connect")}
              className="mt-5 inline-flex h-11 items-center rounded-full bg-accent px-5 text-sm font-bold text-background transition-transform hover:-translate-y-0.5 hover:bg-accent-light"
            >
              去生成上榜命令
            </button>
          </div>
        ) : (
          <ul className="space-y-2">
            {rankedEntries.map((entry) => {
            const topTools = Object.entries(entry.byTool)
              .sort((a, b) => b[1] - a[1])
              .slice(0, 3);
            const hasUsage = entry.displayScore > 0;

            return (
              <li
                key={entry.userId}
                className={`grid gap-3 rounded-[16px] border p-4 transition-all hover:-translate-y-0.5 md:grid-cols-[56px_1fr_auto] md:items-center ${
                  entry.userId === data.mySummary.userId
                    ? "border-accent/30 bg-accent/[0.07]"
                    : hasUsage
                      ? "border-white/[0.06] bg-white/[0.025] hover:border-white/[0.14]"
                      : "border-white/[0.04] bg-white/[0.015] opacity-70 hover:border-white/[0.1]"
                }`}
              >
                <div className="flex items-center gap-3 md:block">
                  <span className="mono-num inline-flex h-9 w-9 items-center justify-center rounded-full bg-white/[0.04] text-sm font-bold text-foreground-muted">
                    {entry.displayRank <= 3 ? ["🥇", "🥈", "🥉"][entry.displayRank - 1] : entry.displayRank}
                  </span>
                </div>

                <div className="min-w-0">
                  <div className="flex items-center gap-3">
                    <InitialAvatar name={entry.name} rank={entry.displayRank} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="truncate font-bold text-foreground">{entry.name}</p>
                        {entry.userId === data.mySummary.userId ? (
                          <span className="rounded-full bg-accent/15 px-2 py-0.5 text-xs font-bold text-accent">
                            我
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-0.5 truncate text-xs text-foreground-muted">{entry.role}</p>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {topTools.length > 0 ? topTools.map(([tool, value]) => (
                      <span
                        key={tool}
                        className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.06] bg-white/[0.035] px-2.5 py-1 text-xs text-foreground-muted"
                      >
                        <span
                          className="h-2 w-2 rounded-full"
                          style={{ backgroundColor: toolColor(tool) }}
                        />
                        {toolLabel(tool)} {formatTokens(value)}
                      </span>
                    )) : (
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.06] bg-white/[0.025] px-2.5 py-1 text-xs text-foreground-muted">
                        等待首次同步
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-between gap-3 md:justify-end">
                  {entry.userId !== data.mySummary.userId ? (
                    <button
                      type="button"
                      onClick={() => toggleFollow(entry.userId)}
                      className={`rounded-full p-2 transition-colors ${
                        followed.has(entry.userId)
                          ? "text-accent hover:text-accent-light"
                          : "text-foreground-disabled hover:text-accent"
                      }`}
                      title={followed.has(entry.userId) ? "取消关注" : "关注 TA"}
                    >
                      <svg
                        viewBox="0 0 20 20"
                        fill="currentColor"
                        className="h-5 w-5"
                        aria-hidden="true"
                      >
                        <path d="M10 1.8l2.36 4.78 5.28.77-3.82 3.72.9 5.26L10 13.85l-4.72 2.48.9-5.26-3.82-3.72 5.28-.77L10 1.8z" />
                      </svg>
                    </button>
                  ) : null}
                  <div className="text-right">
                    <p className="mono-num text-lg font-bold text-foreground">
                      {hasUsage ? formatMetricValue(entry, activeMetric) : "等待同步"}
                    </p>
                    <p className="mono-num mt-0.5 text-xs text-foreground-muted">
                      {hasUsage
                        ? `不含缓存 ${formatTokens(entry.displayNorm)} · ${entry.streakDays} 天连续`
                        : "完成本机接入后自动进入榜单"}
                    </p>
                  </div>
                </div>
              </li>
            );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

function ConnectView({ data }: { data: TokenRankData }) {
  const [os, setOs] = useState<"mac" | "win">("mac");
  const [copied, setCopied] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [connection, setConnection] = useState<RegisteredConnection | null>(null);
  const [isRegistering, setIsRegistering] = useState(false);
  const [error, setError] = useState("");
  const command = os === "mac"
    ? connection?.installMac ?? "请先点击上方「生成命令」，这里会出现你的真实专属安装命令。"
    : connection?.installWin ?? "请先点击上方「生成命令」，这里会出现你的真实专属安装命令。";
  const agentPrompt = connection?.agentPrompt ?? "请先点击上方「生成命令」，这里会出现带真实专属令牌的 AI 接入提示。";

  useEffect(() => {
    try {
      const cached = window.localStorage.getItem("znt-token-rank-connection");
      if (!cached) return;
      const parsed = JSON.parse(cached) as RegisteredConnection;
      if (parsed?.token && parsed?.installMac && parsed?.installWin) {
        setConnection(parsed);
        setName(parsed.user?.name ?? "");
        setRole(parsed.user?.role ?? "");
      }
    } catch {
      window.localStorage.removeItem("znt-token-rank-connection");
    }
  }, []);

  async function copy(value: string, key: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      window.setTimeout(() => setCopied(""), 1500);
    } catch {
      setCopied("");
    }
  }

  async function register() {
    setIsRegistering(true);
    setError("");

    try {
      const response = await fetch("/api/token-rank/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, role }),
      });
      const body = await response.json() as RegisteredConnection & { status?: number; message?: string };

      if (!response.ok || body.status !== 0) {
        throw new Error(body.message || "生成专属命令失败");
      }

      const next: RegisteredConnection = {
        token: body.token,
        installMac: body.installMac,
        installWin: body.installWin,
        agentPrompt: body.agentPrompt,
        user: body.user,
      };
      setConnection(next);
      window.localStorage.setItem("znt-token-rank-connection", JSON.stringify(next));
    } catch (registerError) {
      setError(registerError instanceof Error ? registerError.message : "生成专属命令失败");
    } finally {
      setIsRegistering(false);
    }
  }

  return (
    <div id="connect" className="space-y-5">
      <section className="glass-card p-6 md:p-7">
        <p className="text-xs font-bold tracking-[0.24em] text-accent">上榜接入</p>
        <h1 className="mt-4 text-3xl font-bold text-foreground">如何上榜</h1>
        <p className="mt-4 max-w-3xl text-sm leading-7 text-foreground-muted md:text-base md:leading-8">
          生成你的专属上报命令，在本机安装后台小程序。它每天自动统计 Codex、Claude Code、Cursor、Gemini、Kimi 等工具的 token 用量，只上报数量，不上传代码、对话或本地文件。
        </p>
      </section>

      <section className="border border-accent/30 bg-accent/[0.06] p-5">
        <h2 className="font-bold text-accent">统计规则已升级至 v0.2.0</h2>
        <p className="mt-2 text-sm leading-6 text-foreground-muted">
          已经上榜的用户不需要生成新身份。重新执行原来的专属安装命令即可覆盖旧客户端；首次成功同步会重算并替换本设备最近 35 个北京时间自然日的 Codex 统计。其他用户、设备、工具和窗口外历史不受这次纠错影响。
        </p>
      </section>

      <section className="glass-card p-5">
        <h2 className="font-bold text-foreground">① 生成你的专属命令</h2>
        <p className="mt-1 text-sm text-foreground-muted">只需要昵称；角色标签不填也可以。生成后本浏览器会记住你的令牌。</p>
        <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end">
          <label className="block">
            <span className="text-xs font-bold text-foreground-muted">昵称</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="智能体先锋队群友"
              className="mt-2 h-11 w-full rounded-[12px] border border-white/[0.08] bg-background/70 px-3 text-sm text-foreground outline-none transition-colors placeholder:text-foreground-disabled focus:border-accent/60"
            />
          </label>
          <label className="block">
            <span className="text-xs font-bold text-foreground-muted">标签</span>
            <input
              value={role}
              onChange={(event) => setRole(event.target.value)}
              placeholder="自媒体 / 编程 / 工作流"
              className="mt-2 h-11 w-full rounded-[12px] border border-white/[0.08] bg-background/70 px-3 text-sm text-foreground outline-none transition-colors placeholder:text-foreground-disabled focus:border-accent/60"
            />
          </label>
          <button
            type="button"
            onClick={register}
            disabled={isRegistering}
            className="h-11 rounded-full bg-accent px-5 text-sm font-bold text-background transition-transform hover:-translate-y-0.5 hover:bg-accent-light disabled:cursor-not-allowed disabled:opacity-60"
          >
            {connection ? "重新生成" : isRegistering ? "生成中" : "生成命令"}
          </button>
        </div>
        {connection ? (
          <p className="mt-3 text-sm text-success">
            已生成：{connection.user.name} · 令牌以 {connection.token.slice(0, 12)}... 开头
          </p>
        ) : null}
        {error ? <p className="mt-3 text-sm text-pink">{error}</p> : null}
      </section>

      <section className="glass-card p-5">
        <h2 className="font-bold text-foreground">② 选择你的系统</h2>
        <p className="mt-1 text-sm text-foreground-muted">两个系统的命令不同，选错会运行失败。</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {[
            { key: "mac" as const, label: "macOS / Linux", sub: "Mac / Linux 电脑" },
            { key: "win" as const, label: "Windows", sub: "PowerShell" },
          ].map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setOs(item.key)}
              className={`rounded-[14px] border p-4 text-left transition-colors ${
                os === item.key
                  ? "border-accent/50 bg-accent/[0.08]"
                  : "border-white/[0.06] bg-white/[0.025] hover:border-white/[0.14]"
              }`}
            >
              <span className="font-bold text-foreground">{item.label}</span>
              <span className="mt-1 block text-sm text-foreground-muted">{item.sub}</span>
            </button>
          ))}
        </div>
      </section>

      <CommandBox
        title={`③ 复制命令，粘贴到${os === "mac" ? "终端" : "PowerShell"}运行`}
        description={`自动安装并每 ${data.syncIntervalMinutes} 分钟后台上报你的 AI token 用量。专属令牌请勿转发或公开截图。`}
        value={command}
        copyKey="command"
        copied={copied}
        onCopy={copy}
        disabled={!connection}
      />

      <CommandBox
        title="不想自己动手？让 AI 帮你接入"
        description="把下面这段直接发给你的编码助手，让它替你执行，并要求它把个人令牌打码后再汇报。"
        value={agentPrompt}
        copyKey="agent"
        copied={copied}
        onCopy={copy}
        disabled={!connection}
      />

      <CommandBox
        title="某个工具没统计 / 数据不准？帮我们诊断"
        description="把下面这段发给对应工具的 AI 助手，拿到脱敏样例后发给维护者，我们就能把这个工具加上或修准。"
        value={data.diagnosePrompt}
        copyKey="diagnose"
        copied={copied}
        onCopy={copy}
      />
    </div>
  );
}

function MineView({ data }: { data: TokenRankData }) {
  const [publicProfile, setPublicProfile] = useState(data.mySummary.public);
  const [loginToken, setLoginToken] = useState("");
  const [loginError, setLoginError] = useState("");
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [liveMe, setLiveMe] = useState<{
    user: RegisteredConnection["user"];
    today: string;
    totals: {
      total: number;
      norm: number;
      cost: number;
      activeDays: number;
      deviceCount: number;
      lastSync: string;
      byTool: Record<string, number>;
      byModel: Record<string, number>;
    };
    todayTotals: {
      total: number;
      norm: number;
      cost: number;
      activeDays: number;
      deviceCount: number;
      lastSync: string;
      byTool: Record<string, number>;
      byModel: Record<string, number>;
    };
  } | null>(null);

  const loadMe = useCallback(async (token?: string) => {
    const headers = token ? { authorization: `Bearer ${token}` } : undefined;
    const response = await fetch("/api/token-rank/me", {
      credentials: "include",
      headers,
    });
    const body = await response.json() as typeof liveMe & { status?: number };
    if (response.ok && body?.status === 0) setLiveMe(body);
    return response.ok;
  }, []);

  useEffect(() => {
    async function loadSavedMe() {
      try {
        const cached = window.localStorage.getItem("znt-token-rank-connection");
        if (!cached) {
          await loadMe();
          return;
        }
        const parsed = JSON.parse(cached) as RegisteredConnection;
        if (parsed?.token) setLoginToken(parsed.token);
        await loadMe(parsed?.token);
      } catch {
        setLiveMe(null);
      }
    }

    loadSavedMe();
  }, [loadMe]);

  async function login() {
    setIsLoggingIn(true);
    setLoginError("");

    try {
      const response = await fetch("/api/token-rank/login", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: loginToken }),
      });
      const body = await response.json() as { status?: number; message?: string; user?: RegisteredConnection["user"] };

      if (!response.ok || body.status !== 0) {
        throw new Error(body.message || "登录失败");
      }

      window.localStorage.setItem("znt-token-rank-connection", JSON.stringify({
        token: loginToken,
        installMac: data.connect.installMac.replace("znt_trk_xxx_your_private_token", loginToken),
        installWin: data.connect.installWin.replace("znt_trk_xxx_your_private_token", loginToken),
        agentPrompt: data.connect.agentPrompt,
        user: body.user,
      }));
      await loadMe(loginToken);
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : "登录失败");
    } finally {
      setIsLoggingIn(false);
    }
  }

  if (!liveMe) {
    return (
      <div className="space-y-5">
        <section className="glass-card p-6 md:p-7">
          <p className="text-xs font-bold tracking-[0.24em] text-accent">我的用量</p>
          <h1 className="mt-4 text-3xl font-bold text-foreground">还没有真实同步数据</h1>
          <p className="mt-4 max-w-3xl text-sm leading-7 text-foreground-muted md:text-base md:leading-8">
            这里不再展示示例账号。生成专属命令并完成第一次客户端上报后，才会显示你的真实 token 用量。
          </p>
        </section>
        <section className="glass-card p-5">
          <h2 className="font-bold text-foreground">用专属令牌登录</h2>
          <p className="mt-2 text-sm leading-6 text-foreground-muted">
            已经生成过上榜命令的用户，输入 znt_trk_ 开头的令牌即可在这台设备查看自己的今日 token。
          </p>
          <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
            <input
              value={loginToken}
              onChange={(event) => setLoginToken(event.target.value)}
              placeholder="znt_trk_..."
              className="h-11 w-full rounded-[12px] border border-white/[0.08] bg-background/70 px-3 text-sm text-foreground outline-none transition-colors placeholder:text-foreground-disabled focus:border-accent/60"
            />
            <button
              type="button"
              onClick={login}
              disabled={isLoggingIn || !loginToken.trim()}
              className="h-11 rounded-full bg-accent px-5 text-sm font-bold text-background transition-transform hover:-translate-y-0.5 hover:bg-accent-light disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isLoggingIn ? "登录中" : "登录"}
            </button>
          </div>
          {loginError ? <p className="mt-3 text-sm text-pink">{loginError}</p> : null}
        </section>
      </div>
    );
  }

  const profileName = liveMe.user.name;
  const lastSync = liveMe.todayTotals.lastSync || liveMe.totals.lastSync || "等待首次同步";
  const deviceCount = liveMe.totals.deviceCount;
  const activeDays = liveMe.totals.activeDays;
  const todayTotal = liveMe.todayTotals.total;
  const todayNorm = liveMe.todayTotals.norm;
  const todayCost = liveMe.todayTotals.cost;
  const total = liveMe.totals.total;

  return (
    <div className="space-y-5">
      <section className="glass-card p-6 md:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold tracking-[0.24em] text-accent">我的用量</p>
            <h1 className="mt-4 text-3xl font-bold text-foreground">{profileName}的 Token 主页</h1>
            <p className="mt-3 text-sm leading-7 text-foreground-muted">
              真实账号 · 最近同步 {lastSync} · {deviceCount} 台设备。
            </p>
          </div>
          <button
            type="button"
            onClick={() => setPublicProfile((value) => !value)}
            className={`rounded-full px-4 py-2 text-sm font-bold transition-colors ${
              publicProfile
                ? "bg-success/15 text-success"
                : "bg-white/[0.04] text-foreground-muted"
            }`}
          >
            {publicProfile ? "个人页公开" : "个人页私密"}
          </button>
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-4">
        <StatTile label={`今日总用量 ${liveMe.today}`} value={formatTokens(todayTotal)} tone="text-accent" />
        <StatTile label="今日不含缓存" value={formatTokens(todayNorm)} tone="text-success" />
        <StatTile label="今日预估费用" value={formatUsd(todayCost)} tone="text-pink" />
        <StatTile label="活跃天数" value={`${activeDays}`} tone="text-purple" />
      </section>

      <section className="glass-card p-5">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="font-bold text-foreground">累计上报</h2>
          <span className="mono-num text-lg font-bold text-accent">{formatTokens(total)} tokens</span>
          <span className="text-sm text-foreground-muted">{deviceCount} 台设备 · 最近同步 {lastSync}</span>
        </div>
      </section>

      <section className="glass-card p-5">
        <h2 className="font-bold text-foreground">切换专属令牌</h2>
        <p className="mt-2 text-sm leading-6 text-foreground-muted">
          如果这里显示 0，但排行榜里已经有你的名字，通常是当前浏览器登录了另一个空身份。输入本机安装时的 znt_trk_ 令牌即可切回真实账号。
        </p>
        <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
          <input
            value={loginToken}
            onChange={(event) => setLoginToken(event.target.value)}
            placeholder="znt_trk_..."
            className="h-11 w-full rounded-[12px] border border-white/[0.08] bg-background/70 px-3 text-sm text-foreground outline-none transition-colors placeholder:text-foreground-disabled focus:border-accent/60"
          />
          <button
            type="button"
            onClick={login}
            disabled={isLoggingIn || !loginToken.trim()}
            className="h-11 rounded-full bg-accent px-5 text-sm font-bold text-background transition-transform hover:-translate-y-0.5 hover:bg-accent-light disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isLoggingIn ? "切换中" : "切换"}
          </button>
        </div>
        {loginError ? <p className="mt-3 text-sm text-pink">{loginError}</p> : null}
      </section>

      <section className="glass-card p-5">
        <div className="flex flex-wrap items-center gap-3">
          <span className="pulse-dot" aria-hidden="true" />
          <h2 className="font-bold text-foreground">{todayTotal > 0 ? "今日数据已同步" : "等待今日同步"}</h2>
          <span className="text-sm text-foreground-muted">
            {todayTotal > 0 ? "服务器已收到今日客户端上报，已进入对应榜单。" : "专属身份已登录，运行本机安装命令后这里会出现今日真实统计。"}
          </span>
        </div>
      </section>
    </div>
  );
}

function RulesView({ data }: { data: TokenRankData }) {
  return (
    <div id="rules" className="space-y-5">
      <section className="glass-card p-6 md:p-7">
        <p className="text-xs font-bold tracking-[0.24em] text-accent">统计规则</p>
        <h1 className="mt-4 text-3xl font-bold text-foreground">Token 消耗榜统计口径</h1>
        <p className="mt-4 max-w-3xl text-sm leading-7 text-foreground-muted md:text-base md:leading-8">
          榜单只统计 token 数量、工具、模型、日期和本机生成的随机设备标识，不上传代码、对话内容、文件路径或 API Key。
        </p>
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <div className="glass-card p-5">
          <h2 className="font-bold text-foreground">含缓存</h2>
          <p className="mt-2 text-sm leading-6 text-foreground-muted">
            新输入 + 输出 + 缓存读取 + 缓存写入。四个桶互不重叠，每个 token 只计算一次。
          </p>
        </div>
        <div className="glass-card p-5">
          <h2 className="font-bold text-foreground">不含缓存</h2>
          <p className="mt-2 text-sm leading-6 text-foreground-muted">
            只计算新输入 + 输出，不含缓存命中和缓存写入，便于比较非缓存工作量。
          </p>
        </div>
        <div className="glass-card p-5">
          <h2 className="font-bold text-foreground">预估费用</h2>
          <p className="mt-2 text-sm leading-6 text-foreground-muted">
            按等效 API 成本估算，方便比较不同模型和工具的消耗强度。
          </p>
        </div>
      </section>

      <section className="glass-card p-5">
        <h2 className="font-bold text-foreground">Codex 原始日志口径</h2>
        <ul className="mt-4 space-y-3 text-sm leading-6 text-foreground-muted">
          <li>数据直接来自 Codex 本机 JSONL 会话日志，不依赖 CC Switch 或其他统计软件。</li>
          <li>每条有效 token_count 事件取相邻 total_token_usage 累计快照的正增量；重复快照增量为 0。</li>
          <li>含缓存总量等于 input_tokens + output_tokens。cached_input_tokens 是 input_tokens 的子集，reasoning_output_tokens 是 output_tokens 的子集，两者都不会重复相加。</li>
          <li>子智能体 rollout 按显式 trigger_turn 或当前 UUIDv7 turn 边界剔除 fork 时继承的父会话前缀。</li>
          <li>没有 fork 边界时，仅跳过无计数事件或父子终态累计计数相同、可证明没有新增用量的中止会话；其余会话暂缓统计，不猜测入榜。</li>
          <li>事件按时间戳归入北京时间自然日；文件大小不设上限，解析缓存只保存在本机，不随统计上报发送。</li>
          <li>重装时只权威重算本设备最近 35 个北京时间自然日的 Codex 历史；其他设备、工具、用户及窗口外数据不会被这次快照删除。</li>
          <li>扫描、JSONL 解析、时间戳、累计计数或 fork 完整性检查任一失败，都不会提交权威快照或覆盖既有 Codex 历史。</li>
        </ul>
      </section>

      <section className="glass-card p-5">
        <h2 className="font-bold text-foreground">费用公式</h2>
        <code className="mt-3 block overflow-x-auto rounded-[12px] border border-white/[0.06] bg-background/70 px-3 py-3 text-xs leading-6 text-foreground-muted">
          {data.pricing.formula}
        </code>
        <p className="mt-3 text-sm leading-6 text-foreground-muted">
          单位 {data.pricing.unit} · 价目快照更新于 {data.pricing.snapshotDate} · 来源：{data.pricing.sourceName}
        </p>
      </section>

      <section className="glass-card p-5">
        <h2 className="font-bold text-foreground">支持工具</h2>
        <div className="mt-4 flex flex-wrap gap-2">
          {data.boards
            .filter((board) => board.key !== "total")
            .map((board) => (
              <span key={board.key} className="tag-pill px-3 py-1.5 text-sm font-semibold">
                {board.label}
              </span>
            ))}
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="glass-card p-5">
          <h2 className="font-bold text-foreground">口径说明</h2>
          <ul className="mt-4 space-y-3 text-sm leading-6 text-foreground-muted">
            {data.pricing.notes.map((note) => (
              <li key={note} className="flex gap-2">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                <span>{note}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="glass-card p-5">
          <h2 className="font-bold text-foreground">隐私边界</h2>
          <div className="mt-4 space-y-3 text-sm leading-6 text-foreground-muted">
            <p>客户端在本机只提取 token 计数，以及去重所需的时间戳、模型、会话和 fork 元数据；不会收集或上传代码、对话正文、文件内容、文件路径或 API Key。</p>
            <p>上报包含身份令牌、设备标识、客户端版本、工具、模型、日期和输入/输出/缓存计数；Codex 权威快照另带统计截止时间、35 日窗口和完整性声明。</p>
            <p>用户可以停止本机后台任务，停止后榜单只保留历史统计，不再新增用量。</p>
          </div>
        </div>
      </section>
    </div>
  );
}

export function TokenRankClient({ data }: { data: TokenRankData }) {
  const [activeTab, setActiveTab] = useState<TabKey>("leaderboard");
  const [activeBoard, setActiveBoard] = useState("total");
  const [activeRange, setActiveRange] = useState("today");
  const [activeMetric, setActiveMetric] = useState<MetricKey>("total");
  const [leaderboardData, setLeaderboardData] = useState(data);
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    const controller = new AbortController();

    async function refreshLeaderboard() {
      setIsRefreshing(true);
      try {
        const params = new URLSearchParams({
          board: activeBoard,
          range: activeRange,
          metric: activeMetric,
        });
        const response = await fetch(`/api/token-rank/leaderboard?${params}`, {
          signal: controller.signal,
        });
        const body = await response.json() as {
          status?: number;
          entries?: TokenRankEntry[];
          totalMembers?: number;
          updatedAt?: string;
          aggregate?: TokenRankData["aggregate"];
        };

        if (!response.ok || body.status !== 0 || !Array.isArray(body.entries)) return;

        setLeaderboardData((current) => ({
          ...current,
          entries: body.entries ?? current.entries,
          totalMembers: body.totalMembers ?? current.totalMembers,
          updatedAt: body.updatedAt ?? current.updatedAt,
          aggregate: body.aggregate ?? current.aggregate,
        }));
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
      } finally {
        if (!controller.signal.aborted) setIsRefreshing(false);
      }
    }

    refreshLeaderboard();
    const timer = window.setInterval(refreshLeaderboard, data.syncIntervalMinutes * 60 * 1000);

    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [activeBoard, activeMetric, activeRange, data.syncIntervalMinutes]);

  return (
    <section className="space-y-5">
      <nav className="glass sticky top-20 z-30 flex gap-2 overflow-x-auto rounded-full p-1">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={`shrink-0 rounded-full px-4 py-2 text-sm font-bold transition-colors ${
              activeTab === tab.key
                ? "bg-accent text-background"
                : "text-foreground-muted hover:bg-white/[0.04] hover:text-foreground"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {activeTab === "leaderboard" ? (
        <LeaderboardView
          data={leaderboardData}
          activeBoard={activeBoard}
          setActiveBoard={setActiveBoard}
          activeRange={activeRange}
          setActiveRange={setActiveRange}
          activeMetric={activeMetric}
          setActiveMetric={setActiveMetric}
          setActiveTab={setActiveTab}
          isRefreshing={isRefreshing}
        />
      ) : null}
      {activeTab === "connect" ? <ConnectView data={data} /> : null}
      {activeTab === "mine" ? <MineView data={data} /> : null}
      {activeTab === "rules" ? <RulesView data={data} /> : null}
    </section>
  );
}
