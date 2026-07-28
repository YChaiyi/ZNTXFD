#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.argv[2] ?? "");
const contentVersion = process.argv[3] ?? "";
const codeSha = process.argv[4] ?? "unknown";

if (!root || !contentVersion) {
  console.error("Usage: build-content-manifest.mjs CONTENT_ROOT CONTENT_VERSION [CODE_SHA]");
  process.exit(2);
}

const required = ["daily", "knowledge", "index.json", "search-index.json", "digest-images"];
for (const entry of required) {
  if (!fs.existsSync(path.join(root, entry))) {
    console.error(`Missing content entry: ${entry}`);
    process.exit(1);
  }
}

function walk(directory, prefix = "") {
  return fs.readdirSync(directory, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((entry) => {
      const absolute = path.join(directory, entry.name);
      const relative = path.posix.join(prefix, entry.name);
      if (entry.isDirectory()) return walk(absolute, relative);
      if (!entry.isFile() || relative === "manifest.json") return [];
      const bytes = fs.readFileSync(absolute);
      return [{
        path: relative,
        size: bytes.length,
        sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
      }];
    });
}

const files = walk(root);
const manifest = {
  contentVersion,
  generatedAt: new Date().toISOString(),
  codeSha,
  schemaVersion: 1,
  fileCount: files.length,
  files,
};

fs.writeFileSync(path.join(root, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({ contentVersion, fileCount: files.length }));
