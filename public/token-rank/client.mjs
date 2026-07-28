#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";

const VERSION = "0.2.0";
const CONFIG_DIR = process.env.ZNT_TOKENRANK_HOME || path.join(os.homedir(), ".znt-tokenrank");
const CONFIG_PATH = path.join(CONFIG_DIR, "config.json");
const CODEX_CACHE_PATH = path.join(CONFIG_DIR, "codex-usage-cache-v6.json.gz");
const CODEX_CACHE_VERSION = 6;
const HISTORY_DAYS = 35;
const MAX_FILE_SIZE = 8 * 1024 * 1024;
const MAX_FILES_PER_TOOL = 320;
const LOOKBACK_MS = 35 * 24 * 60 * 60 * 1000;
const UUID_SUFFIX_RE = /([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.jsonl$/i;

const CODEX_DIRS = ["~/.codex/sessions", "~/.codex/archived_sessions"];

const TOOL_SOURCES = [
  { tool: "claude-code", dirs: ["~/.claude/projects"] },
  { tool: "cursor", dirs: ["~/Library/Application Support/Cursor/User/globalStorage", "~/.cursor"] },
  { tool: "gemini", dirs: ["~/.gemini"] },
  { tool: "kimi", dirs: ["~/.kimi", "~/Library/Application Support/Kimi"] },
  { tool: "qwen", dirs: ["~/.qwen"] },
  { tool: "opencode", dirs: ["~/.opencode"] },
  { tool: "cline", dirs: ["~/Library/Application Support/Code/User/globalStorage", "~/Library/Application Support/Cursor/User/globalStorage"] },
  { tool: "roo-code", dirs: ["~/Library/Application Support/Code/User/globalStorage", "~/Library/Application Support/Cursor/User/globalStorage"] },
  { tool: "kilo-code", dirs: ["~/Library/Application Support/Code/User/globalStorage", "~/Library/Application Support/Cursor/User/globalStorage"] },
  { tool: "copilot-cli", dirs: ["~/.github-copilot", "~/.config/github-copilot"] },
  { tool: "amp", dirs: ["~/.amp"] },
  { tool: "grok", dirs: ["~/.grok"] },
  { tool: "minimax", dirs: ["~/.minimax"] },
  { tool: "codebuddy", dirs: ["~/.codebuddy"] },
  { tool: "antigravity", dirs: ["~/.antigravity"] },
  { tool: "hermes", dirs: ["~/.hermes"] },
  { tool: "openclaw", dirs: ["~/.openclaw"] },
  { tool: "workbuddy", dirs: ["~/.workbuddy"] },
  { tool: "zcode", dirs: ["~/.zcode"] },
  { tool: "droid", dirs: ["~/.droid"] },
  { tool: "kiro", dirs: ["~/.kiro"] },
  { tool: "reasonix", dirs: ["~/.reasonix"] },
];

function expandHome(value) {
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
  return value;
}

function todayFromTime(time) {
  return new Date(time + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function addDays(date, offset) {
  const time = Date.parse(`${date}T00:00:00Z`) + offset * 24 * 60 * 60 * 1000;
  return new Date(time).toISOString().slice(0, 10);
}

export function codexHistoryWindow(nowMs = Date.now()) {
  const endDate = todayFromTime(nowMs);
  return {
    startDate: addDays(endDate, -(HISTORY_DAYS - 1)),
    endDate,
    tools: ["codex"],
  };
}

function beijingDayStartMs(date) {
  return Date.parse(`${date}T00:00:00Z`) - 8 * 60 * 60 * 1000;
}

function readConfig() {
  if (!fs.existsSync(CONFIG_PATH)) return null;
  return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
}

function stageConfig(next) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(CONFIG_DIR, 0o700);
  } catch {
    // Some Windows filesystems do not expose POSIX modes.
  }
  const temporary = `${CONFIG_PATH}.${process.pid}.pending`;
  fs.writeFileSync(temporary, JSON.stringify(next, null, 2), { mode: 0o600 });
  try {
    fs.chmodSync(temporary, 0o600);
  } catch {
    // Some Windows filesystems do not expose POSIX modes.
  }

  return {
    commit() {
      try {
        fs.renameSync(temporary, CONFIG_PATH);
      } catch {
        fs.copyFileSync(temporary, CONFIG_PATH);
        fs.unlinkSync(temporary);
      }
      try {
        fs.chmodSync(CONFIG_PATH, 0o600);
      } catch {
        // Some Windows filesystems do not expose POSIX modes.
      }
    },
    discard() {
      try {
        fs.unlinkSync(temporary);
      } catch {
        // Nothing to discard.
      }
    },
  };
}

function getArg(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return "";
  return process.argv[index + 1] || "";
}

function isPlaceholderToken(value) {
  return !value || value.includes("xxx") || value.includes("your_private_token");
}

function prepareConfig() {
  const token = getArg("--token");
  const endpoint = getArg("--endpoint");
  const existing = readConfig() || {};
  const deviceId = existing.deviceId || crypto.randomBytes(16).toString("hex");
  const next = {
    ...existing,
    token: token || existing.token,
    endpoint: endpoint || existing.endpoint,
    deviceId,
  };

  if (isPlaceholderToken(next.token) || !next.endpoint) {
    throw new Error("缺少真实专属令牌。请先在 Token 消耗榜页面点击「生成命令」，不要运行 znt_trk_xxx_your_private_token 占位命令。");
  }

  return next;
}

function walkRecentFiles(root, out = []) {
  if (out.length >= MAX_FILES_PER_TOOL) return out;
  let items = [];

  try {
    items = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return out;
  }

  const recentItems = [];

  for (const item of items) {
    if (item.name.startsWith(".git")) continue;
    const full = path.join(root, item.name);

    try {
      const stat = fs.statSync(full);
      if (Date.now() - stat.mtimeMs > LOOKBACK_MS) continue;
      recentItems.push({ item, full, stat });
    } catch {
      // Ignore locked app databases and transient files.
    }
  }

  recentItems.sort((a, b) => {
    if (a.item.isDirectory() !== b.item.isDirectory()) return a.item.isDirectory() ? -1 : 1;
    return b.stat.mtimeMs - a.stat.mtimeMs;
  });

  for (const { item, full, stat } of recentItems) {
    if (out.length >= MAX_FILES_PER_TOOL) break;

    try {
      if (item.isDirectory()) {
        walkRecentFiles(full, out);
      } else if (item.isFile() && stat.size > 0 && stat.size <= MAX_FILE_SIZE && /\.(jsonl?|log|txt)$/i.test(item.name)) {
        out.push({ file: full, mtimeMs: stat.mtimeMs });
      }
    } catch {
      // Ignore locked app databases and transient files.
    }
  }

  return out;
}

function walkCodexFiles(root, out = [], diagnostics = null) {
  let items = [];

  try {
    items = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    if (diagnostics) diagnostics.scanErrors += 1;
    return out;
  }

  for (const item of items) {
    const full = path.join(root, item.name);
    try {
      if (item.isDirectory()) {
        walkCodexFiles(full, out, diagnostics);
      } else if (item.isFile() && item.name.endsWith(".jsonl")) {
        const stat = fs.statSync(full);
        if (stat.size > 0) {
          out.push({ file: full, mtimeMs: stat.mtimeMs, size: stat.size });
        }
      }
    } catch {
      if (diagnostics) diagnostics.scanErrors += 1;
      // Ignore files that are moved or archived while the collector is scanning.
    }
  }

  return out;
}

function threadIdFromPath(file) {
  return file.match(UUID_SUFFIX_RE)?.[1]?.toLowerCase() || "";
}

function uuidV7Time(value) {
  const compact = String(value || "").toLowerCase().replaceAll("-", "");
  if (!/^[0-9a-f]{12}7[0-9a-f]{19}$/.test(compact)) return null;
  const time = Number.parseInt(compact.slice(0, 12), 16);
  return Number.isSafeInteger(time) ? time : null;
}

function preferCodexFile(current, candidate) {
  if (!current) return candidate;
  if (candidate.size !== current.size) return candidate.size > current.size ? candidate : current;
  return candidate.mtimeMs > current.mtimeMs ? candidate : current;
}

function normalizeCodexModel(value) {
  let model = String(value || "unknown").toLowerCase();
  if (model.includes("/")) model = model.slice(model.lastIndexOf("/") + 1);
  model = model.replace(/-\d{4}-\d{2}-\d{2}$/, "").replace(/-\d{8}$/, "");
  return model.slice(0, 128) || "unknown";
}

function optionalCounter(value, keys) {
  if (!value || typeof value !== "object") return null;
  for (const key of keys) {
    if (!(key in value)) continue;
    const number = Number(value[key]);
    if (Number.isFinite(number) && number >= 0) return Math.round(number);
  }
  return null;
}

function codexCounters(value) {
  if (!value || typeof value !== "object") return null;
  return {
    input: optionalCounter(value, ["input_tokens", "prompt_tokens"]),
    cacheRead: optionalCounter(value, [
      "cached_input_tokens",
      "cache_read_input_tokens",
      "cached_tokens",
    ]),
    cacheWrite: optionalCounter(value, [
      "cache_write_input_tokens",
      "cache_creation_input_tokens",
      "cache_write_tokens",
    ]),
    output: optionalCounter(value, ["output_tokens", "completion_tokens"]),
    reasoning: optionalCounter(value, ["reasoning_output_tokens", "reasoning_tokens"]),
    total: optionalCounter(value, ["total_tokens"]),
  };
}

function countersSignature(value) {
  const counters = codexCounters(value);
  if (!counters) return null;
  return [
    counters.input,
    counters.cacheRead,
    counters.cacheWrite,
    counters.output,
    counters.reasoning,
    counters.total,
  ];
}

function codexUsageSignature(info) {
  const total = countersSignature(info?.total_token_usage);
  const last = countersSignature(info?.last_token_usage);
  return total || last ? JSON.stringify([total, last]) : "";
}

function counterValue(value) {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function cumulativeDelta(previous, current) {
  const delta = {};
  for (const key of ["input", "cacheRead", "cacheWrite", "output"]) {
    const value = counterValue(current[key]);
    delta[key] = previous ? Math.max(0, value - counterValue(previous[key])) : value;
  }
  return delta;
}

function normalizeCodexDelta(delta) {
  const rawInput = counterValue(delta.input);
  const cacheRead = Math.min(counterValue(delta.cacheRead), rawInput);
  const cacheWrite = Math.min(counterValue(delta.cacheWrite), rawInput - cacheRead);
  const inputTokens = rawInput - cacheRead - cacheWrite;
  const outputTokens = counterValue(delta.output);

  return {
    inputTokens,
    outputTokens,
    cacheReadTokens: cacheRead,
    cacheWriteTokens: cacheWrite,
    totalTokens: inputTokens + outputTokens + cacheRead + cacheWrite,
  };
}

function parentFromSessionMeta(payload) {
  const forked = typeof payload?.forked_from_id === "string" ? payload.forked_from_id : "";
  const direct = typeof payload?.parent_thread_id === "string" ? payload.parent_thread_id : "";
  const spawned = typeof payload?.source?.subagent?.thread_spawn?.parent_thread_id === "string"
    ? payload.source.subagent.thread_spawn.parent_thread_id
    : "";
  const candidates = [...new Set([forked, direct, spawned].filter(Boolean).map((value) => value.toLowerCase()))];
  const spawnedSubagent = Boolean(payload?.source?.subagent) || payload?.thread_source === "subagent";

  if (candidates.length > 1) {
    return { parentId: "", spawnedSubagent, invalidReason: "fork parent metadata disagrees" };
  }
  const parentId = candidates[0] || "";
  if (parentId && !/^[0-9a-f-]{36}$/.test(parentId)) {
    return { parentId: "", spawnedSubagent, invalidReason: "fork parent id is invalid" };
  }
  return { parentId, spawnedSubagent, invalidReason: "" };
}

export async function parseCodexFile(item) {
  const rootThreadId = threadIdFromPath(item.file);
  const input = fs.createReadStream(item.file, { encoding: "utf8" });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  let rootMetaSeen = false;
  let rootTimestampMs = null;
  let parentId = "";
  let spawnedSubagent = false;
  let subagentBoundarySeen = false;
  let uuidForkBoundaryMs = null;
  let invalidReason = rootThreadId ? "" : "rollout filename has no thread id";
  let currentModel = "unknown";
  let previousTotal = null;
  let maxTimestampMs = null;
  let parseErrors = 0;
  let counterErrors = 0;
  let timestampErrors = 0;
  let unsupportedUsageEvents = 0;
  let countersReset = false;
  let rawTokenEvents = 0;
  let terminalTotalSignature = "";
  const events = [];

  for await (const line of lines) {
    const isSessionMeta = line.includes('"session_meta"');
    const isTurnContext = line.includes('"turn_context"');
    const isTokenCount = line.includes('"event_msg"') && line.includes('"token_count"');
    const isSubagentBoundary = line.includes('"inter_agent_communication_metadata"');
    if (!isSessionMeta && !isTurnContext && !isTokenCount && !isSubagentBoundary) continue;

    let value;
    try {
      value = JSON.parse(line);
    } catch {
      parseErrors += 1;
      continue;
    }

    const timestampMs = Date.parse(value?.timestamp || "");
    if (Number.isFinite(timestampMs)) {
      maxTimestampMs = maxTimestampMs === null ? timestampMs : Math.max(maxTimestampMs, timestampMs);
    }

    if (value?.type === "session_meta" && !rootMetaSeen) {
      rootMetaSeen = true;
      rootTimestampMs = Number.isFinite(timestampMs) ? timestampMs : null;
      const payload = value.payload || {};
      const metaId = String(payload.id || payload.thread_id || payload.threadId || "").toLowerCase();
      if (metaId && rootThreadId && metaId !== rootThreadId) {
        invalidReason = "rollout filename and root session id disagree";
      }
      const parent = parentFromSessionMeta(payload);
      parentId = parent.parentId;
      spawnedSubagent = parent.spawnedSubagent;
      invalidReason ||= parent.invalidReason;
      if (parentId && parentId === rootThreadId) invalidReason = "rollout points to itself as parent";
      continue;
    }

    if (
      value?.type === "inter_agent_communication_metadata"
      && value?.payload?.trigger_turn
    ) {
      subagentBoundarySeen = true;
      continue;
    }

    if (value?.type === "turn_context") {
      const turnTime = uuidV7Time(value?.payload?.turn_id || value?.payload?.turnId);
      const rootThreadTime = uuidV7Time(rootThreadId);
      if (
        parentId
        && turnTime !== null
        && rootThreadTime !== null
        && turnTime >= rootThreadTime
      ) {
        uuidForkBoundaryMs = uuidForkBoundaryMs === null
          ? turnTime
          : Math.min(uuidForkBoundaryMs, turnTime);
      }
      const model = value?.payload?.model || value?.payload?.info?.model;
      if (model) currentModel = normalizeCodexModel(model);
      continue;
    }

    if (value?.type !== "event_msg" || value?.payload?.type !== "token_count") continue;
    rawTokenEvents += 1;
    const info = value?.payload?.info;
    const signature = codexUsageSignature(info);
    if (!signature) continue;

    const model = info?.model || info?.model_name || value?.payload?.model;
    if (model) currentModel = normalizeCodexModel(model);

    const total = codexCounters(info?.total_token_usage);
    const last = codexCounters(info?.last_token_usage);
    if (!total) {
      if (last) unsupportedUsageEvents += 1;
      continue;
    }
    if (total.input === null || total.output === null) {
      counterErrors += 1;
      continue;
    }
    if (!Number.isFinite(timestampMs)) {
      timestampErrors += 1;
      continue;
    }

    if (previousTotal) {
      for (const key of ["input", "cacheRead", "cacheWrite", "output"]) {
        if (
          previousTotal[key] !== null
          && total[key] !== null
          && counterValue(total[key]) < counterValue(previousTotal[key])
        ) {
          countersReset = true;
        }
      }
    }
    const delta = cumulativeDelta(previousTotal, total);
    previousTotal = total;
    terminalTotalSignature = JSON.stringify(countersSignature(info.total_token_usage));

    const normalized = normalizeCodexDelta(delta);
    events.push({
      ...normalized,
      signature,
      totalSignature: terminalTotalSignature,
      timestampMs: Number.isFinite(timestampMs) ? timestampMs : null,
      date: Number.isFinite(timestampMs) ? todayFromTime(timestampMs) : "",
      model: currentModel,
      afterForkBoundary: !parentId
        || subagentBoundarySeen
        || (
          uuidForkBoundaryMs !== null
          && Number.isFinite(timestampMs)
          && timestampMs >= uuidForkBoundaryMs
        ),
    });
  }

  const forkBoundarySeen = !parentId || subagentBoundarySeen || uuidForkBoundaryMs !== null;
  const firstChildIndex = parentId
    ? events.findIndex((event) => event.afterForkBoundary)
    : 0;
  const firstChildEvent = firstChildIndex >= 0
    ? firstChildIndex
    : forkBoundarySeen ? events.length : -1;
  const replayEventsSkipped = parentId && firstChildEvent >= 0 ? firstChildEvent : 0;
  const forkBoundaryMissing = Boolean(parentId) && !forkBoundarySeen;

  return {
    file: item.file,
    mtimeMs: item.mtimeMs,
    size: item.size,
    threadId: rootThreadId,
    rootMetaSeen,
    rootTimestampMs,
    parentId,
    spawnedSubagent,
    replayEventsSkipped,
    forkBoundaryMissing,
    invalidReason,
    parseErrors,
    counterErrors,
    timestampErrors,
    unsupportedUsageEvents,
    countersReset,
    rawTokenEvents,
    terminalTotalSignature,
    maxTimestampMs,
    events: parentId && firstChildEvent >= 0 ? events.slice(firstChildEvent) : events,
  };
}

function emptyCodexDiagnostics(selectedFiles) {
  return {
    selectedFiles,
    parsedFiles: 0,
    cacheHits: 0,
    largeFiles: 0,
    replayEventsSkipped: 0,
    deferredFiles: 0,
    scanErrors: 0,
    parseErrors: 0,
    counterErrors: 0,
    timestampErrors: 0,
    unsupportedUsageEvents: 0,
    counterResets: 0,
    rootsFound: 0,
    discoveredFiles: 0,
    deferredReasons: [],
    billableEvents: 0,
  };
}

export function aggregateCodexFiles(
  selected,
  parsedByThread,
  startDate,
  endDate,
  diagnostics,
  endTimeMs = Number.POSITIVE_INFINITY,
) {
  const map = new Map();

  function defer(parsed, reason) {
    diagnostics.deferredFiles += 1;
    if (!Array.isArray(diagnostics.deferredReasons)) diagnostics.deferredReasons = [];
    if (diagnostics.deferredReasons.length < 20) {
      diagnostics.deferredReasons.push({ threadId: parsed.threadId, reason });
    }
  }

  function provenEmptyFork(parsed, parent) {
    if (parsed.rawTokenEvents === 0) return true;
    if (
      !parent
      || parsed.countersReset
      || parsed.counterErrors > 0
      || parsed.timestampErrors > 0
      || parsed.unsupportedUsageEvents > 0
      || !parsed.terminalTotalSignature
    ) return false;

    const parentTerminal = [...parent.events]
      .reverse()
      .find((event) => (
        Number.isFinite(event.timestampMs)
        && event.timestampMs <= parsed.rootTimestampMs
        && event.totalSignature
      ));
    return parentTerminal?.totalSignature === parsed.terminalTotalSignature;
  }

  for (const parsed of selected) {
    if (!parsed.rootMetaSeen || parsed.invalidReason) {
      defer(parsed, parsed.invalidReason || "root session metadata is missing");
      continue;
    }

    if (parsed.parentId) {
      const parent = parsedByThread.get(parsed.parentId);
      if (parsed.forkBoundaryMissing) {
        if (!provenEmptyFork(parsed, parent)) {
          defer(parsed, !parent
            ? "parent rollout is missing for empty-fork verification"
            : "current fork turn boundary is missing");
          continue;
        }
        diagnostics.replayEventsSkipped += parsed.rawTokenEvents || 0;
        continue;
      }
      diagnostics.replayEventsSkipped += parsed.replayEventsSkipped || 0;
    }

    for (const event of parsed.events) {
      if (
        event.totalTokens <= 0 ||
        !Number.isFinite(event.timestampMs) ||
        event.timestampMs > endTimeMs ||
        event.date < startDate ||
        event.date > endDate
      ) continue;
      diagnostics.billableEvents += 1;
      const key = `${event.date}|${event.model}`;
      const current = map.get(key) || {
        date: event.date,
        tool: "codex",
        model: event.model,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 0,
        inputTokenSemantics: "fresh",
      };
      current.inputTokens += event.inputTokens;
      current.outputTokens += event.outputTokens;
      current.cacheReadTokens += event.cacheReadTokens;
      current.cacheWriteTokens += event.cacheWriteTokens;
      current.totalTokens += event.totalTokens;
      map.set(key, current);
    }
  }

  return [...map.values()];
}

function readCodexCache() {
  try {
    const value = JSON.parse(gunzipSync(fs.readFileSync(CODEX_CACHE_PATH)).toString("utf8"));
    return value?.version === CODEX_CACHE_VERSION && value.files && typeof value.files === "object"
      ? value.files
      : {};
  } catch {
    return {};
  }
}

function writeCodexCache(files) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(CONFIG_DIR, 0o700);
  } catch {
    // Some Windows filesystems do not expose POSIX modes.
  }
  const temporary = `${CODEX_CACHE_PATH}.${process.pid}.tmp`;
  fs.writeFileSync(
    temporary,
    gzipSync(JSON.stringify({ version: CODEX_CACHE_VERSION, files }), { level: 6 }),
    { mode: 0o600 },
  );
  try {
    fs.chmodSync(temporary, 0o600);
  } catch {
    // Some Windows filesystems do not expose POSIX modes.
  }
  try {
    fs.renameSync(temporary, CODEX_CACHE_PATH);
  } catch {
    fs.copyFileSync(temporary, CODEX_CACHE_PATH);
    fs.unlinkSync(temporary);
  }
  try {
    fs.chmodSync(CODEX_CACHE_PATH, 0o600);
  } catch {
    // Some Windows filesystems do not expose POSIX modes.
  }
}

export async function collectCodex(nowMs = Date.now()) {
  const diagnostics = emptyCodexDiagnostics(0);
  const discovered = CODEX_DIRS.flatMap((dir) => {
    const root = expandHome(dir);
    if (!fs.existsSync(root)) return [];
    diagnostics.rootsFound += 1;
    return walkCodexFiles(root, [], diagnostics);
  });
  diagnostics.discoveredFiles = discovered.length;
  const canonicalByThread = new Map();
  for (const item of discovered) {
    const threadId = threadIdFromPath(item.file);
    if (!threadId) continue;
    canonicalByThread.set(threadId, preferCodexFile(canonicalByThread.get(threadId), item));
  }

  const historyWindow = codexHistoryWindow(nowMs);
  const historyStartMs = beijingDayStartMs(historyWindow.startDate);
  const selectedItems = [...canonicalByThread.values()].filter((item) => item.mtimeMs >= historyStartMs);
  diagnostics.selectedFiles = selectedItems.length;
  diagnostics.largeFiles = selectedItems.filter((item) => item.size > MAX_FILE_SIZE).length;
  const cache = readCodexCache();
  const nextCache = {};
  const parsedByThread = new Map();

  async function ensureParsed(item) {
    const threadId = threadIdFromPath(item.file);
    if (parsedByThread.has(threadId)) return parsedByThread.get(threadId);
    const cached = cache[item.file];
    let parsed;
    if (cached?.mtimeMs === item.mtimeMs && cached?.size === item.size && cached?.parsed) {
      parsed = cached.parsed;
      diagnostics.cacheHits += 1;
    } else {
      parsed = await parseCodexFile(item);
      diagnostics.parsedFiles += 1;
    }
    parsedByThread.set(threadId, parsed);
    diagnostics.parseErrors += parsed.parseErrors || 0;
    diagnostics.counterErrors += parsed.counterErrors || 0;
    diagnostics.timestampErrors += parsed.timestampErrors || 0;
    diagnostics.unsupportedUsageEvents += parsed.unsupportedUsageEvents || 0;
    diagnostics.counterResets += parsed.countersReset ? 1 : 0;
    nextCache[item.file] = { mtimeMs: item.mtimeMs, size: item.size, parsed };
    return parsed;
  }

  const selected = [];
  const proofParentIds = new Set();
  for (const item of selectedItems) {
    const parsed = await ensureParsed(item);
    selected.push(parsed);
    if (parsed.parentId && parsed.forkBoundaryMissing && parsed.rawTokenEvents > 0) {
      proofParentIds.add(parsed.parentId);
    }
  }

  for (const parentId of proofParentIds) {
    const item = canonicalByThread.get(parentId);
    if (!item) continue;
    await ensureParsed(item);
  }

  writeCodexCache(nextCache);
  return {
    records: aggregateCodexFiles(
      selected,
      parsedByThread,
      historyWindow.startDate,
      historyWindow.endDate,
      diagnostics,
      nowMs,
    ),
    diagnostics,
  };
}

export function codexCollectionComplete(diagnostics) {
  return diagnostics.deferredFiles === 0
    && diagnostics.scanErrors === 0
    && diagnostics.parseErrors === 0
    && diagnostics.counterErrors === 0
    && diagnostics.timestampErrors === 0
    && diagnostics.unsupportedUsageEvents === 0
    && diagnostics.counterResets === 0;
}

export function codexSourceAvailable(diagnostics) {
  return diagnostics.rootsFound > 0 && diagnostics.discoveredFiles > 0;
}

function numberAt(obj, keys) {
  for (const key of keys) {
    const value = obj?.[key];
    const number = typeof value === "number" ? value : Number(value);
    if (Number.isFinite(number) && number > 0) return Math.round(number);
  }
  return 0;
}

function firstObjectAt(obj, paths) {
  for (const pathItems of paths) {
    let value = obj;
    for (const key of pathItems) {
      value = value?.[key];
    }
    if (value && typeof value === "object") return value;
  }
  return null;
}

function usageRecordsFromStatsCache(obj) {
  if (!Array.isArray(obj?.dailyModelTokens)) return [];

  const records = [];
  for (const item of obj.dailyModelTokens) {
    if (!item?.date || !item.tokensByModel || typeof item.tokensByModel !== "object") continue;
    for (const [model, tokens] of Object.entries(item.tokensByModel)) {
      const totalTokens = Number(tokens);
      if (!Number.isFinite(totalTokens) || totalTokens <= 0) continue;
      records.push({
        date: String(item.date),
        model: String(model || "unknown").slice(0, 128),
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: Math.round(totalTokens),
      });
    }
  }
  return records;
}

function usageFromObject(obj) {
  const usage = firstObjectAt(obj, [
    ["payload", "info", "last_token_usage"],
    ["message", "usage"],
    ["usage"],
  ]) ?? obj;
  const inputTokens = numberAt(usage, ["input_tokens", "prompt_tokens", "inputTokens", "promptTokens"]);
  const outputTokens = numberAt(usage, ["output_tokens", "completion_tokens", "outputTokens", "completionTokens"]);
  const cacheReadTokens = numberAt(usage, [
    "cache_read_input_tokens",
    "cacheReadInputTokens",
    "cached_input_tokens",
    "cached_tokens",
    "cachedTokens",
  ]);
  const cacheWriteTokens = numberAt(usage, [
    "cache_write_input_tokens",
    "cache_creation_input_tokens",
    "cacheCreationInputTokens",
    "cache_write_tokens",
    "cacheWriteTokens",
  ]);
  const explicitTotal = numberAt(usage, ["total_tokens", "totalTokens"]);
  const computedTotal = inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens;
  const totalTokens = explicitTotal || computedTotal;

  if (totalTokens <= 0) return null;

  const timeValue = obj?.timestamp || obj?.created_at || obj?.createdAt || obj?.time || obj?.date;
  const time = Date.parse(timeValue || "");

  return {
    date: Number.isFinite(time) ? todayFromTime(time) : "",
    model: String(obj?.message?.model || obj?.model || obj?.model_name || usage?.model || "unknown").slice(0, 128),
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    totalTokens,
  };
}

function usageRecordKey(obj) {
  if (obj?.message?.id) return `message:${obj.message.id}`;
  if (obj?.requestId && obj?.message?.model) return `request:${obj.requestId}:${obj.message.model}`;
  if (obj?.payload?.type === "token_count" && obj?.timestamp) return `codex:${obj.timestamp}`;
  return "";
}

function usageRecordsFromValue(value) {
  const statsRecords = usageRecordsFromStatsCache(value);
  if (statsRecords.length > 0) return statsRecords;
  const record = usageFromObject(value);
  return record ? [record] : [];
}

function parseLooseJsonLines(text) {
  const records = [];
  const trimmed = text.trim();

  if (!trimmed) return records;

  try {
    const parsed = JSON.parse(trimmed);
    const values = Array.isArray(parsed) ? parsed : [parsed];
    for (const value of values) {
      records.push(...usageRecordsFromValue(value));
    }
    return records;
  } catch {
    // Fall through to JSONL parsing.
  }

  const seen = new Set();
  for (const line of trimmed.split(/\r?\n/)) {
    const part = line.trim();
    if (!part.startsWith("{")) continue;
    try {
      const value = JSON.parse(part);
      const key = usageRecordKey(value);
      if (key && seen.has(key)) continue;
      if (key) seen.add(key);
      records.push(...usageRecordsFromValue(value));
    } catch {
      // Some tools mix progress text with JSON. Skip noisy lines.
    }
  }

  return records;
}

function aggregate(records, fallbackDate, tool) {
  const map = new Map();

  for (const record of records) {
    const date = record.date || fallbackDate;
    const key = `${date}|${tool}|${record.model}`;
    const current = map.get(key) || {
      date,
      tool,
      model: record.model,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 0,
      inputTokenSemantics: record.inputTokenSemantics,
    };
    current.inputTokens += record.inputTokens;
    current.outputTokens += record.outputTokens;
    current.cacheReadTokens += record.cacheReadTokens;
    current.cacheWriteTokens += record.cacheWriteTokens;
    current.totalTokens += record.totalTokens;
    if (current.inputTokenSemantics !== record.inputTokenSemantics) {
      current.inputTokenSemantics = undefined;
    }
    map.set(key, current);
  }

  return [...map.values()];
}

function collectTool(source) {
  const collected = [];

  for (const dir of source.dirs.map(expandHome)) {
    for (const item of walkRecentFiles(dir)) {
      let text = "";
      try {
        text = fs.readFileSync(item.file, "utf8");
      } catch {
        continue;
      }
      const records = parseLooseJsonLines(text);
      collected.push(...aggregate(records, todayFromTime(item.mtimeMs), source.tool));
    }
  }

  return aggregate(collected, todayFromTime(Date.now()), source.tool);
}

async function upload(config, records, collector = null, snapshot = null) {
  const response = await fetch(config.endpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      deviceId: config.deviceId,
      clientVersion: VERSION,
      protocolVersion: 2,
      records,
      ...(collector ? { collector } : {}),
      ...(snapshot ? { snapshot } : {}),
    }),
  });

  const bodyText = await response.text();
  if (!response.ok) throw new Error(`上报失败：${response.status} ${bodyText}`);

  let body;
  try {
    body = JSON.parse(bodyText);
  } catch {
    throw new Error("上报失败：服务端返回了无法识别的响应");
  }
  if (body?.status !== 0 || body?.accepted !== records.length) {
    throw new Error(`上报失败：服务端仅接受 ${body?.accepted ?? 0}/${records.length} 条记录`);
  }
  return body;
}

