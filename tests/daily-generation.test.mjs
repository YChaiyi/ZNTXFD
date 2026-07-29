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

test("action items stay in their matching topic instead of padding every topic", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "znt-daily-generation-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const runtimeDir = path.join(root, "runtime");
  const outputDir = path.join(root, "daily");

  const groupDir = path.join(runtimeDir, "out", `${groupOne}-群精华项目`);
  fs.mkdirSync(groupDir, { recursive: true });
  fs.writeFileSync(path.join(groupDir, "2026-05-20-essence.json"), JSON.stringify({
    group_name: groupOne,
    actions: [
      "监测 Claude 网络抖动并记录到值班日志。",
      "采购 B300 前先核对供货渠道报价。",
    ],
    stats: { message_count: 30, active_users: 6 },
    items: [
      {
        title: "Claude 订阅额度实测",
        summary: "对比模型订阅额度的真实消耗，给出更稳的订阅选择。",
        rating: "AAA",
        type: "deep",
        tags: ["Claude", "订阅"],
        quotes: [{ speaker: "成员甲", text: "订阅额度要按真实消耗算。" }],
      },
      {
        title: "Claude Code 老项目改造",
        summary: "用 Claude Code 改造老项目的交付流程整理。",
        rating: "A",
        type: "chat",
        tags: ["Claude Code", "编程"],
        quotes: [{ speaker: "成员乙", text: "老项目改造要先固定回归用例。" }],
      },
      {
        title: "电商增长打法复盘",
        summary: "电商增长的算账方式与避坑经验复盘。",
        rating: "AA",
        type: "deep",
        tags: ["电商", "增长"],
        quotes: [{ speaker: "成员丙", text: "增长要先算清成本。" }],
      },
    ],
  }, null, 2));

  generate(runtimeDir, outputDir, "2026-05-20");
  const report = JSON.parse(fs.readFileSync(path.join(outputDir, "2026-05-20.json"), "utf8"));

  const commerce = report.topics.find((topic) => topic.title === "商业化、电商与增长");
  assert.ok(commerce, "expected the commerce topic to exist");
  assert.deepEqual(
    commerce.action_items,
    [],
    "a topic without matching group actions must stay empty instead of receiving global defaults",
  );

  const claudeAction = "监测 Claude 网络抖动并记录到值班日志。";
  const holders = report.topics.filter((topic) => topic.action_items.includes(claudeAction));
  assert.equal(holders.length, 1, "an action item must not be duplicated across topics");
  assert.equal(holders[0].title, "模型、订阅与工具选择");

  const b300Action = "采购 B300 前先核对供货渠道报价。";
  assert.ok(
    report.topics.every((topic) => !topic.action_items.includes(b300Action)),
    "an action item matching no topic must be dropped, not spread everywhere",
  );
});

test("quality check rejects action items duplicated across topics", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "znt-daily-generation-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dailyDir = path.join(root, "daily");
  fs.mkdirSync(dailyDir, { recursive: true });

  const topicBase = {
    content: `${"结构化沉淀。".repeat(20)}\n\n### 关键沉淀\n- **要点**：说明。`,
    key_insights: ["要点"],
    tags: ["标签"],
  };
  fs.writeFileSync(path.join(dailyDir, "2026-05-20.json"), JSON.stringify({
    date: "2026-05-20",
    topics: [
      { ...topicBase, title: "话题一", action_items: ["重复的 建议"] },
      { ...topicBase, title: "话题二", action_items: ["重复的  建议"] },
    ],
  }, null, 2));

  assert.throws(() => execFileSync("python3", [
    "scripts/check_daily_quality.py",
    "2026-05-20",
    "--daily-dir", dailyDir,
  ], { encoding: "utf8", stdio: "pipe" }));
});
