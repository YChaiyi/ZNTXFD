import fs from "fs";
import path from "path";
import { TOKEN_RANK_CONFIG } from "@/config/tokenRank";

export type ContentManifestFile = {
  path: string;
  size: number;
  sha256: string;
};

export type ContentManifest = {
  contentVersion: string;
  generatedAt: string;
  codeSha: string;
  schemaVersion: number;
  fileCount: number;
  files: ContentManifestFile[];
};

export type ContentStatus = {
  ready: boolean;
  contentVersion: string | null;
  schemaVersion: number | null;
  codeSha: string | null;
  generatedAt: string | null;
  fileCount: number;
  error: string | null;
};

type ContentPaths = {
  root: string;
  dataRoot: string;
  imageRoot: string;
  external: boolean;
};

const CONTENT_SCHEMA_VERSION = 1;
const REQUIRED_CONTENT_ENTRIES = [
  "daily",
  "knowledge",
  "index.json",
  "search-index.json",
  "digest-images",
] as const;

let contentStatusCache:
  | {
      key: string;
      status: ContentStatus;
      manifest: ContentManifest;
    }
  | undefined;

export class ContentUnavailableError extends Error {
  readonly statusCode = 503;

  constructor(message: string) {
    super(message);
    this.name = "ContentUnavailableError";
  }
}

function configuredContentRoot() {
  const value = process.env.ZNT_CONTENT_DIR?.trim();
  return value ? path.resolve(value) : null;
}

function resolveContentPaths(): ContentPaths | null {
  const externalRoot = configuredContentRoot();
  if (externalRoot) {
    // Resolve the content pointer once so each read below addresses an immutable
    // release rather than repeatedly traversing the mutable `current` symlink.
    let releaseRoot = externalRoot;
    try {
      releaseRoot = fs.realpathSync(externalRoot);
    } catch {
      // Validation below reports an unavailable content root as a controlled 503.
    }
    return {
      root: releaseRoot,
      dataRoot: releaseRoot,
      imageRoot: path.join(releaseRoot, "digest-images"),
      external: true,
    };
  }

  if (process.env.NODE_ENV === "production") return null;

  const projectRoot = process.cwd();
  return {
    root: projectRoot,
    dataRoot: path.join(projectRoot, "data"),
    imageRoot: path.join(projectRoot, "public", "digest-images"),
    external: false,
  };
}

