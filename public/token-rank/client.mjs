#!/usr/bin/env node
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";

const VERSION = "0.2.5";
const CONFIG_DIR = process.env.ZNT_TOKENRANK_HOME || path.join(os.homedir(), ".znt-tokenrank");
const CONFIG_PATH = path.join(CONFIG_DIR, "config.json");
const CODEX_CACHE_PATH = path.join(CONFIG_DIR, "codex-usage-cache-v7.json.gz");
const LEGACY_CODEX_CACHE_PATH = path.join(CONFIG_DIR, "codex-usage-cache-v6.json.gz");
const CODEX_CACHE_VERSION = 7;
const HISTORY_DAYS = 35;
const MAX_FILE_SIZE = 8 * 1024 * 1024;
const MAX_FILES_PER_TOOL = 320;
const LOOKBACK_MS = 35 * 24 * 60 * 60 * 1000;
const UUID_SUFFIX_RE = /([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.jsonl$/i;
const OPENCODE_MIN_VERSION = [1, 18, 18];
const OPENCODE_MAX_VERSION = [1, 18, 21];

const CODEX_DIRS = ["~/.codex/sessions", "~/.codex/archived_sessions"];

const TOOL_SOURCES = [
  { tool: "claude-code", dirs: ["~/.claude/projects"] },
  { tool: "cursor", dirs: ["~/Library/Application Support/Cursor/User/globalStorage", "~/.cursor"] },
  { tool: "gemini", dirs: ["~/.gemini"] },
  { tool: "kimi", dirs: ["~/.kimi", "~/Library/Application Support/Kimi"] },
  { tool: "qwen", dirs: ["~/.qwen"] },
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

function beijingTimestamp(nowMs = Date.now()) {
  return new Date(nowMs + 8 * 60 * 60 * 1000).toISOString().replace("Z", "+08:00");
}

function redactSecrets(value, secrets = []) {
  let safe = String(value ?? "").replace(/znt_trk_[A-Za-z0-9_-]+/g, "[REDACTED]");
  for (const secret of secrets) {
    if (typeof secret === "string" && secret) safe = safe.split(secret).join("[REDACTED]");
  }
  safe = safe.replace(
    new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, "g"),
    "",
  );
  return [...safe].map((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code < 32 || (code >= 127 && code <= 159) ? " " : character;
  }).join("").replace(/\s+/g, " ").trim();
}

function logMessage(method, message) {
  console[method](`[${beijingTimestamp()}] [znt-tokenrank ${VERSION}] ${redactSecrets(message)}`);
}

function logInfo(message) {
  logMessage("log", message);
}

function logWarning(message) {
  logMessage("warn", message);
}

function logError(message) {
  logMessage("error", message);
}

class TokenRankProtocolCompatibilityError extends Error {
  constructor(message) {
    super(message);
    this.name = "TokenRankProtocolCompatibilityError";
  }
}

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

export function selectCodexBackfillRecords(records, nowMs = Date.now()) {
  const endDate = addDays(todayFromTime(nowMs), -1);
  const startDate = addDays(endDate, -(HISTORY_DAYS - 2));
  return records.filter((record) => (
    record.tool === "codex"
    && record.date >= startDate
    && record.date <= endDate
  ));
}

function beijingDayStartMs(date) {
  return Date.parse(`${date}T00:00:00Z`) - 8 * 60 * 60 * 1000;
}

export function openCodeExecutableCandidates(
  platform = process.platform,
  environment = process.env,
  home = os.homedir(),
) {
  const windows = platform === "win32";
  const pathModule = windows ? path.win32 : path;
  return [...new Set([
    environment.OPENCODE_BIN?.trim(),
    pathModule.join(home, ".opencode", "bin", windows ? "opencode.exe" : "opencode"),
    pathModule.join(home, ".local", "bin", windows ? "opencode.exe" : "opencode"),
    ...(windows
      ? [
          environment.APPDATA && pathModule.join(environment.APPDATA, "npm", "opencode.cmd"),
          "opencode.exe",
          "opencode.cmd",
          "opencode",
        ]
      : ["/opt/homebrew/bin/opencode", "/usr/local/bin/opencode"]),
    ...(windows ? [] : ["opencode"]),
  ].filter(Boolean))];
}

function openCodeDatabaseCandidates() {
  const dataRoots = [...new Set([
    process.env.XDG_DATA_HOME && path.join(process.env.XDG_DATA_HOME, "opencode"),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "opencode"),
    path.join(os.homedir(), ".local", "share", "opencode"),
    path.join(os.homedir(), "Library", "Application Support", "opencode"),
  ].filter(Boolean))];
  const configured = process.env.OPENCODE_DB?.trim();
  const candidates = [];

  if (configured && configured !== ":memory:") {
    candidates.push(path.isAbsolute(configured) ? configured : path.join(dataRoots[0], configured));
  }
  for (const root of dataRoots) {
    try {
      for (const name of fs.readdirSync(root)) {
        if (/^opencode(?:-[A-Za-z0-9._-]+)?\.db$/.test(name)) candidates.push(path.join(root, name));
      }
    } catch {
      // OpenCode is optional; an absent data directory is not an error.
    }
  }
  return [...new Set(candidates)];
}

function openCodeCounter(value) {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number) || number <= 0) return 0;
  const rounded = Math.round(number);
  return Number.isSafeInteger(rounded) ? rounded : 0;
}

