import { KnowledgeDirectoryClient } from "@/components/KnowledgeDirectoryClient";
import { formatCount } from "@/lib/format";
import { getTrustedKnowledgeItems } from "@/lib/data";

export const dynamic = "force-dynamic";

type HubConfig = {
  key: string;
  title: string;
  subtitle: string;
  accent: string;
  matcher: RegExp;
  matchTerms: string[];
};

const hubs: HubConfig[] = [
  {
    key: "Codex",
    title: "Codex 实战",
    subtitle: "额度、配置、AGENTS.md、客户端、网络与协作方式。",
    accent: "bg-accent",
    matcher: /Codex|AGENTS|额度|客户端|Token/i,
    matchTerms: ["Codex", "AGENTS", "额度", "客户端", "Token"],
  },
  {
    key: "Claude",
    title: "Claude 与模型选择",
    subtitle: "Claude Code、Kimi、Gemini、订阅成本与模型替代。",
    accent: "bg-[#79d7ff]",
    matcher: /Claude|Kimi|Gemini|GPT|模型|订阅|K3/i,
    matchTerms: ["Claude", "Kimi", "Gemini", "GPT", "模型", "订阅", "K3"],
  },
  {
    key: "Agent",
    title: "Agent 工作流",
    subtitle: "私有知识库、流程自动化、MCP、任务编排和工具协作。",
    accent: "bg-success",
    matcher: /Agent|智能体|工作流|MCP|自动化|Obsidian|知识库/i,
    matchTerms: ["Agent", "智能体", "工作流", "MCP", "自动化", "Obsidian", "知识库"],
  },
  {
    key: "风控",
    title: "账号与风控",
    subtitle: "充值、封号、代理、TUN、支付、网络环境和安全边界。",
    accent: "bg-danger",
    matcher: /风控|封号|账号|代理|充值|支付|TUN|风险|安全|网络/i,
    matchTerms: ["风控", "封号", "账号", "代理", "充值", "支付", "TUN", "风险", "安全", "网络"],
  },
  {
    key: "视频",
    title: "内容与视频",
    subtitle: "AI 视频、剪辑、生图、口播脚本、主图和内容流水线。",
    accent: "bg-pink",
    matcher: /视频|剪辑|生图|图片|口播|主图|内容|AI视频|ChatCut/i,
    matchTerms: ["视频", "剪辑", "生图", "图片", "口播", "主图", "内容", "AI视频", "ChatCut"],
  },
  {
    key: "商业",
    title: "商业与电商",
    subtitle: "电商、外贸、客户、变现、报价、RPA 与业务案例。",
    accent: "bg-purple",
    matcher: /商业|电商|外贸|客户|变现|报价|RPA|副业|Shopee|TikTok/i,
    matchTerms: ["商业", "电商", "外贸", "客户", "变现", "报价", "RPA", "副业", "Shopee", "TikTok"],
  },
  {
    key: "基础设施",
    title: "基础设施",
    subtitle: "服务器、VPS、云资源、设备采购、本地中枢和部署。",
    accent: "bg-[#b8f27c]",
    matcher: /服务器|VPS|部署|云|硬件|Mac|本地|中枢|基础设施/i,
    matchTerms: ["服务器", "VPS", "部署", "云", "硬件", "Mac", "本地", "中枢", "基础设施"],
  },
  {
    key: "高价值",
    title: "高评级精选",
    subtitle: "全部 AAA 条目，适合继续整理成手册。",
    accent: "bg-[#f7c95c]",
    matcher: /./,
    matchTerms: [],
  },
];

function countBy<T>(items: T[], getKey: (item: T) => string) {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = getKey(item);
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "zh-CN"));
}

function countListValues<T>(items: T[], getValues: (item: T) => string[]) {
  const counts = new Map<string, number>();
  for (const item of items) {
    for (const value of getValues(item)) {
      if (!value) continue;
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "zh-CN"));
}

function itemText(item: ReturnType<typeof getTrustedKnowledgeItems>[number]) {
  return [
    item.title,
    item.claim,
    item.category,
    item.rating ?? "",
    ...item.tags,
    ...item.tools,
  ].join(" ");
}

export default function KnowledgePage() {
  const allItems = getTrustedKnowledgeItems();
  const items = allItems.filter((item) => item.rating === "AAA");
  const dates = new Set(items.map((item) => item.updatedAt || item.sourceDate).filter(Boolean));
  const sourceCount = items.reduce((sum, item) => sum + (item.sourceCount ?? item.evidenceCount), 0);
  const categories = countBy(items, (item) => item.category);
  const tools = countListValues(items, (item) => item.tools);

  const directoryItems = items.map((item) => ({
    slug: item.slug,
    title: item.title,
    claim: item.claim,
    summary: item.summary,
    category: item.category,
    rating: item.rating,
    tags: item.tags,
    tools: item.tools,
    contributors: item.contributors,
    sourceCount: item.sourceCount ?? item.evidenceCount,
    evidenceCount: item.evidenceCount,
    citationCount: item.citationCount,
    sourceDate: item.sourceDate,
    updatedAt: item.updatedAt,
  }));

  const directoryHubs = hubs.map((hub) => {
    const matched = items.filter((item) => hub.matcher.test(itemText(item)));
    const latestDate = matched
      .map((item) => item.updatedAt || item.sourceDate)
      .sort()
      .at(-1);

    return {
      key: hub.key,
      title: hub.title,
      subtitle: hub.subtitle,
      count: matched.length,
      latestDate: latestDate ?? "",
      accent: hub.accent,
      matchTerms: hub.matchTerms,
    };
  });

  const stats = [
    { label: "AAA 条目", value: formatCount(items.length), tone: "text-accent" },
    { label: "覆盖日期", value: formatCount(dates.size), tone: "text-success" },
    { label: "专题入口", value: formatCount(directoryHubs.filter((hub) => hub.count > 0).length), tone: "text-purple" },
    { label: "来源证据", value: formatCount(sourceCount), tone: "text-pink" },
  ];

  return (
    <KnowledgeDirectoryClient
      items={directoryItems}
      hubs={directoryHubs}
      stats={stats}
      categories={categories}
      tools={tools}
    />
  );
}
