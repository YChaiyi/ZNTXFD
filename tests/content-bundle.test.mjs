import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

function createBundle() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "znt-content-bundle-"));
  fs.mkdirSync(path.join(root, "daily"), { recursive: true });
  fs.mkdirSync(path.join(root, "knowledge", "items"), { recursive: true });
  fs.mkdirSync(path.join(root, "digest-images", "2026-07-28"), { recursive: true });
  fs.writeFileSync(path.join(root, "daily", "2026-07-28.json"), JSON.stringify({
    date: "2026-07-28",
    title: "测试日报",
    topics: [],
    stats: { total_messages: 0, active_members: 0 },
  }));
  fs.writeFileSync(path.join(root, "index.json"), JSON.stringify([{
    date: "2026-07-28",
    title: "测试日报",
    tags: [],
    topic_count: 0,
    total_messages: 0,
    active_members: 0,
  }]));
  fs.writeFileSync(path.join(root, "search-index.json"), "[]");
  fs.writeFileSync(path.join(root, "knowledge", "index.json"), "[]");
  return root;
}

test("content manifest covers the bundle and detects mutations", (t) => {
  const root = createBundle();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  execFileSync(process.execPath, ["scripts/build_content_manifest.mjs", root, "content-test", "a".repeat(40)]);
  execFileSync(process.execPath, ["scripts/validate_content_bundle.mjs", root, "2026-07-28"]);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
  assert.equal(manifest.contentVersion, "content-test");
  assert.equal(manifest.fileCount, manifest.files.length);

  fs.appendFileSync(path.join(root, "index.json"), "\n");
  for (const validator of [
    "scripts/validate_content_bundle.mjs",
    "ops/lib/validate-content-bundle.mjs",
  ]) {
    assert.throws(() => {
      execFileSync(process.execPath, [validator, root]);
    });
  }
});

test("content bundle requires at least one indexed daily report", (t) => {
  const root = createBundle();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "index.json"), "[]");
  execFileSync(process.execPath, ["scripts/build_content_manifest.mjs", root, "empty-index", "b".repeat(40)]);
  for (const validator of [
    "scripts/validate_content_bundle.mjs",
    "ops/lib/validate-content-bundle.mjs",
  ]) {
    assert.throws(() => {
      execFileSync(process.execPath, [validator, root]);
    });
  }
});

test("content bundle rejects a knowledge index entry without its detail file", (t) => {
  const root = createBundle();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "knowledge", "index.json"), JSON.stringify([{
    id: "2026-07-28-g1-example",
    title: "缺失详情的知识",
  }]));
  execFileSync(process.execPath, ["scripts/build_content_manifest.mjs", root, "missing-detail", "c".repeat(40)]);

  assert.throws(() => {
    execFileSync(process.execPath, ["scripts/validate_content_bundle.mjs", root]);
  });
});

test("content bundle accepts safe UTF-8 knowledge paths", (t) => {
  const root = createBundle();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const entries = [
    { id: "2026-07-28-中文知识", title: "中文知识" },
    { id: "2026-07-28-阿尔法知识", title: "阿尔法知识" },
  ];
  fs.writeFileSync(path.join(root, "knowledge", "index.json"), JSON.stringify(entries));
  for (const entry of entries) {
    fs.writeFileSync(path.join(root, "knowledge", "items", `${entry.id}.json`), JSON.stringify(entry));
  }
  execFileSync(process.execPath, ["scripts/build_content_manifest.mjs", root, "utf8-path", "d".repeat(40)]);
  const manifestPath = path.join(root, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.files.reverse();
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));

  for (const validator of [
    "scripts/validate_content_bundle.mjs",
    "ops/lib/validate-content-bundle.mjs",
  ]) {
    execFileSync(process.execPath, [validator, root, "2026-07-28"]);
  }
});

test("content bundle rejects hidden versions and unexpected top-level files", (t) => {
  const root = createBundle();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  execFileSync(process.execPath, ["scripts/build_content_manifest.mjs", root, ".hidden", "e".repeat(40)]);
  for (const validator of [
    "scripts/validate_content_bundle.mjs",
    "ops/lib/validate-content-bundle.mjs",
  ]) {
    assert.throws(() => execFileSync(process.execPath, [validator, root], { stdio: "ignore" }));
  }

  fs.writeFileSync(path.join(root, "unexpected.txt"), "not content\n");
  execFileSync(process.execPath, ["scripts/build_content_manifest.mjs", root, "valid-version", "f".repeat(40)]);
  for (const validator of [
    "scripts/validate_content_bundle.mjs",
    "ops/lib/validate-content-bundle.mjs",
  ]) {
    assert.throws(() => execFileSync(process.execPath, [validator, root], { stdio: "ignore" }));
  }
});