function supportedOpenCodeVersion(value) {
  const match = String(value || "").trim().match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return false;
  const version = match.slice(1).map(Number);
  const compare = (boundary) => {
    for (let index = 0; index < version.length; index += 1) {
      if (version[index] !== boundary[index]) return version[index] - boundary[index];
    }
    return 0;
  };
  return compare(OPENCODE_MIN_VERSION) >= 0 && compare(OPENCODE_MAX_VERSION) <= 0;
}

export function openCodeRecordsFromRows(rows) {
  if (!Array.isArray(rows)) return [];

  return rows.flatMap((row) => {
    const date = typeof row?.date === "string" ? row.date : "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return [];

    const rawModel = String(row?.model || "unknown").trim() || "unknown";
    const model = rawModel.slice(0, 128);
    const inputTokens = openCodeCounter(row?.input_tokens);
    const outputTokens = openCodeCounter(row?.output_tokens)
      + openCodeCounter(row?.reasoning_tokens);
    const cacheReadTokens = openCodeCounter(row?.cache_read_tokens);
    const cacheWriteTokens = openCodeCounter(row?.cache_write_tokens);
    const totalTokens = inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens;
    if (!Number.isSafeInteger(totalTokens) || totalTokens <= 0) return [];

    return [{
      date,
      tool: "opencode",
      model,
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheWriteTokens,
      totalTokens,
      inputTokenSemantics: "fresh",
    }];
  });
}

