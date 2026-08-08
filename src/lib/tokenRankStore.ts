import crypto from "crypto";
import fs from "fs";
import path from "path";
import type { TokenRankEntry } from "@/lib/data";

export type TokenRankUser = {
  userId: number;
  tokenHash: string;
  name: string;
  role: string;
  createdAt: string;
  // Retained for compatibility with identities created before public profiles
  // became unconditional. It no longer controls profile visibility.
  public?: boolean;
  // Omitted on legacy identities; those remain active until explicitly retired.
  active?: boolean;
  retiredAt?: string;
  retiredReason?: string;
};

export type TokenRankPublicProfileStats = {
  total: number;
  norm: number;
  cost: number;
  activeDays: number;
  deviceCount: number;
  lastSync: string;
};

export type TokenRankPublicProfileDaily = {
  date: string;
  total: number;
  norm: number;
  cost: number;
};

export type TokenRankPublicProfile = {
  user: {
    userId: number;
    name: string;
    role: string;
  };
  today: string;
  totals: TokenRankPublicProfileStats;
  todayTotals: TokenRankPublicProfileStats;
  byTool: Record<string, number>;
  byModel: Record<string, number>;
  daily: TokenRankPublicProfileDaily[];
};

export type TokenRankUsageRecord = {
  userId: number;
  tokenHash: string;
  deviceId: string;
  clientVersion: string;
  date: string;
  tool: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  inputTokenSemantics: "fresh";
  createdAt: string;
};

type TokenRankCollectorState = {
  userId: number;
  tokenHash: string;
  deviceId: string;
  tool: "codex";
  protocolVersion: 2;
  clientVersion: string;
  observedThrough: string;
  lastSync: string;
  snapshotId?: string;
  snapshotDigest?: string;
  snapshotStartDate?: string;
  snapshotEndDate?: string;
  lastAccepted?: number;
  lastReplaced?: number;
};

type TokenRankStore = {
  revision: number;
  users: TokenRankUser[];
  records: TokenRankUsageRecord[];
  collectors: TokenRankCollectorState[];
  lastUploadAt: string;
};

type UploadRecordInput = {
  date?: unknown;
  tool?: unknown;
  model?: unknown;
  inputTokens?: unknown;
  outputTokens?: unknown;
  cacheReadTokens?: unknown;
  cacheWriteTokens?: unknown;
  totalTokens?: unknown;
  inputTokenSemantics?: unknown;
};

type UploadInput = {
  deviceId?: unknown;
  clientVersion?: unknown;
  protocolVersion?: unknown;
  codexMode?: unknown;
  collector?: unknown;
  snapshot?: unknown;
  records?: unknown;
};

type PreparedRecord = {
  date: string;
  tool: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  inputTokenSemantics: "fresh";
};

type PreparedCollector = {
  tool: "codex";
  observedThrough: string;
  observedThroughMs: number;
  startDate: string;
  endDate: string;
};

type PreparedSnapshot = {
  id: string;
  tool: "codex";
  complete: true;
  observedThrough: string;
  startDate: string;
  endDate: string;
  timeZone: "Asia/Shanghai";
};

type PreparedUpload = {
  deviceId: string;
  clientVersion: string;
  protocolVersion: 1 | 2;
  codexMode: "partial" | "partial-backfill" | null;
  collector: PreparedCollector | null;
  snapshot: PreparedSnapshot | null;
  records: PreparedRecord[];
};

type MutationResult<T> = {
  changed: boolean;
  value: T;
};

type AppendTokenRankResult =
  | { ok: false; status: number; message: string }
  | {
      ok: true;
      accepted: number;
      replaced: number;
      merged?: number;
      preserved?: number;
      idempotent?: boolean;
    };

export function isTokenRankStoreConfigured() {
  return Boolean(process.env.TOKEN_RANK_STORE_PATH?.trim()) || process.env.NODE_ENV !== "production";
}

function getStorePath() {
  const configured = process.env.TOKEN_RANK_STORE_PATH?.trim();
  if (configured) return configured;
  if (process.env.NODE_ENV === "production") {
    throw new Error("TOKEN_RANK_STORE_PATH must be configured in production");
  }
  return path.join(process.cwd(), ".logs", "token-rank-store.json");
}

const TOKEN_PREFIX = "znt_trk_";
const LEADERBOARD_LIMIT = 20;
const MAX_UPLOAD_RECORDS = 2000;
const HISTORY_DAYS = 35;
const CACHE_INCLUSIVE_TOOLS = new Set(["codex"]);
export const TOKEN_RANK_COOKIE = "znt_token_rank_token";

export class TokenRankRegistrationError extends Error {
  readonly status: 400 | 409;
  readonly code: "invalid_nickname" | "nickname_taken";

  constructor(
    status: 400 | 409,
    code: "invalid_nickname" | "nickname_taken",
    message: string,
  ) {
    super(message);
    this.name = "TokenRankRegistrationError";
    this.status = status;
    this.code = code;
  }
}

