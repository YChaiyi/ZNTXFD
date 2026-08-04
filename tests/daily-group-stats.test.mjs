import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const groupOne = "智能体先锋队一群";

test("generator group names stay aligned with the site's digest groups", () => {
  const generator = fs.readFileSync("scripts/generate_daily_from_essence.py", "utf8");
  const dataLayer = fs.readFileSync("src/lib/data.ts", "utf8");
  const names = [
    "智能体先锋队一群",
    "智能体先锋队二群",
    "智能体先锋队三群",
    "智能体先锋队四群",
    "智能体先锋队五群",
  ];
  for (const name of names) {
    assert.ok(generator.includes(`"${name}"`), `generator must list ${name}`);
    assert.ok(dataLayer.includes(`"${name}"`), `DIGEST_GROUPS must list ${name}`);
  }
});

test("daily generation records per-group message stats", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "znt-daily-group-stats-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const runtimeDir = path.join(root, "runtime");
  const outputDir = path.join(root, "daily");

  const groupDir = path.join(runtimeDir, "out", `${groupOne}-群精华项目`);
  fs.mkdirSync(groupDir, { recursive: true });
  fs.writeFileSync(path.join(groupDir, "2026-05-20-essence.json"), JSON.stringify({
    group_name: groupOne,
    actions: [],
    stats: { message_count: 12, active_users: 4 },
    items: [{
      title: "群维度统计",
      summary: "首页群卡片需要每个群的真实消息数，而不是全站总数。",
      rating: "AA",
      type: "deep",
      tags: ["流程"],
      quotes: [{ speaker: "测试成员", text: "每个群展示自己的数据。" }],
    }],
  }, null, 2));

  execFileSync("python3", [
    "scripts/generate_daily_from_essence.py",
    "2026-05-20",
    "--runtime-dir", runtimeDir,
    "--output-dir", outputDir,
  ], { encoding: "utf8", stdio: "pipe" });

  const report = JSON.parse(fs.readFileSync(path.join(outputDir, "2026-05-20.json"), "utf8"));
  assert.equal(report.stats.total_messages, 12);
  assert.deepEqual(report.stats.groups, [
    { name: groupOne, message_count: 12, active_users: 4 },
  ]);
});