export function openCodeUsageQuery(nowMs = Date.now()) {
  const endDate = todayFromTime(nowMs);
  const startDate = addDays(endDate, -(HISTORY_DAYS - 1));
  const startMs = beijingDayStartMs(startDate);
  return `
WITH assistant_usage AS (
  SELECT DISTINCT
    json_remove(data, '$.parentID') AS fingerprint,
    json_extract(data, '$.time.completed') AS usage_time,
    substr(coalesce(nullif(trim(json_extract(data, '$.modelID')), ''), 'unknown'), 1, 128) AS model,
    coalesce(json_extract(data, '$.tokens.input'), 0) AS input_tokens,
    coalesce(json_extract(data, '$.tokens.output'), 0) AS output_tokens,
    coalesce(json_extract(data, '$.tokens.reasoning'), 0) AS reasoning_tokens,
    coalesce(json_extract(data, '$.tokens.cache.read'), 0) AS cache_read_tokens,
    coalesce(json_extract(data, '$.tokens.cache.write'), 0) AS cache_write_tokens
  FROM message
  WHERE json_extract(data, '$.role') = 'assistant'
    AND json_type(data, '$.time.completed') IN ('integer', 'real')
)
SELECT
  strftime('%Y-%m-%d', usage_time / 1000, 'unixepoch', '+8 hours') AS date,
  model,
  sum(input_tokens) AS input_tokens,
  sum(output_tokens) AS output_tokens,
  sum(reasoning_tokens) AS reasoning_tokens,
  sum(cache_read_tokens) AS cache_read_tokens,
  sum(cache_write_tokens) AS cache_write_tokens,
  (SELECT file FROM pragma_database_list WHERE name = 'main') AS database_path,
  0 AS assistant_rows,
  0 AS token_rows,
  0 AS unsupported_rows
FROM assistant_usage
WHERE usage_time >= ${startMs}
  AND usage_time <= ${nowMs}
GROUP BY date, model
UNION ALL
SELECT
  NULL AS date,
  NULL AS model,
  0 AS input_tokens,
  0 AS output_tokens,
  0 AS reasoning_tokens,
  0 AS cache_read_tokens,
  0 AS cache_write_tokens,
  file AS database_path,
  (SELECT count(*) FROM message WHERE json_extract(data, '$.role') = 'assistant') AS assistant_rows,
  (SELECT count(*) FROM message
    WHERE json_extract(data, '$.role') = 'assistant'
      AND json_type(data, '$.time.completed') = 'integer'
      AND json_type(data, '$.tokens.total') = 'integer'
      AND json_type(data, '$.tokens.input') = 'integer'
      AND json_type(data, '$.tokens.output') = 'integer'
      AND json_type(data, '$.tokens.reasoning') = 'integer'
      AND json_type(data, '$.tokens.cache.read') = 'integer'
      AND json_type(data, '$.tokens.cache.write') = 'integer'
      AND json_extract(data, '$.tokens.total') > 0
      AND json_extract(data, '$.tokens.input') >= 0
      AND json_extract(data, '$.tokens.output') >= 0
      AND json_extract(data, '$.tokens.reasoning') >= 0
      AND json_extract(data, '$.tokens.cache.read') >= 0
      AND json_extract(data, '$.tokens.cache.write') >= 0
      AND json_extract(data, '$.tokens.total') =
        json_extract(data, '$.tokens.input')
        + json_extract(data, '$.tokens.output')
        + json_extract(data, '$.tokens.reasoning')
        + json_extract(data, '$.tokens.cache.read')
        + json_extract(data, '$.tokens.cache.write')) AS token_rows,
  (SELECT count(*) FROM message
    WHERE (
      json_extract(data, '$.role') = 'assistant'
      OR json_type(data, '$.tokens') = 'object'
    )
      AND NOT coalesce((
        json_extract(data, '$.role') = 'assistant'
        AND json_type(data, '$.time.completed') = 'integer'
        AND json_type(data, '$.tokens.total') = 'integer'
        AND json_type(data, '$.tokens.input') = 'integer'
        AND json_type(data, '$.tokens.output') = 'integer'
        AND json_type(data, '$.tokens.reasoning') = 'integer'
        AND json_type(data, '$.tokens.cache.read') = 'integer'
        AND json_type(data, '$.tokens.cache.write') = 'integer'
        AND json_extract(data, '$.tokens.total') > 0
        AND json_extract(data, '$.tokens.input') >= 0
        AND json_extract(data, '$.tokens.output') >= 0
        AND json_extract(data, '$.tokens.reasoning') >= 0
        AND json_extract(data, '$.tokens.cache.read') >= 0
        AND json_extract(data, '$.tokens.cache.write') >= 0
        AND json_extract(data, '$.tokens.total') =
          json_extract(data, '$.tokens.input')
          + json_extract(data, '$.tokens.output')
          + json_extract(data, '$.tokens.reasoning')
          + json_extract(data, '$.tokens.cache.read')
          + json_extract(data, '$.tokens.cache.write')
      ) OR (
        json_extract(data, '$.role') = 'assistant'
        AND json_type(data, '$.tokens.input') = 'integer'
        AND json_type(data, '$.tokens.output') = 'integer'
        AND json_type(data, '$.tokens.reasoning') = 'integer'
        AND json_type(data, '$.tokens.cache.read') = 'integer'
        AND json_type(data, '$.tokens.cache.write') = 'integer'
        AND json_extract(data, '$.tokens.input') = 0
        AND json_extract(data, '$.tokens.output') = 0
        AND json_extract(data, '$.tokens.reasoning') = 0
        AND json_extract(data, '$.tokens.cache.read') = 0
        AND json_extract(data, '$.tokens.cache.write') = 0
        AND (
          json_type(data, '$.tokens.total') IS NULL
          OR (
            json_type(data, '$.tokens.total') = 'integer'
            AND json_extract(data, '$.tokens.total') = 0
          )
        )
      ), 0)) AS unsupported_rows
FROM pragma_database_list
WHERE name = 'main'
ORDER BY date, model
`.trim();
}

