import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const groupOne = "智能体先锋队一群";

function writeEssence(runtimeDir, date, group = groupOne) {
  const groupDir = path.join(runtimeDir, "out", `${group}-群精华项目`);
  fs.mkdirSync(groupDir, { recursive: true });
  fs.writeFileSync(path.join(groupDir, `${date}-essence.json`), JSON.stringify({
    group_name: group,
    actions: ["把有效的流程整理成可复用的 SOP。"],
    stats: { message_count: 12, active_users: 4 },
    items: [{
      title: "历史日报只读取当时已成立的群",
      summary: "日报生成会依据群的启用日期读取群精华，历史日期不应要求后来才成立的群提供文件。",
      rating: "AA",
      type: "deep",
      tags: ["日报", "流程"],
      quotes: [{ speaker: "测试成员", text: "历史数据必须按当时实际存在的群处理。" }],
    }],
  }, null, 2));
}

function generate(runtimeDir, outputDir, date) {
  return execFileSync("python3", [
    "scripts/generate_daily_from_essence.py",
    date,
    "--runtime-dir", runtimeDir,
    "--output-dir", outputDir,
  ], { encoding: "utf8", stdio: "pipe" });
}

test("historical daily generation ignores groups that were not active yet", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "znt-daily-generation-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const runtimeDir = path.join(root, "runtime");
  const outputDir = path.join(root, "daily");

  writeEssence(runtimeDir, "2026-05-20");
  generate(runtimeDir, outputDir, "2026-05-20");

  const report = JSON.parse(fs.readFileSync(path.join(outputDir, "2026-05-20.json"), "utf8"));
  assert.equal(report.date, "2026-05-20");
  assert.equal(report.stats.total_messages, 12);
  assert.ok(report.topics.length > 0);
});

test("daily generation still rejects a missing group that was active on the date", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "znt-daily-generation-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const runtimeDir = path.join(root, "runtime");
  const outputDir = path.join(root, "daily");

  writeEssence(runtimeDir, "2026-06-02");
  assert.throws(() => generate(runtimeDir, outputDir, "2026-06-02"));
});
