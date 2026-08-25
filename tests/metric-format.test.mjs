import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { startApp } from "./app-server.mjs";

const projectRoot = process.cwd();
const date = "2026-07-28";

function writeContent(root) {
  fs.mkdirSync(path.join(root, "daily"), { recursive: true });
  fs.mkdirSync(path.join(root, "knowledge"), { recursive: true });
  fs.mkdirSync(path.join(root, "digest-images", date), { recursive: true });

  const topic = {
    title: "AI 编程与项目交付",
    content: "分类描述。\n\n### 关键沉淀\n- **要点**：数据口径统一验证。",
    key_insights: ["数字要有单位和换算"],
    tools_mentioned: [],
    action_items: [],
    contributors: ["成员甲"],
    tags: ["编程"],
  };
  fs.writeFileSync(
    path.join(root, "daily", `${date}.json`),
    JSON.stringify({
      date,
      title: "端到端测试期刊",
      topics: [topic],
      stats: { total_messages: 123456789, active_members: 10 },
    }),
  );
  fs.writeFileSync(
    path.join(root, "index.json"),
    JSON.stringify([{
      date,
      title: "端到端测试期刊",
      tags: ["编程"],
      topic_count: 1,
      total_messages: 123456789,
      active_members: 10,
    }]),
  );
  fs.writeFileSync(path.join(root, "search-index.json"), "[]");
  fs.writeFileSync(
    path.join(root, "knowledge", "index.json"),
    JSON.stringify([{
      slug: "codex-entry",
      title: "Codex 额度实战知识条目",
      claim: "结论。",
      summary: "摘要。",
      category: "AI 编程与项目交付",
      rating: "AAA",
      tags: ["Codex"],
      tools: ["Codex"],
      contributors: ["成员甲"],
      updated_at: date,
      sources: [{ date, quote: "证据原话。", speaker: "成员甲" }],
    }]),
  );
  execFileSync(process.execPath, [
    path.join(projectRoot, "scripts", "build_content_manifest.mjs"),
    root,
    "e2e-metric-v1",
    "e2e-test",
  ], { stdio: "pipe" });
}

test("numbers convert to 亿, archive status is labeled, and fabricated heat is gone", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "znt-metric-format-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeContent(root);
  const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), "znt-metric-store-"));
  t.after(() => fs.rmSync(storeDir, { recursive: true, force: true }));
  const { baseUrl } = await startApp(t, {
    contentDir: root,
    env: { TOKEN_RANK_STORE_PATH: path.join(storeDir, "store.json") },
  });

  const home = await (await fetch(`${baseUrl}/`)).text();
  assert.ok(
    home.includes("1.2亿"),
    "large counts must convert to the 亿 tier instead of 12345.7万",
  );

  const dailyList = await (await fetch(`${baseUrl}/daily`)).text();
  assert.ok(
    dailyList.includes("群已归档"),
    "archive cards must explain the N/M ratio as 群已归档",
  );

  const questions = await (await fetch(`${baseUrl}/questions`)).text();
  assert.ok(
    !questions.includes("讨论热度"),
    "the fabricated percentage heat metric must be gone",
  );
  assert.ok(
    questions.includes("相关知识"),
    "the heat tile is replaced by a real countable metric",
  );
});
