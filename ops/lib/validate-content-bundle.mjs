#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.argv[2] ?? "");
const representativeDate = process.argv[3] ?? "";
const MAX_FILES = 20_000;
const MAX_TOTAL_BYTES = 512 * 1024 * 1024;
const MAX_FILE_BYTES = 128 * 1024 * 1024;
const MAX_JSON_BYTES = 16 * 1024 * 1024;

if (!root) {
  console.error("Usage: validate-content-bundle.mjs CONTENT_ROOT [YYYY-MM-DD]");
  process.exit(2);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function readJson(relative) {
  const absolute = path.join(root, relative);
  try {
    const stat = fs.lstatSync(absolute);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_JSON_BYTES) {
      fail(`JSON file is invalid or too large: ${relative}`);
    }
    return JSON.parse(fs.readFileSync(absolute, "utf8"));
  } catch (error) {
    fail(`Invalid JSON ${relative}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const manifest = readJson("manifest.json");
const files = Array.isArray(manifest.files) ? manifest.files : [];
const fileCount = Number(manifest.fileCount ?? manifest.file_count ?? -1);
if (!Number.isSafeInteger(fileCount) || fileCount !== files.length || fileCount > MAX_FILES) {
  fail("Manifest file count mismatch");
}
if (Number(manifest.schemaVersion ?? manifest.schema_version) !== 1) fail("Unsupported content schema version");
const contentVersion = manifest.contentVersion ?? manifest.content_version;
const generatedAt = manifest.generatedAt ?? manifest.generated_at;
const codeSha = manifest.codeSha ?? manifest.code_sha;
if (typeof contentVersion !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(contentVersion)) {
  fail("Invalid content version");
}
if (typeof generatedAt !== "string" || Number.isNaN(Date.parse(generatedAt))) fail("Invalid generated time");
if (typeof codeSha !== "string" || (codeSha !== "unknown" && !/^[0-9a-f]{40}$/.test(codeSha))) {
  fail("Invalid generating code SHA");
}

function isSafeRelativePath(value) {
  if (typeof value !== "string" || !value || value.startsWith("/") || value.includes("\\")) return false;
  if (/[\u0000-\u001f\u007f]/u.test(value) || Buffer.byteLength(value, "utf8") > 4096) return false;
  const parts = value.split("/");
  return parts.every((part) => part && part !== "." && part !== ".." && Buffer.byteLength(part, "utf8") <= 255);
}

function sha256File(absolute) {
  const hash = crypto.createHash("sha256");
  const descriptor = fs.openSync(absolute, "r");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    for (;;) {
      const count = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (count === 0) break;
      hash.update(buffer.subarray(0, count));
    }
  } finally {
    fs.closeSync(descriptor);
  }
  return hash.digest("hex");
}

const requiredTopLevel = new Map([
  ["daily", "directory"],
  ["knowledge", "directory"],
  ["digest-images", "directory"],
  ["index.json", "file"],
  ["search-index.json", "file"],
  ["manifest.json", "file"],
]);
for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
  const expected = requiredTopLevel.get(entry.name);
  if (!expected || (expected === "directory" && !entry.isDirectory()) || (expected === "file" && !entry.isFile())) {
    fail(`Unexpected top-level content entry: ${entry.name}`);
  }
  requiredTopLevel.delete(entry.name);
}
if (requiredTopLevel.size > 0) fail(`Missing top-level content entry: ${requiredTopLevel.keys().next().value}`);

function isAllowedContentPath(relative) {
  if (relative === "index.json" || relative === "search-index.json" || relative === "knowledge/index.json") return true;
  if (/^daily\/\d{4}-\d{2}-\d{2}\.json$/u.test(relative)) return true;
  if (relative.startsWith("knowledge/items/") && relative.endsWith(".json")) return true;
  if (relative.startsWith("digest-images/") && /\.(?:avif|jpe?g|png|webp)$/iu.test(relative)) return true;
  return false;
}

function walk(directory, prefix = "") {
  return fs.readdirSync(directory, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((entry) => {
      const absolute = path.join(directory, entry.name);
      const relative = path.posix.join(prefix, entry.name);
      const stat = fs.lstatSync(absolute);
      if (stat.isSymbolicLink()) fail(`Symbolic links are not allowed: ${relative}`);
      if (stat.isDirectory()) return walk(absolute, relative);
      if (!stat.isFile() || relative === "manifest.json") return [];
      return [relative];
    });
}

const actualFiles = walk(root);
if (actualFiles.length > MAX_FILES) fail("Bundle contains too many files");
for (const relative of actualFiles) {
  if (!isAllowedContentPath(relative)) fail(`Unsupported content file: ${relative}`);
}
const declaredFiles = files.map((entry) => entry?.path);
const declaredFileSet = new Set(declaredFiles);
if (declaredFileSet.size !== declaredFiles.length || actualFiles.length !== declaredFiles.length ||
  actualFiles.some((relative) => !declaredFileSet.has(relative))) {
  fail("Manifest does not match bundle files");
}

let totalBytes = 0;
for (const entry of files) {
  if (!entry || !isSafeRelativePath(entry.path)) {
    fail("Manifest contains an invalid path");
  }
  const absolute = path.resolve(root, entry.path);
  if (!absolute.startsWith(`${root}${path.sep}`)) fail(`Manifest path escapes the bundle: ${entry.path}`);
  const stat = fs.lstatSync(absolute);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    fail(`Manifest file is missing: ${entry.path}`);
  }
  if (stat.size > MAX_FILE_BYTES || (entry.path.endsWith(".json") && stat.size > MAX_JSON_BYTES)) {
    fail(`Manifest file exceeds the size limit: ${entry.path}`);
  }
  totalBytes += stat.size;
  if (totalBytes > MAX_TOTAL_BYTES) fail("Bundle exceeds the total size limit");
  const sha256 = sha256File(absolute);
  if (sha256 !== entry.sha256 || stat.size !== Number(entry.size)) {
    fail(`Manifest hash or size mismatch: ${entry.path}`);
  }
}

const index = readJson("index.json");
const searchIndex = readJson("search-index.json");
if (!Array.isArray(index) || !Array.isArray(searchIndex)) fail("Root indexes must be arrays");
if (index.length === 0) fail("Daily index must contain at least one report");

const indexedDates = new Set();
for (const item of index) {
  const date = typeof item?.date === "string" ? item.date : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) fail("Daily index contains an invalid date");
  const report = readJson(`daily/${date}.json`);
  if (report.date !== date || typeof report.title !== "string" || !Array.isArray(report.topics)) {
    fail(`Daily report is inconsistent: ${date}`);
  }
  indexedDates.add(date);
}

for (const item of searchIndex) {
  if (!indexedDates.has(String(item?.date ?? ""))) fail("Search index references an unknown daily report");
}

if (representativeDate) {
  if (!indexedDates.has(representativeDate)) fail(`Representative daily report is absent: ${representativeDate}`);
  readJson(`daily/${representativeDate}.json`);
}

const knowledgeIndex = readJson("knowledge/index.json");
if (!Array.isArray(knowledgeIndex)) fail("Knowledge index must be an array");
for (const item of knowledgeIndex) {
  const id = String(item?.id ?? item?.slug ?? "");
  if (!id || id.includes("/") || id.includes("..")) fail("Knowledge index contains an invalid id");
  const detailPath = path.join(root, "knowledge", "items", `${id}.json`);
  if (!fs.existsSync(detailPath)) fail(`Knowledge detail is missing: ${id}`);
  const detail = readJson(`knowledge/items/${id}.json`);
  if (!detail || typeof detail !== "object" || String(detail.id ?? detail.slug ?? "") !== id) {
    fail(`Knowledge detail is inconsistent: ${id}`);
  }
}

console.log(JSON.stringify({
  contentVersion,
  fileCount,
  dailyCount: index.length,
  knowledgeCount: knowledgeIndex.length,
}));