function safeResolve(root: string, relativePath: string) {
  const absolute = path.resolve(root, relativePath);
  const relative = path.relative(root, absolute);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Content path escapes its root: ${relativePath}`);
  }
  return absolute;
}

function normalizeManifest(raw: unknown): ContentManifest {
  if (!raw || typeof raw !== "object") {
    throw new Error("manifest.json must contain an object");
  }

  const source = raw as Record<string, unknown>;
  const rawFiles = source.files;
  if (!Array.isArray(rawFiles)) {
    throw new Error("manifest files must be an array");
  }

  const files = rawFiles.map((entry, index) => {
    if (!entry || typeof entry !== "object") {
      throw new Error(`manifest file entry ${index} is invalid`);
    }
    const item = entry as Record<string, unknown>;
    return {
      path: String(item.path ?? ""),
      size: Number(item.size),
      sha256: String(item.sha256 ?? item.sha_256 ?? ""),
    };
  });

  return {
    contentVersion: String(source.contentVersion ?? source.content_version ?? ""),
    generatedAt: String(source.generatedAt ?? source.generated_at ?? ""),
    codeSha: String(source.codeSha ?? source.code_sha ?? ""),
    schemaVersion: Number(source.schemaVersion ?? source.schema_version),
    fileCount: Number(source.fileCount ?? source.file_count),
    files,
  };
}

function manifestPathIsSafe(value: string) {
  return (
    value.length > 0 &&
    !value.startsWith("/") &&
    !value.includes("\\") &&
    !value.split("/").some((part) => part === "" || part === "." || part === "..")
  );
}

function walkContentFiles(root: string, directory = root): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkContentFiles(root, absolute));
      continue;
    }
    if (!entry.isFile()) {
      throw new Error(`Unsupported content entry: ${path.relative(root, absolute)}`);
    }
    const relative = path.relative(root, absolute).split(path.sep).join("/");
    if (relative !== "manifest.json") files.push(relative);
  }
  return files.sort((a, b) => a.localeCompare(b));
}

function validateExternalContent(paths: ContentPaths) {
  const rootStat = fs.statSync(paths.root);
  if (!rootStat.isDirectory()) throw new Error("ZNT_CONTENT_DIR is not a directory");

  for (const entry of REQUIRED_CONTENT_ENTRIES) {
    const absolute = safeResolve(paths.root, entry);
    if (!fs.existsSync(absolute)) throw new Error(`Missing content entry: ${entry}`);
    const stat = fs.statSync(absolute);
    const shouldBeDirectory = !entry.endsWith(".json");
    if (shouldBeDirectory ? !stat.isDirectory() : !stat.isFile()) {
      throw new Error(`Invalid content entry type: ${entry}`);
    }
  }

  const manifestPath = safeResolve(paths.root, "manifest.json");
  const manifestStat = fs.statSync(manifestPath);
  const realRoot = fs.realpathSync(paths.root);
  const cacheKey = `${realRoot}:${manifestStat.mtimeMs}:${manifestStat.size}`;
  if (contentStatusCache?.key === cacheKey) return contentStatusCache;

  const manifest = normalizeManifest(JSON.parse(fs.readFileSync(manifestPath, "utf8")));
  if (!manifest.contentVersion) throw new Error("Manifest contentVersion is missing");
  if (!manifest.generatedAt || Number.isNaN(Date.parse(manifest.generatedAt))) {
    throw new Error("Manifest generatedAt is invalid");
  }
  if (!manifest.codeSha) throw new Error("Manifest codeSha is missing");
  if (manifest.schemaVersion !== CONTENT_SCHEMA_VERSION) {
    throw new Error(`Unsupported content schema: ${manifest.schemaVersion}`);
  }
  if (!Number.isSafeInteger(manifest.fileCount) || manifest.fileCount !== manifest.files.length) {
    throw new Error("Manifest file count mismatch");
  }

  const listedPaths = new Set<string>();
  for (const entry of manifest.files) {
    if (!manifestPathIsSafe(entry.path) || listedPaths.has(entry.path)) {
      throw new Error(`Invalid or duplicate manifest path: ${entry.path}`);
    }
    if (!Number.isSafeInteger(entry.size) || entry.size < 0) {
      throw new Error(`Invalid manifest size: ${entry.path}`);
    }
    if (!/^[a-f0-9]{64}$/.test(entry.sha256)) {
      throw new Error(`Invalid manifest hash: ${entry.path}`);
    }
    listedPaths.add(entry.path);

    const absolute = safeResolve(paths.root, entry.path);
    const stat = fs.statSync(absolute);
    if (!stat.isFile() || stat.size !== entry.size) {
      throw new Error(`Content file size mismatch: ${entry.path}`);
    }
    // SHA-256 is verified by the VPS promotion step. At request time we only
    // check the manifest and file metadata so a new content release does not
    // synchronously reread every large digest image on its first page view.
  }

  const actualPaths = walkContentFiles(paths.root);
  if (
    actualPaths.length !== manifest.fileCount ||
    actualPaths.some((entry) => !listedPaths.has(entry))
  ) {
    throw new Error("Manifest does not describe the complete content bundle");
  }

  for (const requiredFile of ["index.json", "search-index.json", "knowledge/index.json"]) {
    if (!listedPaths.has(requiredFile)) {
      throw new Error(`Manifest is missing required file: ${requiredFile}`);
    }
  }
  if (![...listedPaths].some((entry) => entry.startsWith("daily/") && entry.endsWith(".json"))) {
    throw new Error("Manifest does not contain a daily report");
  }

  const status: ContentStatus = {
    ready: true,
    contentVersion: manifest.contentVersion,
    schemaVersion: manifest.schemaVersion,
    codeSha: manifest.codeSha,
    generatedAt: manifest.generatedAt,
    fileCount: manifest.fileCount,
    error: null,
  };
  contentStatusCache = { key: cacheKey, status, manifest };
  return contentStatusCache;
}

function unavailableStatus(error: unknown): ContentStatus {
  return {
    ready: false,
    contentVersion: null,
    schemaVersion: null,
    codeSha: null,
    generatedAt: null,
    fileCount: 0,
    error: error instanceof Error ? error.message : String(error),
  };
}

export function getContentStatus(): ContentStatus {
  const paths = resolveContentPaths();
  if (!paths) return unavailableStatus("ZNT_CONTENT_DIR is required in production");

  if (!paths.external) {
    const required = [
      path.join(paths.dataRoot, "daily"),
      path.join(paths.dataRoot, "index.json"),
      path.join(paths.dataRoot, "search-index.json"),
      paths.imageRoot,
    ];
    const ready = required.every((entry) => fs.existsSync(entry));
    return {
      ready,
      contentVersion: ready ? "development" : null,
      schemaVersion: ready ? CONTENT_SCHEMA_VERSION : null,
      codeSha: null,
      generatedAt: null,
      fileCount: 0,
      error: ready ? null : "Local development content is incomplete",
    };
  }

  try {
    return validateExternalContent(paths).status;
  } catch (error) {
    return unavailableStatus(error);
  }
}

export function getContentManifest(): ContentManifest | null {
  const paths = resolveContentPaths();
  if (!paths?.external) return null;
  try {
    return validateExternalContent(paths).manifest;
  } catch {
    return null;
  }
}

function requireContentPaths() {
  const paths = resolveContentPaths();
  if (!paths) {
    throw new ContentUnavailableError("ZNT_CONTENT_DIR is required in production");
  }
  if (paths.external) {
    const status = getContentStatus();
    if (!status.ready) {
      throw new ContentUnavailableError(status.error ?? "Production content is unavailable");
    }
  }
  return paths;
}

function contentDataPath(relativePath: string) {
  return safeResolve(requireContentPaths().dataRoot, relativePath);
}

export function getDigestImageFilePath(date: string, filename: string) {
  const paths = requireContentPaths();
  return safeResolve(paths.imageRoot, `${date}/${filename}`);
}

export type DailyIndexItem = {
  date: string;
  title: string;
  tags: string[];
  topic_count: number;
  total_messages: number;
  active_members: number;
};

export type DailyTopic = {
  title: string;
  content: string;
  key_insights: string[];
  tools_mentioned: string[];
  action_items: string[];
  contributors: string[];
  tags: string[];
};

export type DailyGroupStat = {
  name: string;
  message_count: number;
  active_users: number;
};

export type DailyReport = {
  date: string;
  title: string;
  topics: DailyTopic[];
  stats: {
    total_messages: number;
    active_members: number;
    // Older content bundles predate the per-group breakdown.
    groups?: DailyGroupStat[];
  };
};

export type KnowledgeTopic = {
  slug: string;
  name: string;
  count: number;
  dates: string[];
  insights: string[];
  tools: string[];
  contributors: string[];
  relatedTags: string[];
};

export type SearchIndexItem = {
  id: string;
  date: string;
  reportTitle: string;
  title: string;
  content: string;
  tags: string[];
  tools: string[];
  insights: string[];
  contributors: string[];
};

export type TrustStatus =
  | "unverified"
  | "has_evidence"
  | "verified"
  | "ai_reviewed"
  | "needs_repro"
  | "reproducing";

export type KnowledgeEvidence = {
  label: string;
  text: string;
  sourceTitle: string;
  sourceDate: string;
  sourceHref: string;
  sourceGroup?: string;
};

export type ReproductionReport = {
  id: string;
  tester: string;
  level: string;
  status: "passed" | "failed" | "pending";
  environment: string;
  summary: string;
  output?: string;
};

export type TrustedKnowledgeItem = {
  slug: string;
  title: string;
  category: string;
  rating?: "AAA" | "AA" | "A" | string;
  claim: string;
  summary: string;
  tags: string[];
  tools: string[];
  contributors: string[];
  sourceCount?: number;
  sourceTitle: string;
  sourceDate: string;
  sourceHref: string;
  trustScore: number;
  evidenceCount: number;
  citationCount: number;
  disputeCount: number;
  reproductionPassed: number;
  reproductionTotal: number;
  status: TrustStatus;
  version: string;
  updatedAt: string;
  applicability: string[];
  risks: string[];
  evidences: KnowledgeEvidence[];
  reproductions: ReproductionReport[];
};

export type QuestionItem = {
  slug: string;
  title: string;
  description: string;
  tags: string[];
  askedBy: string;
  status: "ai_answered" | "expert_needed" | "answered";
  answer: string;
  relatedKnowledge: TrustedKnowledgeItem[];
  answers: number;
};

export type DigestGroup = {
  key: string;
  label: string;
  name: string;
  activeFrom: string;
};

export type DigestImage = DigestGroup & {
  exists: boolean;
  src: string;
};

export type TokenRankBoard = {
  key: string;
  label: string;
};

export type TokenRankRange = {
  key: string;
  label: string;
};

export type TokenRankMetric = {
  key: "total" | "norm" | "cost";
  label: string;
  description: string;
};

export type TokenRankEntry = {
  rank: number;
  userId: number;
  name: string;
  role: string;
  score: number;
  norm: number;
  cost: number;
  streakDays: number;
  deviceCount: number;
  anomaly: boolean;
  byTool: Record<string, number>;
  byModel: Record<string, number>;
};

export type TokenRankMySummary = {
  userId: number;
  name: string;
  public: boolean;
  lastSync: string;
  activeDays: number;
  deviceCount: number;
  today: {
    total: number;
    norm: number;
    cost: number;
  };
  daily: {
    date: string;
    total: number;
    cost: number;
  }[];
};

export type TokenRankData = {
  updatedAt: string;
  totalMembers: number;
  aggregate?: {
    total: number;
    norm: number;
    cost: number;
  };
  syncIntervalMinutes: number;
  boards: TokenRankBoard[];
  ranges: TokenRankRange[];
  metrics: TokenRankMetric[];
  entries: TokenRankEntry[];
  mySummary: TokenRankMySummary;
  connect: {
    installMac: string;
    installWin: string;
    agentPrompt: string;
  };
  diagnosePrompt: string;
  pricing: {
    unit: string;
    snapshotDate: string;
    sourceName: string;
    formula: string;
    notes: string[];
  };
};

export const DIGEST_GROUPS: DigestGroup[] = [
  {
    key: "group1",
    label: "一群",
    name: "智能体先锋队一群",
    activeFrom: "2026-05-17",
  },
  {
    key: "group2",
    label: "二群",
    name: "智能体先锋队二群",
    activeFrom: "2026-06-02",
  },
  {
    key: "group3",
    label: "三群",
    name: "智能体先锋队三群",
    activeFrom: "2026-06-14",
  },
  {
    key: "group4",
    label: "四群",
    name: "智能体先锋队四群",
    activeFrom: "2026-06-20",
  },
  {
    key: "group5",
    label: "五群",
    name: "智能体先锋队五群",
    activeFrom: "2026-07-15",
  },
];

export function getDailyIndex(): DailyIndexItem[] {
  const filePath = contentDataPath("index.json");
  const content = fs.readFileSync(filePath, "utf8");
  return JSON.parse(content) as DailyIndexItem[];
}

export function getTokenRankData(): TokenRankData {
  return TOKEN_RANK_CONFIG;
}

export function getSearchIndex(): SearchIndexItem[] {
  const filePath = contentDataPath("search-index.json");
  const content = fs.readFileSync(filePath, "utf8");
  return JSON.parse(content) as SearchIndexItem[];
}

// Content bundles generated before the empty-section guard may still carry
// headings with nothing under them; drop those so pages never render a
// bare section title.
export function stripEmptySections(content: string): string {
  const lines = content.split("\n");
  const result: string[] = [];
  let pendingHeading: string | null = null;
  let pendingBlanks: string[] = [];

  for (const line of lines) {
    if (/^###\s+/.test(line)) {
      pendingHeading = line;
      pendingBlanks = [];
      continue;
    }
    if (pendingHeading !== null) {
      if (line.trim() === "") {
        pendingBlanks.push(line);
        continue;
      }
      result.push(pendingHeading, ...pendingBlanks);
      pendingHeading = null;
      pendingBlanks = [];
    }
    result.push(line);
  }

  return result.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function getDailyReport(date: string): DailyReport {
  const filePath = contentDataPath(`daily/${date}.json`);
  const content = fs.readFileSync(filePath, "utf8");
  const raw = JSON.parse(content);
  for (const topic of raw.topics ?? []) {
    topic.key_insights ??= [];
    topic.tools_mentioned ??= [];
    topic.action_items ??= [];
    topic.contributors ??= [];
    topic.tags ??= [];
    topic.content = stripEmptySections(String(topic.content ?? ""));
  }
  return raw as DailyReport;
}

export function getActiveDigestGroups(date: string): DigestGroup[] {
  return DIGEST_GROUPS.filter((group) => date >= group.activeFrom);
}

export function getDigestImages(date: string): DigestImage[] {
  const paths = requireContentPaths();
  const dir = safeResolve(paths.imageRoot, date);

  return getActiveDigestGroups(date).map((group) => {
    const extensions = ["avif", "png"];
    const extension = extensions.find((ext) =>
      fs.existsSync(path.join(dir, `${group.key}.${ext}`)),
    );
    const src = `/digest-images/${date}/${group.key}.${extension ?? "avif"}`;
    return {
      ...group,
      src,
      exists: Boolean(extension),
    };
  });
}

export function getDigestStatus(date: string) {
  const images = getDigestImages(date);
  const readyCount = images.filter((image) => image.exists).length;
  const totalCount = images.length;
  return {
    images,
    readyCount,
    totalCount,
    available: totalCount > 0,
    complete: totalCount > 0 && readyCount === totalCount,
  };
}

export function isRawishReport(report: DailyReport) {
  const topics = report.topics ?? [];
  if (topics.length === 0) return false;

  const rawishCount = topics.filter((topic) => {
    const content = topic.content ?? "";
    if (content.includes("### 关键沉淀") && content.includes("### 证据原话")) {
      return false;
    }
    return content.trim().startsWith("- ") || content.split("：").length >= 7;
  }).length;

  return rawishCount / topics.length > 0.5;
}

export function getAllDates(): string[] {
  return getDailyIndex().map((item) => item.date);
}

export function getKnowledgeTopics(): KnowledgeTopic[] {
  const index = getDailyIndex();
  const tagMap = new Map<
    string,
    {
      dates: Set<string>;
      insights: string[];
      tools: Set<string>;
      contributors: Set<string>;
      coTags: Map<string, number>;
    }
  >();

  for (const item of index) {
    let report: DailyReport | null = null;
    try {
      report = getDailyReport(item.date);
    } catch {
      continue;
    }
    for (const topic of report.topics) {
      for (const tag of topic.tags) {
        const t = tag.trim();
        if (!t) continue;
        if (!tagMap.has(t)) {
          tagMap.set(t, {
            dates: new Set(),
            insights: [],
            tools: new Set(),
            contributors: new Set(),
            coTags: new Map(),
          });
        }
        const entry = tagMap.get(t)!;
        entry.dates.add(item.date);
        for (const ins of topic.key_insights ?? []) entry.insights.push(ins);
        for (const tool of topic.tools_mentioned ?? []) entry.tools.add(tool);
        for (const c of topic.contributors) entry.contributors.add(c);
        for (const otherTag of topic.tags) {
          const ot = otherTag.trim();
          if (ot && ot !== t) {
            entry.coTags.set(ot, (entry.coTags.get(ot) ?? 0) + 1);
          }
        }
      }
    }
  }

  const topics: KnowledgeTopic[] = [];
  const usedSlugs = new Map<string, number>();
  for (const [name, data] of tagMap) {
    const baseSlug = makeSlug(name, `topic-${topics.length + 1}`).toLowerCase();
    const count = usedSlugs.get(baseSlug) ?? 0;
    usedSlugs.set(baseSlug, count + 1);
    const slug = count === 0 ? baseSlug : `${baseSlug}-${count + 1}`;
    const relatedTags = [...data.coTags.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([t]) => t);
    topics.push({
      slug,
      name,
      count: data.dates.size,
      dates: [...data.dates].sort().reverse(),
      insights: data.insights.slice(0, 20),
      tools: [...data.tools],
      contributors: [...data.contributors],
      relatedTags,
    });
  }

  return topics.sort((a, b) => b.count - a.count);
}

function uniqueStrings(items: string[]) {
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))];
}

function makeSlug(value: string, fallback: string) {
  const normalized = value
    .trim()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || fallback;
}

function firstSentence(value: string) {
  const text = value.replace(/\s+/g, " ").trim();
  const parts = text.split(/[。！？!?]/).filter(Boolean);
  return (parts[0] ?? text).slice(0, 96);
}

function inferCategory(item: SearchIndexItem) {
  const tags = item.tags.join(" ");
  const text = `${item.title} ${tags} ${item.content}`;
  if (/教程|步骤|配置|部署|流程|SOP|CLI|API|命令/.test(text)) return "教程";
  if (/风险|封号|失败|报错|安全|风控|坑/.test(text)) return "风险";
  if (/商业|变现|客户|报价|案例|电商|跨境/.test(text)) return "案例";
  if (/Agent|智能体|MCP|RAG|工作流/.test(text)) return "Agent";
  return item.tags[0] ?? "观点";
}

function statusLabelSeed(item: SearchIndexItem): TrustStatus {
  const text = `${item.title} ${item.content} ${item.insights.join(" ")}`;
  if (/失败|报错|风险|封号|不稳定|争议/.test(text)) return "needs_repro";
  if (/教程|配置|部署|流程|代码|API|MCP|RAG|Codex|Claude/.test(text)) return "reproducing";
  if (item.insights.length >= 4 && item.contributors.length >= 3) return "verified";
  return "ai_reviewed";
}

function buildReproductions(item: SearchIndexItem, status: TrustStatus): ReproductionReport[] {
  const hasTechnicalSignal = /教程|配置|部署|流程|API|MCP|RAG|Codex|Claude|脚本|代码/.test(
    `${item.title} ${item.content} ${item.tags.join(" ")}`,
  );
  const reports: ReproductionReport[] = [
    {
      id: `${item.id}-ai-review`,
      tester: "旺总AI",
      level: "AI 初审",
      status: "pending",
      environment: "期刊 JSON / 群精华索引",
      summary: "已完成结构化抽取，等待人工或专家在真实环境中复现。",
    },
  ];

  if (status === "verified" || status === "reproducing" || hasTechnicalSignal) {
    reports.push({
      id: `${item.id}-sample-repro`,
      tester: item.contributors[0] ?? "社群贡献者",
      level: status === "verified" ? "L5 骨干" : "L3 实践者",
      status: status === "verified" ? "passed" : "pending",
      environment: item.tools.slice(0, 3).join(" / ") || "待补充环境",
      summary:
        status === "verified"
          ? "来自多条群聊证据和工具线索，已具备进入可信知识库的基础条件。"
          : "需要补充运行环境、输入输出和失败边界后再升级可信度。",
      output: status === "verified" ? "evidence-linked" : undefined,
    });
  }

  if (status === "needs_repro") {
    reports.push({
      id: `${item.id}-risk-check`,
      tester: "复现队列",
      level: "待验证",
      status: "failed",
      environment: "风险/失败样本",
      summary: "内容包含失败或风险信号，暂不作为稳定结论引用。",
    });
  }

  return reports;
}

function getLegacyTrustedKnowledgeItems(): TrustedKnowledgeItem[] {
  const index = getSearchIndex();
  const usedSlugs = new Map<string, number>();

  return index
    .filter((item) => item.content.trim().length > 80)
    .map((item) => {
      const baseSlug = makeSlug(item.title, item.id);
      const count = usedSlugs.get(baseSlug) ?? 0;
      usedSlugs.set(baseSlug, count + 1);
      const slug = count === 0 ? baseSlug : `${baseSlug}-${count + 1}`;
      const status = statusLabelSeed(item);
      const evidences = uniqueStrings([
        ...item.insights.slice(0, 3),
        firstSentence(item.content),
      ]).slice(0, 4);
      const evidenceCount = Math.max(1, evidences.length);
      const reproductions = buildReproductions(item, status);
      const reproductionPassed = reproductions.filter((report) => report.status === "passed").length;
      const reproductionTotal = reproductions.length;
      const disputeCount = status === "needs_repro" ? 1 : 0;
      const citationCount = Math.max(1, item.tags.length + item.tools.length + Math.floor(item.content.length / 900));
      const trustScore = Math.min(
        96,
        Math.max(
          52,
          58 +
            evidenceCount * 5 +
            reproductionPassed * 8 +
            Math.min(item.contributors.length, 5) * 2 +
            Math.min(item.tools.length, 5) -
            disputeCount * 12,
        ),
      );

      return {
        slug,
        title: item.title,
        category: inferCategory(item),
        claim: item.insights[0] || firstSentence(item.content),
        summary: firstSentence(item.content),
        tags: uniqueStrings(item.tags).slice(0, 6),
        tools: uniqueStrings(item.tools).slice(0, 8),
        contributors: uniqueStrings(item.contributors).slice(0, 8),
        sourceTitle: item.reportTitle,
        sourceDate: item.date,
        sourceHref: `/daily/${item.date}`,
        trustScore,
        evidenceCount,
        citationCount,
        disputeCount,
        reproductionPassed,
        reproductionTotal,
        status,
        version: reproductionPassed > 0 ? "v2" : "v1",
        updatedAt: item.date,
        applicability: [
          "适合从社群讨论中快速定位可执行观点",
          item.tools.length > 0 ? `涉及工具：${item.tools.slice(0, 3).join(" / ")}` : "需要补充工具和环境边界",
          "引用时必须带来源期刊和原始上下文",
        ],
        risks: [
          status === "needs_repro"
            ? "含风险或失败信号，暂不建议直接照搬"
            : "仍需人工确认适用场景和版本差异",
          "群聊观点可能随模型、价格、政策和工具版本变化而过期",
        ],
        evidences: evidences.map((text, index) => ({
          label: index === 0 ? "核心证据" : `证据 ${index + 1}`,
          text,
          sourceTitle: item.reportTitle,
          sourceDate: item.date,
          sourceHref: `/daily/${item.date}`,
        })),
        reproductions,
      };
    })
    .sort((a, b) => b.trustScore - a.trustScore || b.sourceDate.localeCompare(a.sourceDate));
}

function ratingScore(rating: string | undefined) {
  if (rating === "AAA") return 92;
  if (rating === "AA") return 82;
  if (rating === "A") return 70;
  return 60;
}

function statusFromKnowledge(value: string | undefined): TrustStatus {
  if (value === "verified" || value === "has_evidence" || value === "unverified") {
    return value;
  }
  return "unverified";
}

function asStringList(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
}

function readKnowledgeDetail(id: string) {
  if (!id || id.includes("/") || id.includes("\\") || id.includes("..")) return null;
  const filePath = contentDataPath(`knowledge/items/${id}.json`);
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function knowledgeIndexToTrustedItem(
  raw: Record<string, unknown>,
  detailOverride?: Record<string, unknown> | null,
): TrustedKnowledgeItem {
  const id = String(raw.id || raw.slug || "");
  const detail = detailOverride ?? raw;
  const sources: unknown[] = Array.isArray(detail.sources) ? detail.sources : [];
  const firstSource =
    (sources.find((source: unknown) => source && typeof source === "object") as
      | Record<string, unknown>
      | undefined) ?? {};
  const sourceDate = String(
    firstSource.date || detail.source_date || detail.updated_at || detail.created_at || raw.updated_at || "",
  );
  const sourceHref = String(firstSource.daily_ref || (sourceDate ? `/daily/${sourceDate}` : "/daily"));
  const sourceTitle = sourceDate ? `期刊 ${sourceDate}` : "群精华证据";
  const rating = String(detail.rating || raw.rating || "");
  const sourceCount = sources.length || Number(raw.source_count || 0) || 1;
  const contributors = uniqueStrings([
    ...asStringList(detail.contributors),
    ...sources
      .map((source) =>
        source && typeof source === "object" ? String((source as Record<string, unknown>).speaker || "") : "",
      )
      .filter(Boolean),
  ]).slice(0, 12);
  const evidences =
    sources.length > 0
      ? sources.slice(0, 8).map((source, index) => {
          const item = source as Record<string, unknown>;
          const group = String(item.group_label || item.group || "");
          return {
            label: index === 0 ? "核心来源" : `来源 ${index + 1}`,
            text: String(item.quote || detail.claim || ""),
            sourceTitle,
            sourceDate: String(item.date || sourceDate),
            sourceHref: String(item.daily_ref || sourceHref),
            sourceGroup: group,
          };
        })
      : [
          {
            label: "来源摘要",
            text: String(detail.claim || raw.claim || ""),
            sourceTitle,
            sourceDate,
            sourceHref,
          },
        ];

  return {
    slug: String(detail.slug || raw.slug || id),
    title: String(detail.title || raw.title || ""),
    category: String(detail.category || raw.category || "其他高价值讨论"),
    rating,
    claim: String(detail.claim || raw.claim || ""),
    summary: String(detail.summary || raw.summary || detail.claim || raw.claim || ""),
    tags: uniqueStrings(asStringList(detail.tags).concat(asStringList(raw.tags))).slice(0, 8),
    tools: uniqueStrings(asStringList(detail.tools).concat(asStringList(raw.tools))).slice(0, 8),
    contributors,
    sourceCount,
    sourceTitle,
    sourceDate,
    sourceHref,
    trustScore: ratingScore(rating),
    evidenceCount: sourceCount,
    citationCount: Math.max(1, sourceCount + asStringList(detail.tags).length),
    disputeCount: 0,
    reproductionPassed: 0,
    reproductionTotal: 0,
    status: statusFromKnowledge(String(detail.status || raw.status || "")),
    version: "v1",
    updatedAt: String(detail.updated_at || raw.updated_at || sourceDate),
    applicability: [],
    risks: [],
    evidences,
    reproductions: [],
  };
}

export function getTrustedKnowledgeItems(): TrustedKnowledgeItem[] {
  const indexPath = contentDataPath("knowledge/index.json");
  if (!fs.existsSync(indexPath)) {
    return getLegacyTrustedKnowledgeItems();
  }

  try {
    const rawItems = JSON.parse(fs.readFileSync(indexPath, "utf8"));
    if (!Array.isArray(rawItems)) {
      return getLegacyTrustedKnowledgeItems();
    }
    const items = rawItems
      .filter((item): item is Record<string, unknown> => item && typeof item === "object")
      .map((item) => knowledgeIndexToTrustedItem(item))
      .filter((item) => item.title && item.claim)
      .sort(
        (a, b) =>
          b.updatedAt.localeCompare(a.updatedAt) ||
          ratingScore(b.rating) - ratingScore(a.rating) ||
          (b.sourceCount ?? 0) - (a.sourceCount ?? 0),
      );
    return items.length > 0 ? items : getLegacyTrustedKnowledgeItems();
  } catch {
    return getLegacyTrustedKnowledgeItems();
  }
}

export function getTrustedKnowledgeItem(slug: string) {
  const decoded = decodeURIComponent(slug);
  const indexPath = contentDataPath("knowledge/index.json");
  if (fs.existsSync(indexPath)) {
    try {
      const rawItems = JSON.parse(fs.readFileSync(indexPath, "utf8"));
      if (Array.isArray(rawItems)) {
        const raw = rawItems.find(
          (item): item is Record<string, unknown> =>
            item &&
            typeof item === "object" &&
            (item.slug === decoded || item.id === decoded),
        );
        if (raw) {
          return knowledgeIndexToTrustedItem(raw, readKnowledgeDetail(String(raw.id || raw.slug || "")));
        }
      }
    } catch {
      return getLegacyTrustedKnowledgeItems().find((item) => item.slug === decoded);
    }
  }
  return getTrustedKnowledgeItems().find((item) => item.slug === decoded);
}

export function getQuestionItems(): QuestionItem[] {
  const allItems = getTrustedKnowledgeItems();
  const aaaItems = allItems.filter((item) => item.rating === "AAA");
  const items = aaaItems.length > 0 ? aaaItems : allItems;
  if (items.length === 0) return [];
  const pick = (predicate: (item: TrustedKnowledgeItem) => boolean) =>
    items.find(predicate) ?? items[0];
  const questions = [
    {
      slug: "codex-config-auth",
      title: "Codex 接第三方 API 时，怎么保留 ChatGPT 官方登录态？",
      description: "群里反复提到 auth.json、config.toml 和第三方 provider，想知道哪部分能改、哪部分不能碰。",
      seed: pick((item) => /Codex|OpenAI|ChatGPT/.test(`${item.title} ${item.tags.join(" ")}`)),
      askedBy: "L2 学徒",
    },
    {
      slug: "agent-workflow-repro",
      title: "一个 Agent 工作流内容，怎样判断它真的可验证？",
      description: "只看群友说有效还不够，想知道需要哪些来源、日志、环境和失败边界。",
      seed: pick((item) => /Agent|工作流|MCP|RAG/.test(`${item.title} ${item.tags.join(" ")}`)),
      askedBy: "L3 实践者",
    },
    {
      slug: "business-case-trust",
      title: "商业化案例怎么进入可信知识库，而不是只停留在聊天摘要？",
      description: "希望把群友的接单、报价、交付经验变成能长期引用的条目。",
      seed: pick((item) => /商业|变现|案例|电商|客户/.test(`${item.title} ${item.tags.join(" ")}`)),
      askedBy: "L4 贡献者",
    },
  ];

  return questions.map((question, index) => ({
    slug: question.slug,
    title: question.title,
    description: question.description,
    tags: question.seed.tags.slice(0, 4),
    askedBy: question.askedBy,
    status: index === 0 ? "answered" : index === 1 ? "ai_answered" : "expert_needed",
    answer: `AI 先引用「${question.seed.title}」作为基础答案：${question.seed.claim}。下一步需要补充更多来源和人工验证，才能升级为稳定结论。`,
    relatedKnowledge: [question.seed, ...items.filter((item) => item.slug !== question.seed.slug).slice(index, index + 2)],
    answers: index === 2 ? 1 : 3 - index,
  }));
}