function runOpenCodeCommand(executable, args) {
  const options = {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    timeout: 30_000,
    windowsHide: true,
  };
  if (process.platform === "win32" && !executable.toLowerCase().endsWith(".exe")) {
    return spawnSync("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "$arguments = @(ConvertFrom-Json $env:ZNT_OPENCODE_ARGUMENTS); "
        + "& $env:ZNT_OPENCODE_EXECUTABLE @arguments; exit $LASTEXITCODE",
    ], {
      ...options,
      env: {
        ...process.env,
        ZNT_OPENCODE_EXECUTABLE: executable,
        ZNT_OPENCODE_ARGUMENTS: JSON.stringify(args),
      },
    });
  }
  return spawnSync(executable, args, options);
}

export function collectOpenCode(
  nowMs = Date.now(),
  executables = openCodeExecutableCandidates(),
  databaseCandidates = openCodeDatabaseCandidates(),
) {
  const expectedDatabases = new Set(
    databaseCandidates
      .filter((file) => fs.existsSync(file))
      .map(canonicalFilePath),
  );
  const sourceFound = expectedDatabases.size > 0;
  if (!sourceFound) return { sourceFound: false, complete: false, records: [] };

  const query = openCodeUsageQuery(nowMs);
  let failure = "";

  for (const executable of executables) {
    if (path.isAbsolute(executable) && !fs.existsSync(executable)) continue;
    const versionResult = runOpenCodeCommand(executable, ["--version"]);
    if (versionResult.error?.code === "ENOENT") continue;
    if (versionResult.error || versionResult.status !== 0) {
      failure = versionResult.error?.message || versionResult.stderr || `exit ${versionResult.status}`;
      continue;
    }
    const openCodeVersion = versionResult.stdout.trim().split(/\r?\n/).filter(Boolean).at(-1) || "";
    if (!supportedOpenCodeVersion(openCodeVersion)) {
      failure = `OpenCode ${openCodeVersion || "未知版本"} 尚未验证兼容性`;
      continue;
    }

    const pathResult = runOpenCodeCommand(executable, ["db", "path"]);
    if (pathResult.error?.code === "ENOENT") continue;
    if (pathResult.error || pathResult.status !== 0) {
      failure = pathResult.error?.message || pathResult.stderr || `exit ${pathResult.status}`;
      continue;
    }
    const reportedPath = pathResult.stdout.trim().split(/\r?\n/).filter(Boolean).at(-1) || "";
    if (!reportedPath || !expectedDatabases.has(canonicalFilePath(reportedPath))) {
      failure = "OpenCode CLI 报告的数据库不在已发现的数据文件中";
      continue;
    }

    const result = runOpenCodeCommand(executable, ["db", query, "--format", "json"]);
    if (result.error?.code === "ENOENT") continue;
    if (result.error || result.status !== 0) {
      failure = result.error?.message || result.stderr || `exit ${result.status}`;
      continue;
    }

    try {
      const rows = JSON.parse(result.stdout);
      const metadata = Array.isArray(rows)
        ? rows.find((row) => row?.date === null && typeof row?.database_path === "string")
        : null;
      const queriedDatabases = new Set(
        (Array.isArray(rows) ? rows : [])
          .map((row) => typeof row?.database_path === "string" ? row.database_path : "")
          .filter(Boolean)
          .map(canonicalFilePath),
      );
      if (
        queriedDatabases.size !== 1
        || [...queriedDatabases][0] !== canonicalFilePath(reportedPath)
      ) {
        failure = "OpenCode CLI 查询的数据库与已发现的数据文件不一致";
        continue;
      }
      if (
        !metadata
        || openCodeCounter(metadata.unsupported_rows) > 0
        || openCodeCounter(metadata.token_rows) === 0
      ) {
        failure = "OpenCode 数据库存在无法安全统计的用量记录";
        continue;
      }
      return {
        sourceFound: true,
        complete: true,
        records: openCodeRecordsFromRows(rows),
      };
    } catch (error) {
      failure = `无法解析 OpenCode 数据库输出：${error.message}`;
    }
  }

  failure ||= "找不到可执行的 OpenCode CLI";
  if (failure) logWarning(`OpenCode 用量采集失败，本次跳过：${failure}`);
  return { sourceFound: true, complete: false, records: [] };
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

function preservePendingHistoryMarker() {
  const existing = readConfig();
  if (!existing || existing.pendingCodexHistoryRebuild === true) return;
  try {
    const staged = stageConfig({ ...existing, pendingCodexHistoryRebuild: true });
    staged.commit();
  } catch (markerError) {
    logWarning(`无法保留 Codex 历史待重建标记：${markerError.message}`);
  }
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
  let cumulativeNonMonotonic = false;
  let rawTokenEvents = 0;
  let terminalTotalSignature = "";
  let cumulativeBaselineLost = false;
  const seenUsageSignatures = new Set();
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
    const totalIsUsable = total && total.input !== null && total.output !== null;
    const lastIsUsable = last
      && last.input !== null
      && last.output !== null
      && [last.input, last.cacheRead, last.cacheWrite, last.output].some(
        (counter) => counterValue(counter) > 0,
      );
    if (!lastIsUsable && !totalIsUsable) {
      counterErrors += 1;
      continue;
    }
    if (!Number.isFinite(timestampMs)) {
      timestampErrors += 1;
      continue;
    }
    const afterForkBoundary = !parentId
      || subagentBoundarySeen
      || (
        uuidForkBoundaryMs !== null
        && timestampMs >= uuidForkBoundaryMs
      );

    let totalDecreased = false;
    if (previousTotal && totalIsUsable) {
      for (const key of ["input", "cacheRead", "cacheWrite", "output"]) {
        if (
          previousTotal[key] !== null
          && total[key] !== null
          && counterValue(total[key]) < counterValue(previousTotal[key])
        ) {
          totalDecreased = true;
        }
      }
    }
    if (totalDecreased) {
      cumulativeNonMonotonic = true;
      if (!lastIsUsable) countersReset = true;
    }

    const scopedSignature = JSON.stringify([
      currentModel,
      afterForkBoundary,
      totalIsUsable ? signature : timestampMs,
      signature,
    ]);
    if (lastIsUsable && seenUsageSignatures.has(scopedSignature)) {
      if (totalIsUsable) {
        previousTotal = total;
        terminalTotalSignature = JSON.stringify(countersSignature(info.total_token_usage));
        cumulativeBaselineLost = false;
      }
      continue;
    }
    if (lastIsUsable) seenUsageSignatures.add(scopedSignature);

    if (!lastIsUsable && (cumulativeBaselineLost || cumulativeNonMonotonic)) {
      unsupportedUsageEvents += 1;
      previousTotal = total;
      terminalTotalSignature = JSON.stringify(countersSignature(info.total_token_usage));
      cumulativeBaselineLost = false;
      continue;
    }
    const delta = lastIsUsable ? last : cumulativeDelta(previousTotal, total);
    if (totalIsUsable) {
      previousTotal = total;
      terminalTotalSignature = JSON.stringify(countersSignature(info.total_token_usage));
      cumulativeBaselineLost = false;
    } else {
      previousTotal = null;
      terminalTotalSignature = "";
      cumulativeBaselineLost = true;
    }

    const normalized = normalizeCodexDelta(delta);
    events.push({
      ...normalized,
      signature,
      totalSignature: terminalTotalSignature,
      timestampMs: Number.isFinite(timestampMs) ? timestampMs : null,
      date: Number.isFinite(timestampMs) ? todayFromTime(timestampMs) : "",
      model: currentModel,
      afterForkBoundary,
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
    cumulativeNonMonotonic,
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
      || parsed.cumulativeNonMonotonic
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

function readCodexCacheFile(file) {
  try {
    return JSON.parse(gunzipSync(fs.readFileSync(file)).toString("utf8"));
  } catch {
    return null;
  }
}

function readCodexCache() {
  const current = readCodexCacheFile(CODEX_CACHE_PATH);
  if (
    current?.version === CODEX_CACHE_VERSION
    && current.files
    && typeof current.files === "object"
  ) {
    return current.files;
  }

  const legacy = readCodexCacheFile(LEGACY_CODEX_CACHE_PATH);
  if (legacy?.version !== 6 || !legacy.files || typeof legacy.files !== "object") return {};

  // Reuse only v6 entries whose diagnostics prove that the old cumulative
  // parser did not lose information. Everything else is reparsed with v7.
  return Object.fromEntries(
    Object.entries(legacy.files).filter(([, cached]) => {
      const parsed = cached?.parsed;
      return parsed
        && parsed.countersReset === false
        && (parsed.parseErrors || 0) === 0
        && (parsed.counterErrors || 0) === 0
        && (parsed.timestampErrors || 0) === 0
        && (parsed.unsupportedUsageEvents || 0) === 0;
    }),
  );
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

async function upload(config, records, collector = null, snapshot = null, codexMode = null) {
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
      ...(codexMode ? { codexMode } : {}),
    }),
  });

  const bodyText = await response.text();
  if (!response.ok) {
    let serverMessage = bodyText;
    try {
      const parsed = JSON.parse(bodyText);
      if (typeof parsed?.message === "string") serverMessage = parsed.message;
    } catch {
      // Keep the plain-text response for diagnostics.
    }
    const safeServerMessage = redactSecrets(serverMessage, [config.token]).slice(0, 500);
    const protocolMismatch = response.status === 400 && (
      safeServerMessage.includes("v2 Codex records 必须带 collector")
      || /protocolVersion|codexMode|partial Codex/i.test(safeServerMessage)
    );
    if (protocolMismatch) {
      throw new TokenRankProtocolCompatibilityError(
        `服务端与客户端协议不兼容：客户端 ${VERSION} 需要 Token Rank v2 partial/backfill 协议，`
        + `但服务端返回 400（${safeServerMessage}）。请联系站点管理员恢复匹配的服务端版本；本次未更新同步状态。`,
      );
    }
    throw new Error(`上报失败：${response.status} ${safeServerMessage}`);
  }

  let body;
  try {
    body = JSON.parse(bodyText);
  } catch {
    throw new Error("上报失败：服务端返回了无法识别的响应");
  }
  if (body?.status !== 0 || !Number.isSafeInteger(body?.accepted)) {
    throw new Error("上报失败：服务端返回了无效的确认结果");
  }
  if (body.accepted !== records.length) {
    throw new Error(`上报失败：服务端仅接受 ${body.accepted}/${records.length} 条记录`);
  }
  return {
    status: body.status,
    accepted: body.accepted,
    ...(typeof body.replaced === "number" ? { replaced: body.replaced } : {}),
    ...(typeof body.merged === "number" ? { merged: body.merged } : {}),
    ...(typeof body.preserved === "number" ? { preserved: body.preserved } : {}),
    ...(typeof body.idempotent === "boolean" ? { idempotent: body.idempotent } : {}),
  };
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
  const rebuildHistoryRequested = process.argv.includes("--rebuild-history");
  const codexComplete = codexCollectionComplete(codex.diagnostics);
  const codexSourceFound = codexSourceAvailable(codex.diagnostics);
  const openCode = collectOpenCode(cutoffMs);
  const records = codexSourceFound ? [...codex.records] : [];
  if (openCode.complete) records.push(...openCode.records);

  for (const source of TOOL_SOURCES) {
    records.push(...collectTool(source));
  }

  if (process.argv.includes("--dry-run")) {
    const targetDate = todayFromTime(cutoffMs);
    const todayRecords = records.filter((record) => record.date === targetDate);
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
      openCode: {
        sourceFound: openCode.sourceFound,
        complete: openCode.complete,
        records: openCode.records.length,
      },
      totals,
      ...(process.argv.includes("--summary") ? {} : { records }),
    }, null, 2));
    return;
  }

  const partialCodex = codexSourceFound && !codexComplete;
  let backfillRecords = [];
  if (partialCodex) {
    const targetDate = todayFromTime(cutoffMs);
    for (let index = records.length - 1; index >= 0; index -= 1) {
      if (records[index].tool === "codex" && records[index].date !== targetDate) {
        records.splice(index, 1);
      }
    }
  }

  const config = prepareConfig();
  const rebuildHistory = rebuildHistoryRequested || config.pendingCodexHistoryRebuild === true;
  if (rebuildHistory) config.pendingCodexHistoryRebuild = true;
  if (codexSourceFound && !codexComplete) {
    config.pendingCodexHistoryRebuild = true;
    logWarning(
      `Codex 历史扫描不完整，本次优先合并今日下界并安全补传最近历史缺口；线上已有历史保持不变，客户端会自动重试完整重建：${JSON.stringify(codex.diagnostics)}`,
    );
  } else if (rebuildHistory && codexSourceFound && codexComplete) {
    delete config.pendingCodexHistoryRebuild;
  }
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
  let backfillResult = null;
  try {
    result = await upload(config, records, collector, snapshot, partialCodex ? "partial" : null);
    backfillRecords = partialCodex ? selectCodexBackfillRecords(codex.records) : [];
    if (backfillRecords.length > 0) {
      try {
        backfillResult = await upload(config, backfillRecords, null, null, "partial-backfill");
      } catch (error) {
        if (!(error instanceof TokenRankProtocolCompatibilityError)) throw error;
        logWarning(
          "服务端当前不支持 Codex 历史补传；今日主同步已完成，"
          + "待重建标记已保留，服务端恢复后会自动重试。",
        );
      }
    }
    stagedConfig.commit();
  } catch (error) {
    stagedConfig.discard();
    if (partialCodex) preservePendingHistoryMarker();
    throw error;
  }
  logInfo(`znt-tokenrank synced ${records.length} records`);
  logInfo(`codex diagnostics ${JSON.stringify(codex.diagnostics)}`);
  logInfo(`server response ${JSON.stringify(result)}`);
  if (backfillResult) {
    logInfo(`codex history backfill synced ${backfillRecords.length} records`);
    logInfo(`backfill server response ${JSON.stringify(backfillResult)}`);
  }
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
    logError(error.message);
    process.exitCode = 1;
  });
}
