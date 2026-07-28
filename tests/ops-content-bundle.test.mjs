import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const opsBuild = "ops/lib/build-content-manifest.mjs";
const opsValidate = "ops/lib/validate-content-bundle.mjs";

function createBundle() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "znt-ops-content-"));
  fs.mkdirSync(path.join(root, "daily"), { recursive: true });
  fs.mkdirSync(path.join(root, "knowledge", "items"), { recursive: true });
  fs.mkdirSync(path.join(root, "digest-images"), { recursive: true });
  fs.writeFileSync(path.join(root, "daily", "2026-07-28.json"), JSON.stringify({
    date: "2026-07-28",
    title: "测试日报",
    topics: [],
  }));
  fs.writeFileSync(path.join(root, "index.json"), JSON.stringify([{
    date: "2026-07-28",
    title: "测试日报",
  }]));
  fs.writeFileSync(path.join(root, "search-index.json"), "[]");
  fs.writeFileSync(path.join(root, "knowledge", "index.json"), "[]");
  return root;
}

function build(root, version) {
  execFileSync(process.execPath, [opsBuild, root, version, "a".repeat(40)]);
}

test("VPS content validator accepts a complete bundle and rejects missing knowledge", (t) => {
  const root = createBundle();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  build(root, "ops-valid");
  execFileSync(process.execPath, [opsValidate, root, "2026-07-28"]);

  fs.writeFileSync(path.join(root, "knowledge", "index.json"), JSON.stringify([{
    id: "2026-07-28-example",
    title: "缺失详情",
  }]));
  build(root, "ops-missing-detail");
  assert.throws(() => {
    execFileSync(process.execPath, [opsValidate, root]);
  });
});