let localMutationQueue = Promise.resolve();

function emptyStore(): TokenRankStore {
  return {
    revision: 0,
    users: [],
    records: [],
    collectors: [],
    lastUploadAt: "",
  };
}

function normalizeStore(raw: unknown): TokenRankStore {
  const store = raw as Partial<TokenRankStore> | null;
  const records = Array.isArray(store?.records)
    ? store.records.map(normalizeStoredRecord)
    : [];
  return {
    revision: Number.isSafeInteger(store?.revision) && Number(store?.revision) >= 0
      ? Number(store?.revision)
      : 0,
    users: Array.isArray(store?.users) ? store.users : [],
    records,
    collectors: Array.isArray(store?.collectors) ? store.collectors : [],
    lastUploadAt: typeof store?.lastUploadAt === "string"
      ? store.lastUploadAt
      : records.reduce(
          (latest, record) => record.createdAt > latest ? record.createdAt : latest,
          "",
        ),
  };
}

function normalizeStoredRecord(record: TokenRankUsageRecord): TokenRankUsageRecord {
  if (record.inputTokenSemantics === "fresh") return record;

  const cacheReadTokens = Math.max(0, Number(record.cacheReadTokens) || 0);
  const cacheWriteTokens = Math.max(0, Number(record.cacheWriteTokens) || 0);
  const rawInputTokens = Math.max(0, Number(record.inputTokens) || 0);
  const inputTokens = CACHE_INCLUSIVE_TOOLS.has(record.tool)
    ? Math.max(0, rawInputTokens - cacheReadTokens - cacheWriteTokens)
    : rawInputTokens;
  const outputTokens = Math.max(0, Number(record.outputTokens) || 0);
  const computedTotal = inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens;

  return {
    ...record,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    totalTokens: computedTotal > 0 ? computedTotal : Math.max(0, Number(record.totalTokens) || 0),
    inputTokenSemantics: "fresh",
  };
}

function storeContent(store: TokenRankStore) {
  return JSON.stringify(store, null, 2);
}

async function readStore(): Promise<TokenRankStore> {
  const storePath = getStorePath();
  if (!fs.existsSync(storePath)) return emptyStore();
  const content = fs.readFileSync(storePath, "utf8");
  return normalizeStore(JSON.parse(content));
}