async function main() {
  if (process.argv.includes("--version")) {
    console.log(VERSION);
    return;
  }

  const cutoffArg = getArg("--cutoff");
  const parsedCutoff = Date.parse(cutoffArg || "");
  const cutoffMs = cutoffArg && Number.isFinite(parsedCutoff) ? parsedCutoff : Date.now();
  const codex = await collectCodex(cutoffMs);
  const rebuildHistory = process.argv.includes("--rebuild-history");
  const codexComplete = codexCollectionComplete(codex.diagnostics);
  const codexSourceFound = codexSourceAvailable(codex.diagnostics);
  if (rebuildHistory && codexSourceFound && !codexComplete) {
    throw new Error(`Codex 历史扫描不完整，未覆盖旧统计：${JSON.stringify(codex.diagnostics)}`);
  }
  const records = codexSourceFound ? [...codex.records] : [];

  for (const source of TOOL_SOURCES) {
    records.push(...collectTool(source));
  }

  if (process.argv.includes("--dry-run")) {
    const targetDate = todayFromTime(cutoffMs);
    const todayRecords = records.filter((record) => record.tool === "codex" && record.date === targetDate);
    const totals = todayRecords.reduce(
      (sum, record) => ({
        inputTokens: sum.inputTokens + record.inputTokens,
        outputTokens: sum.outputTokens + record.outputTokens,
        cacheReadTokens: sum.cacheReadTokens + record.cacheReadTokens,
        cacheWriteTokens: sum.cacheWriteTokens + record.cacheWriteTokens,
        totalTokens: sum.totalTokens + record.totalTokens,
      }),
      { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0 },
    );
    console.log(JSON.stringify({
      clientVersion: VERSION,
      cutoff: new Date(cutoffMs).toISOString(),
      targetDate,
      historyWindow: codexHistoryWindow(cutoffMs),
      diagnostics: codex.diagnostics,
      totals,
      ...(process.argv.includes("--summary") ? {} : { records }),
    }, null, 2));
    return;
  }

  if (!codexComplete) {
    for (let index = records.length - 1; index >= 0; index -= 1) {
      if (records[index].tool === "codex") records.splice(index, 1);
    }
  }

  const config = prepareConfig();
  const observedThrough = new Date(cutoffMs).toISOString();
  const collector = codexSourceFound && codexComplete
    ? { tool: "codex", observedThrough }
    : null;
  const historyWindow = codexHistoryWindow(cutoffMs);
  const snapshot = rebuildHistory && codexSourceFound && codexComplete
    ? {
        id: crypto.randomUUID(),
        tool: "codex",
        complete: true,
        observedThrough,
        startDate: historyWindow.startDate,
        endDate: historyWindow.endDate,
        timeZone: "Asia/Shanghai",
      }
    : null;
  const stagedConfig = stageConfig(config);
  let result;
  try {
    result = await upload(config, records, collector, snapshot);
    stagedConfig.commit();
  } catch (error) {
    stagedConfig.discard();
    throw error;
  }
  console.log(`znt-tokenrank synced ${records.length} records`);
  console.log(`codex diagnostics ${JSON.stringify(codex.diagnostics)}`);
  console.log(result);
}

function canonicalFilePath(value) {
  try {
    return fs.realpathSync(value);
  } catch {
    return path.resolve(value);
  }
}

const isMain = process.argv[1]
  && canonicalFilePath(process.argv[1]) === canonicalFilePath(fileURLToPath(import.meta.url));
if (isMain) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
