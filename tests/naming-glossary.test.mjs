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
    content: "### 关键沉淀\n- **要点**：端到端验证全站命名词表。",
    key_insights: ["同一事物只应有一个名字"],
    tools_mentioned: [],
    action_items: [],
    contributors: ["测试成员"],
    tags: ["编程"],
  };
  fs.writeFileSync(
    path.join(root, "daily", `${date}.json`),
    JSON.stringify({
      date,
      title: "端到端测试期刊",
      topics: [topic],
      stats: { total_messages: 100, active_members: 10 },
    }),
  );
  fs.writeFileSync(
    path.join(root, "index.json"),
    JSON.stringify([{
      date,
      title: "端到端测试期刊",
      tags: ["编程"],
      topic_count: 1,
      total_messages: 100,
      active_members: 10,
    }]),
  );
  fs.writeFileSync(path.join(root, "search-index.json"), "[]");
  fs.writeFileSync(path.join(root, "knowledge", "index.json"), "[]");
  execFileSync(process.execPath, [
    path.join(projectRoot, "scripts", "build_content_manifest.mjs"),
    root,
    "e2e-naming-v1",
    "e2e-test",
  ], { stdio: "pipe" });
}

function visibleText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replace(/<[^>]+>/g, "");
}

test("the site speaks one vocabulary: no 弹药 jargon, no doubled 论坛, converged nav", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "znt-naming-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeContent(root);
  const { baseUrl } = await startApp(t, {
    contentDir: root,
    env: { TOKEN_RANK_STORE_PATH: path.join(root, "token-rank-store.json") },
  });

  for (const page of ["/", `/daily/${date}`, "/search", "/topics", "/daily"]) {
    const html = await (await fetch(`${baseUrl}${page}`)).text();
    const text = visibleText(html);
    assert.ok(!text.includes("弹药"), `${page} must not use 弹药 jargon`);
    assert.ok(!text.includes("论坛论坛"), `${page} must not repeat 论坛`);
  }

  const home = await (await fetch(`${baseUrl}/`)).text();
  assert.ok(
    home.includes("搜索工具、观点、案例"),
    "top bar search placeholder must speak plain language",
  );
  const footerIndex = home.indexOf("<footer");
  const forumIndexes = [];
  for (let i = home.indexOf("bbs.znt.group"); i >= 0; i = home.indexOf("bbs.znt.group", i + 1)) {
    forumIndexes.push(i);
  }
  assert.ok(forumIndexes.length > 0, "the forum link must stay reachable");
  assert.ok(
    forumIndexes.every((index) => index > footerIndex),
    "the forum entrance must live in the footer area, not the top nav",
  );

  const daily = await (await fetch(`${baseUrl}/daily/${date}`)).text();
  assert.ok(daily.includes("本期索引"), "the daily page must use 本期索引");
});