async function writeStore(store: TokenRankStore) {
  const storePath = getStorePath();
  const content = storeContent(store);
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  const temporary = `${storePath}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  fs.writeFileSync(temporary, content);
  fs.renameSync(temporary, storePath);
}

async function mutateStore<T>(mutation: (store: TokenRankStore) => MutationResult<T>): Promise<T> {
  const run = async () => {
    const store = await readStore();
    const result = mutation(store);
    if (!result.changed) return result.value;
    store.revision += 1;
    await writeStore(store);
    return result.value;
  };

  const queued = localMutationQueue.then(run, run);
  localMutationQueue = queued.then(() => undefined, () => undefined);
  return queued;
}

function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function normalizeTokenRankNickname(value: string | undefined) {
  if (typeof value !== "string") return "";
  return value
    .normalize("NFKC")
    .trim()
    .replace(/\s+/gu, " ")
    .slice(0, 32);
}

function tokenRankNicknameKey(value: string | undefined) {
  return normalizeTokenRankNickname(value).toLowerCase();
}

export function isTokenRankUserActive(user: TokenRankUser) {
  return user.active !== false;
}

function generateToken() {
  return `${TOKEN_PREFIX}${crypto.randomBytes(24).toString("base64url")}`;
}

function toFiniteNumber(value: unknown) {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number) || number < 0) return 0;
  const rounded = Math.round(number);
  return Number.isSafeInteger(rounded) ? rounded : 0;
}

function beijingDateAt(time: number) {
  return new Date(time + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function beijingDate() {
  return beijingDateAt(Date.now());
}

function addDays(date: string, offset: number) {
  const time = new Date(`${date}T00:00:00Z`).getTime() + offset * 86400000;
  return new Date(time).toISOString().slice(0, 10);
}

export type TokenRankRangeKey = "today" | "yesterday" | "day-before" | "3d" | "7d" | "30d";

export function normalizeTokenRankRange(value: string): TokenRankRangeKey | null {
  if (value === "day-before-yesterday") return "day-before";
  if (
    value === "today" ||
    value === "yesterday" ||
    value === "day-before" ||
    value === "3d" ||
    value === "7d" ||
    value === "30d"
  ) {
    return value;
  }
  return null;
}

function dateRange(range: TokenRankRangeKey) {
  const today = beijingDate();
  if (range === "yesterday") return { start: addDays(today, -1), end: addDays(today, -1) };
  if (range === "day-before") return { start: addDays(today, -2), end: addDays(today, -2) };
  if (range === "3d") return { start: addDays(today, -2), end: today };
  if (range === "7d") return { start: addDays(today, -6), end: today };
  if (range === "30d") return { start: addDays(today, -29), end: today };
  return { start: today, end: today };
}

function estimateCost(totalTokens: number) {
  return totalTokens / 1000000 * 0.6;
}

function isCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}

function strictCounter(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

function normalizedTimestamp(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? { iso: new Date(time).toISOString(), time } : null;
}

function normalizeUploadRecord(
  record: UploadRecordInput,
  fallbackDate: string,
  strict: boolean,
): PreparedRecord | null {
  if (!record || typeof record !== "object") return null;
  const tool = typeof record.tool === "string" && record.tool.trim()
    ? record.tool.trim().slice(0, 64)
    : "unknown";
  const strictInput = strictCounter(record.inputTokens);
  const strictOutput = strictCounter(record.outputTokens);
  const strictCacheRead = strictCounter(record.cacheReadTokens);
  const strictCacheWrite = strictCounter(record.cacheWriteTokens);
  const strictTotal = strictCounter(record.totalTokens);
  if (
    strict &&
    (strictInput === null || strictOutput === null || strictCacheRead === null ||
      strictCacheWrite === null || strictTotal === null)
  ) {
    return null;
  }
  const rawInputTokens = strict ? strictInput! : toFiniteNumber(record.inputTokens);
  const outputTokens = strict ? strictOutput! : toFiniteNumber(record.outputTokens);
  const cacheReadTokens = strict ? strictCacheRead! : toFiniteNumber(record.cacheReadTokens);
  const cacheWriteTokens = strict ? strictCacheWrite! : toFiniteNumber(record.cacheWriteTokens);
  const inputTokens = record.inputTokenSemantics === "fresh" || !CACHE_INCLUSIVE_TOOLS.has(tool)
    ? rawInputTokens
    : Math.max(0, rawInputTokens - cacheReadTokens - cacheWriteTokens);
  const computedTotal = inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens;
  if (!Number.isSafeInteger(computedTotal)) return null;
  const explicitTotal = strict ? strictTotal! : toFiniteNumber(record.totalTokens);
  const totalTokens = computedTotal > 0 ? computedTotal : explicitTotal;
  const date = isCalendarDate(record.date)
    ? record.date
    : fallbackDate;
  const model = typeof record.model === "string" && record.model.trim()
    ? record.model.trim().slice(0, 128)
    : "unknown";

  if (strict && (!isCalendarDate(record.date) || tool === "unknown")) return null;
  if (
    strict && tool === "codex" &&
    (record.inputTokenSemantics !== "fresh" || explicitTotal !== computedTotal)
  ) {
    return null;
  }
  if (totalTokens <= 0) return null;

  return {
    date,
    tool,
    model,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    totalTokens,
    inputTokenSemantics: "fresh" as const,
  };
}

function validateUpload(input: UploadInput, nowMs = Date.now()):
  | { ok: true; value: PreparedUpload }
  | { ok: false; message: string } {
  if (!input || typeof input !== "object") return { ok: false, message: "上报内容必须是对象" };
  const protocolVersion = input.protocolVersion === undefined ? 1 : input.protocolVersion;
  if (protocolVersion !== 1 && protocolVersion !== 2) {
    return { ok: false, message: "protocolVersion 只支持 1 或 2" };
  }
  const strict = protocolVersion === 2;
  let codexMode: "partial" | "partial-backfill" | null = null;
  if (input.codexMode !== undefined && input.codexMode !== null) {
    if (
      !strict ||
      (input.codexMode !== "partial" && input.codexMode !== "partial-backfill")
    ) {
      return { ok: false, message: "codexMode 仅支持 v2 partial 或 partial-backfill" };
    }
    codexMode = input.codexMode;
  }
  const deviceId = typeof input.deviceId === "string" ? input.deviceId.trim() : "";
  if (strict && !/^[0-9a-f]{32}$/.test(deviceId)) {
    return { ok: false, message: "v2 deviceId 必须是 32 位小写十六进制字符串" };
  }
  const normalizedDeviceId = deviceId ? deviceId.slice(0, 128) : "unknown-device";
  const clientVersion = typeof input.clientVersion === "string" ? input.clientVersion.trim() : "";
  if (strict && (!clientVersion || clientVersion.length > 32)) {
    return { ok: false, message: "v2 clientVersion 无效" };
  }
  const normalizedClientVersion = clientVersion ? clientVersion.slice(0, 32) : "unknown";
  if (!Array.isArray(input.records)) {
    if (strict) return { ok: false, message: "v2 records 必须是数组" };
  }
  const rawRecords = Array.isArray(input.records) ? input.records : [];
  if (rawRecords.length > MAX_UPLOAD_RECORDS) {
    return { ok: false, message: `单次最多上报 ${MAX_UPLOAD_RECORDS} 条记录` };
  }

  let collector: PreparedCollector | null = null;
  if (input.collector !== undefined && input.collector !== null) {
    if (!strict || typeof input.collector !== "object") {
      return { ok: false, message: "collector 仅支持 v2 对象" };
    }
    const raw = input.collector as Record<string, unknown>;
    const observed = normalizedTimestamp(raw.observedThrough);
    if (raw.tool !== "codex" || !observed) {
      return { ok: false, message: "collector 必须声明 codex 和有效 observedThrough" };
    }
    if (observed.time > nowMs + 5 * 60 * 1000 || observed.time < nowMs - 48 * 60 * 60 * 1000) {
      return { ok: false, message: "collector observedThrough 超出允许时间范围" };
    }
    const endDate = beijingDateAt(observed.time);
    collector = {
      tool: "codex",
      observedThrough: observed.iso,
      observedThroughMs: observed.time,
      startDate: addDays(endDate, -(HISTORY_DAYS - 1)),
      endDate,
    };
  }

  let snapshot: PreparedSnapshot | null = null;
  if (input.snapshot !== undefined && input.snapshot !== null) {
    if (!strict || !collector || typeof input.snapshot !== "object") {
      return { ok: false, message: "snapshot 必须与 v2 collector 同时上报" };
    }
    const raw = input.snapshot as Record<string, unknown>;
    const observed = normalizedTimestamp(raw.observedThrough);
    const id = typeof raw.id === "string" ? raw.id.trim() : "";
    if (!/^[A-Za-z0-9._:-]{1,128}$/.test(id)) {
      return { ok: false, message: "snapshot id 无效" };
    }
    if (
      raw.tool !== "codex" || raw.complete !== true || raw.timeZone !== "Asia/Shanghai" ||
      !observed || observed.iso !== collector.observedThrough
    ) {
      return { ok: false, message: "snapshot 的工具、完整性、时区或高水位无效" };
    }
    if (
      !isCalendarDate(raw.startDate) || !isCalendarDate(raw.endDate) ||
      raw.startDate !== collector.startDate || raw.endDate !== collector.endDate
    ) {
      return { ok: false, message: `snapshot 必须覆盖 ${HISTORY_DAYS} 个北京时间自然日` };
    }
    snapshot = {
      id,
      tool: "codex",
      complete: true,
      observedThrough: observed.iso,
      startDate: raw.startDate,
      endDate: raw.endDate,
      timeZone: "Asia/Shanghai",
    };
  }

  const fallbackDate = beijingDateAt(nowMs);
  const records: PreparedRecord[] = [];
  const keys = new Set<string>();
  for (const rawRecord of rawRecords) {
    const uploadRecord = rawRecord as UploadRecordInput;
    if (
      !uploadRecord || typeof uploadRecord !== "object" || !isCalendarDate(uploadRecord.date) ||
      strictCounter(uploadRecord.inputTokens) === null || strictCounter(uploadRecord.outputTokens) === null ||
      strictCounter(uploadRecord.cacheReadTokens) === null ||
      strictCounter(uploadRecord.cacheWriteTokens) === null || strictCounter(uploadRecord.totalTokens) === null
    ) {
      return { ok: false, message: "records 含有无效日期、字段或 token 数值" };
    }
    const record = normalizeUploadRecord(uploadRecord, fallbackDate, strict);
    if (!record) {
      if (strict) return { ok: false, message: "v2 records 含有无效日期、字段或 token 数值" };
      continue;
    }
    const key = JSON.stringify([record.date, record.tool, record.model]);
    if (keys.has(key)) return { ok: false, message: "records 存在重复日期、工具和模型" };
    keys.add(key);
    records.push(record);
  }

  const codexRecords = records.filter((record) => record.tool === "codex");
  if (strict && codexRecords.length > 0 && !collector && codexMode === null) {
    return { ok: false, message: "v2 Codex records 必须带 collector" };
  }
  if (codexMode === "partial") {
    if (collector || snapshot) {
      return { ok: false, message: "partial Codex 上报不能携带 collector 或 snapshot" };
    }
    const partialDates = new Set(codexRecords.map((record) => record.date));
    const allowedDates = new Set([fallbackDate, addDays(fallbackDate, -1)]);
    if (partialDates.size > 1 || [...partialDates].some((date) => !allowedDates.has(date))) {
      return { ok: false, message: "partial Codex 上报仅允许北京时间今日或昨日的单日记录" };
    }
  }
  if (codexMode === "partial-backfill") {
    if (collector || snapshot) {
      return { ok: false, message: "partial-backfill Codex 上报不能携带 collector 或 snapshot" };
    }
    if (records.length === 0 || codexRecords.length !== records.length) {
      return { ok: false, message: "partial-backfill 必须包含至少一条且只能包含 Codex 记录" };
    }
    const startDate = addDays(fallbackDate, -(HISTORY_DAYS - 1));
    const endDate = addDays(fallbackDate, -1);
    if (codexRecords.some((record) => record.date < startDate || record.date > endDate)) {
      return {
        ok: false,
        message: `partial-backfill 仅允许 ${startDate} 至 ${endDate} 的历史记录`,
      };
    }
  }
  if (
    collector && codexRecords.some(
      (record) => record.date < collector.startDate || record.date > collector.endDate,
    )
  ) {
    return { ok: false, message: "Codex records 超出 collector 的 35 日窗口" };
  }

  return {
    ok: true,
    value: {
      deviceId: normalizedDeviceId,
      clientVersion: normalizedClientVersion,
      protocolVersion,
      codexMode,
      collector,
      snapshot,
      records,
    },
  };
}

function generateUserId(users: TokenRankUser[]) {
  let userId = 0;
  do {
    userId = crypto.randomBytes(6).readUIntBE(0, 6);
  } while (userId === 0 || users.some((user) => user.userId === userId));
  return userId;
}

export async function createTokenRankUser(input: { name: string; role?: string }) {
  const name = normalizeTokenRankNickname(input.name);
  if (!name) {
    throw new TokenRankRegistrationError(400, "invalid_nickname", "请填写昵称后再生成专属命令");
  }

  const nicknameKey = tokenRankNicknameKey(name);
  const now = new Date().toISOString();
  const token = generateToken();
  const tokenHash = hashToken(token);
  const user = await mutateStore((store) => {
    const existing = store.users.find((candidate) => candidate.tokenHash === tokenHash);
    if (existing) return { changed: false, value: existing };
    if (store.users.some(
      (candidate) => isTokenRankUserActive(candidate) && tokenRankNicknameKey(candidate.name) === nicknameKey,
    )) {
      return { changed: false, value: null };
    }
    const created: TokenRankUser = {
      userId: generateUserId(store.users),
      tokenHash,
      name,
      role: input.role?.trim().slice(0, 32) || "自助上榜用户",
      createdAt: now,
      active: true,
    };
    store.users.push(created);
    return { changed: true, value: created };
  });

  if (!user) {
    throw new TokenRankRegistrationError(
      409,
      "nickname_taken",
      "该昵称已被使用，请更换昵称后再生成专属命令",
    );
  }

  return { user, token };
}

export async function findTokenRankUser(token: string) {
  if (!token.startsWith(TOKEN_PREFIX)) return null;
  const tokenHash = hashToken(token);
  const store = await readStore();
  return store.users.find((user) => user.tokenHash === tokenHash) ?? null;
}

export async function appendTokenRankUsage(
  token: string,
  input: UploadInput,
): Promise<AppendTokenRankResult> {
  if (!token.startsWith(TOKEN_PREFIX)) {
    return { ok: false as const, status: 401, message: "上报 token 无效" };
  }
  const validation = validateUpload(input);
  if (!validation.ok) {
    return { ok: false as const, status: 400, message: validation.message };
  }
  const prepared = validation.value;
  const tokenHash = hashToken(token);
  const snapshotDigest = prepared.snapshot
    ? crypto.createHash("sha256").update(JSON.stringify({
        snapshot: prepared.snapshot,
        records: [...prepared.records].sort((a, b) =>
          JSON.stringify([a.date, a.tool, a.model]).localeCompare(
            JSON.stringify([b.date, b.tool, b.model]),
          )),
      })).digest("hex")
    : "";

  return mutateStore<AppendTokenRankResult>((store) => {
    const commitTime = new Date().toISOString();
    const user = store.users.find((candidate) => candidate.tokenHash === tokenHash);
    if (!user) {
      return {
        changed: false,
        value: { ok: false as const, status: 401, message: "上报 token 无效" },
      };
    }
    if (!isTokenRankUserActive(user)) {
      return {
        changed: false,
        value: { ok: false as const, status: 410, message: "此专属命令已停用，请使用保留的客户端" },
      };
    }

    const collectorIndex = store.collectors.findIndex((state) =>
      state.tokenHash === tokenHash &&
      state.deviceId === prepared.deviceId &&
      state.tool === "codex"
    );
    const previousCollector = collectorIndex >= 0 ? store.collectors[collectorIndex] : null;
    const hasCodex = prepared.records.some((record) => record.tool === "codex");

    if (prepared.protocolVersion === 1 && hasCodex && previousCollector) {
      return {
        changed: false,
        value: { ok: false as const, status: 409, message: "该设备已升级至 Codex v2，拒绝旧版覆盖" },
      };
    }
    if (prepared.snapshot && previousCollector?.snapshotId === prepared.snapshot.id) {
      if (previousCollector.snapshotDigest !== snapshotDigest) {
        return {
          changed: false,
          value: { ok: false as const, status: 409, message: "snapshot id 已被不同内容使用" },
        };
      }
      return {
        changed: false,
        value: {
          ok: true as const,
          accepted: previousCollector.lastAccepted ?? prepared.records.length,
          replaced: previousCollector.lastReplaced ?? 0,
          idempotent: true,
        },
      };
    }
    if (
      prepared.collector && previousCollector &&
      prepared.collector.observedThrough < previousCollector.observedThrough
    ) {
      return {
        changed: false,
        value: { ok: false as const, status: 409, message: "Codex 快照早于已接收的高水位" },
      };
    }

    const incomingScopes = new Set(
      prepared.records
        .filter((record) => (
          !(prepared.snapshot && record.tool === "codex")
          && !(prepared.codexMode === "partial" && record.tool === "codex")
          && !(prepared.codexMode === "partial-backfill" && record.tool === "codex")
        ))
        .map((record) => JSON.stringify([
          tokenHash,
          prepared.deviceId,
          record.date,
          record.tool,
        ])),
    );
    const beforeCount = store.records.length;
    store.records = store.records.filter((record) => {
      if (record.tokenHash !== tokenHash || record.deviceId !== prepared.deviceId) return true;
      if (
        prepared.snapshot && record.tool === "codex" &&
        record.date >= prepared.snapshot.startDate && record.date <= prepared.snapshot.endDate
      ) {
        return false;
      }
      const scope = JSON.stringify([
        tokenHash,
        prepared.deviceId,
        record.date,
        record.tool,
      ]);
      return !incomingScopes.has(scope);
    });
    let replaced = beforeCount - store.records.length;
    const incomingRecords: TokenRankUsageRecord[] = prepared.records.map((record) => ({
      ...record,
      userId: user.userId,
      tokenHash,
      deviceId: prepared.deviceId,
      clientVersion: prepared.clientVersion,
      createdAt: commitTime,
    }));
    const regularRecords = incomingRecords.filter(
      (record) => (
        (prepared.codexMode !== "partial" && prepared.codexMode !== "partial-backfill")
        || record.tool !== "codex"
      ),
    );
    store.records.push(...regularRecords);

    let merged = 0;
    let preserved = 0;
    const counters = ["inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens"] as const;
    const summarize = (items: TokenRankUsageRecord[]) => Object.fromEntries(
      counters.map((counter) => [
        counter,
        items.reduce((sum, record) => sum + record[counter], 0),
      ]),
    ) as Record<(typeof counters)[number], number>;
    if (prepared.codexMode === "partial") {
      const partialRecords = incomingRecords.filter((record) => record.tool === "codex");
      if (partialRecords.length > 0) {
        const partialDate = partialRecords[0].date;
        const existingRecords = store.records.filter((record) =>
          record.tokenHash === tokenHash
          && record.deviceId === prepared.deviceId
          && record.date === partialDate
          && record.tool === "codex"
        );
        const incomingTotals = summarize(partialRecords);
        const existingTotals = summarize(existingRecords);
        const dominates = counters.every(
          (counter) => incomingTotals[counter] >= existingTotals[counter],
        );
        const advances = counters.some(
          (counter) => incomingTotals[counter] > existingTotals[counter],
        );

        if (dominates && advances) {
          store.records = store.records.filter((record) => !(
            record.tokenHash === tokenHash
            && record.deviceId === prepared.deviceId
            && record.date === partialDate
            && record.tool === "codex"
          ));
          store.records.push(...partialRecords);
          replaced += existingRecords.length;
          merged = partialRecords.length;
        } else {
          preserved = partialRecords.length;
        }
      }
    }
    if (prepared.codexMode === "partial-backfill") {
      const recordsByDate = new Map<string, TokenRankUsageRecord[]>();
      for (const record of incomingRecords) {
        const dateRecords = recordsByDate.get(record.date) ?? [];
        dateRecords.push(record);
        recordsByDate.set(record.date, dateRecords);
      }

      for (const [date, dateRecords] of recordsByDate) {
        const existingDateRecords = store.records.filter((record) =>
          record.tokenHash === tokenHash
          && record.deviceId === prepared.deviceId
          && record.date === date
          && record.tool === "codex"
        );
        const dateCoveredBySnapshot = Boolean(
          previousCollector?.snapshotStartDate
          && previousCollector.snapshotEndDate
          && date >= previousCollector.snapshotStartDate
          && date <= previousCollector.snapshotEndDate,
        );
        const incomingTotals = summarize(dateRecords);
        const existingTotals = summarize(existingDateRecords);
        const dominates = counters.every(
          (counter) => incomingTotals[counter] >= existingTotals[counter],
        );
        const advances = counters.some(
          (counter) => incomingTotals[counter] > existingTotals[counter],
        );

        if (dateCoveredBySnapshot || !dominates || !advances) {
          preserved += dateRecords.length;
        } else {
          store.records = store.records.filter((record) => !(
            record.tokenHash === tokenHash
            && record.deviceId === prepared.deviceId
            && record.date === date
            && record.tool === "codex"
          ));
          store.records.push(...dateRecords);
          replaced += existingDateRecords.length;
          merged += dateRecords.length;
        }
      }
    }

    if (prepared.collector) {
      const collector: TokenRankCollectorState = {
        ...(previousCollector ?? {}),
        userId: user.userId,
        tokenHash,
        deviceId: prepared.deviceId,
        tool: "codex",
        protocolVersion: 2,
        clientVersion: prepared.clientVersion,
        observedThrough: prepared.collector.observedThrough,
        lastSync: commitTime,
        ...(prepared.snapshot
          ? {
              snapshotId: prepared.snapshot.id,
              snapshotDigest,
              snapshotStartDate: prepared.snapshot.startDate,
              snapshotEndDate: prepared.snapshot.endDate,
              lastAccepted: incomingRecords.length,
              lastReplaced: replaced,
            }
          : {}),
      };
      if (collectorIndex >= 0) store.collectors[collectorIndex] = collector;
      else store.collectors.push(collector);
    }
    const changed = regularRecords.length > 0 || merged > 0 || Boolean(prepared.collector);
    if (changed) store.lastUploadAt = commitTime;

    return {
      changed,
      value: {
        ok: true as const,
        accepted: incomingRecords.length,
        replaced,
        ...(prepared.codexMode !== null ? { merged, preserved } : {}),
      },
    };
  });
}

function summarizeRecords(records: TokenRankUsageRecord[]) {
  const total = records.reduce((sum, record) => sum + record.totalTokens, 0);
  const norm = records.reduce(
    (sum, record) => sum + record.inputTokens + record.outputTokens,
    0,
  );
  const devices = new Set(records.map((record) => record.deviceId));
  const dates = new Set(records.map((record) => record.date));
  const lastSync = records.reduce(
    (latest, record) => record.createdAt > latest ? record.createdAt : latest,
    "",
  );
  const byTool = records.reduce<Record<string, number>>((acc, record) => {
    acc[record.tool] = (acc[record.tool] ?? 0) + record.totalTokens;
    return acc;
  }, {});
  const byModel = records.reduce<Record<string, number>>((acc, record) => {
    acc[record.model] = (acc[record.model] ?? 0) + record.totalTokens;
    return acc;
  }, {});

  return {
    total,
    norm,
    cost: estimateCost(total),
    activeDays: dates.size,
    deviceCount: devices.size,
    lastSync,
    byTool,
    byModel,
  };
}

function publicProfileStats(summary: ReturnType<typeof summarizeRecords>, lastSync: string) {
  return {
    total: summary.total,
    norm: summary.norm,
    cost: summary.cost,
    activeDays: summary.activeDays,
    deviceCount: summary.deviceCount,
    lastSync: lastSync > summary.lastSync ? lastSync : summary.lastSync,
  };
}

function aggregateDailyPublicProfile(records: TokenRankUsageRecord[]): TokenRankPublicProfileDaily[] {
  const grouped = new Map<string, { total: number; norm: number }>();
  for (const record of records) {
    const current = grouped.get(record.date) ?? { total: 0, norm: 0 };
    current.total += record.totalTokens;
    current.norm += record.inputTokens + record.outputTokens;
    grouped.set(record.date, current);
  }

  return [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, values]) => ({
      date,
      total: values.total,
      norm: values.norm,
      cost: estimateCost(values.total),
    }));
}

export async function getTokenRankPublicProfile(userId: number): Promise<TokenRankPublicProfile | null> {
  if (!Number.isSafeInteger(userId) || userId <= 0) return null;

  const store = await readStore();
  const user = store.users.find((candidate) => candidate.userId === userId);
  if (!user || !isTokenRankUserActive(user)) return null;

  const records = store.records.filter((record) => record.tokenHash === user.tokenHash);
  const collectorLastSync = store.collectors.reduce(
    (latest, state) => state.tokenHash === user.tokenHash && state.lastSync > latest
      ? state.lastSync
      : latest,
    "",
  );
  const today = beijingDate();
  const totals = summarizeRecords(records);
  const todayTotals = summarizeRecords(records.filter((record) => record.date === today));

  return {
    user: {
      userId: user.userId,
      name: user.name,
      role: user.role,
    },
    today,
    totals: publicProfileStats(totals, collectorLastSync),
    todayTotals: publicProfileStats(todayTotals, collectorLastSync),
    byTool: totals.byTool,
    byModel: totals.byModel,
    daily: aggregateDailyPublicProfile(records),
  };
}

export async function getTokenRankMe(token: string) {
  if (!token.startsWith(TOKEN_PREFIX)) return null;
  const tokenHash = hashToken(token);
  const store = await readStore();
  const user = store.users.find((candidate) => candidate.tokenHash === tokenHash);
  if (!user) return null;
  const records = store.records.filter((record) => record.tokenHash === tokenHash);
  const collectorLastSync = store.collectors.reduce(
    (latest, state) => state.tokenHash === tokenHash && state.lastSync > latest
      ? state.lastSync
      : latest,
    "",
  );
  const today = beijingDate();
  const todayRecords = records.filter((record) => record.date === today);
  const totals = summarizeRecords(records);
  const todayTotals = summarizeRecords(todayRecords);

  return {
    user,
    today,
    totals: { ...totals, lastSync: collectorLastSync > totals.lastSync ? collectorLastSync : totals.lastSync },
    todayTotals: {
      ...todayTotals,
      lastSync: collectorLastSync > todayTotals.lastSync ? collectorLastSync : todayTotals.lastSync,
    },
  };
}

export async function getTokenRankLeaderboard(params: {
  board?: string;
  range?: string;
  metric?: "total" | "norm" | "cost";
}) {
  const store = await readStore();
  const board = params.board || "total";
  const range = normalizeTokenRankRange(params.range || "today") ?? "today";
  const metric = params.metric || "total";
  const { start, end } = dateRange(range);
  const records = store.records.filter((record) => record.date >= start && record.date <= end);
  const activeUsers = store.users.filter(isTokenRankUserActive);
  const usersByTokenHash = new Map(activeUsers.map((user) => [user.tokenHash, user]));
  const grouped = new Map<string, {
    user: TokenRankUser;
    total: number;
    norm: number;
    byTool: Record<string, number>;
    byModel: Record<string, number>;
    devices: Set<string>;
    dates: Set<string>;
  }>();

  for (const record of records) {
    if (board !== "total" && record.tool !== board) continue;
    const user = usersByTokenHash.get(record.tokenHash);
    if (!user) continue;
    const current = grouped.get(user.tokenHash) ?? {
      user,
      total: 0,
      norm: 0,
      byTool: {},
      byModel: {},
      devices: new Set<string>(),
      dates: new Set<string>(),
    };
    current.total += record.totalTokens;
    current.norm += record.inputTokens + record.outputTokens;
    current.byTool[record.tool] = (current.byTool[record.tool] ?? 0) + record.totalTokens;
    current.byModel[record.model] = (current.byModel[record.model] ?? 0) + record.totalTokens;
    current.devices.add(record.deviceId);
    current.dates.add(record.date);
    grouped.set(user.tokenHash, current);
  }

  const liveEntries: TokenRankEntry[] = activeUsers.map((user) => {
    const item = grouped.get(user.tokenHash);
    return {
      rank: 0,
      userId: user.userId,
      name: user.name,
      role: user.role,
      score: item?.total ?? 0,
      norm: item?.norm ?? 0,
      cost: estimateCost(item?.total ?? 0),
      streakDays: item?.dates.size ?? 0,
      deviceCount: item?.devices.size ?? 0,
      anomaly: false,
      byTool: item?.byTool ?? {},
      byModel: item?.byModel ?? {},
    };
  });

  const aggregate = liveEntries.reduce(
    (sum, entry) => {
      const boardScore = board === "total" ? entry.score : (entry.byTool[board] ?? 0);
      const ratio = entry.score > 0 ? boardScore / entry.score : 0;
      sum.total += boardScore;
      sum.norm += board === "total" ? entry.norm : entry.norm * ratio;
      sum.cost += board === "total" ? entry.cost : entry.cost * ratio;
      return sum;
    },
    { total: 0, norm: 0, cost: 0 },
  );

  const sorted = liveEntries
    .sort((a, b) => {
      const aBoardRatio = board === "total" ? 1 : a.score > 0 ? (a.byTool[board] ?? 0) / a.score : 0;
      const bBoardRatio = board === "total" ? 1 : b.score > 0 ? (b.byTool[board] ?? 0) / b.score : 0;
      const aValue = metric === "cost"
        ? a.cost * aBoardRatio
        : metric === "norm"
          ? a.norm * aBoardRatio
          : board === "total" ? a.score : (a.byTool[board] ?? 0);
      const bValue = metric === "cost"
        ? b.cost * bBoardRatio
          : metric === "norm"
            ? b.norm * bBoardRatio
            : board === "total" ? b.score : (b.byTool[board] ?? 0);
      if (bValue !== aValue) return bValue - aValue;
      return a.userId - b.userId;
    })
    .slice(0, LEADERBOARD_LIMIT)
    .map((entry, index) => {
      if (board === "total") return { ...entry, rank: index + 1 };
      const boardScore = entry.byTool[board] ?? 0;
      const ratio = entry.score > 0 ? boardScore / entry.score : 0;
      return {
        ...entry,
        rank: index + 1,
        score: boardScore,
        norm: Math.round(entry.norm * ratio),
        cost: entry.cost * ratio,
      };
    });

  return {
    status: 0,
    board,
    range,
    metric,
    entries: sorted,
    aggregate,
    totalMembers: activeUsers.length,
    updatedAt: store.lastUploadAt,
  };
}

export function extractBearerToken(headers: Headers) {
  const authorization = headers.get("authorization") ?? "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? "";
}
