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
    content: "### 关键沉淀\n- **要点**：端到端验证知识卡片模板。",
    key_insights: ["卡片需要清晰的视觉分层"],
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
  fs.writeFileSync(
    path.join(root, "knowledge", "index.json"),
    JSON.stringify([
      {
        slug: "aaa-knowledge-entry",
        title: "Codex 额度实战知识条目",
        claim: "结论：模板必须分层。",
        summary: "摘要：卡片按徽章、标题、摘要、元数据四层渲染。",
        category: "AI 编程与项目交付",
        rating: "AAA",
        tags: ["Codex"],
        tools: ["Codex"],
        contributors: ["测试成员"],
        updated_at: date,
        sources: [{ date, quote: "证据原话。", speaker: "测试成员" }],
      },
    ]),
  );
  execFileSync(process.execPath, [
    path.join(projectRoot, "scripts", "build_content_manifest.mjs"),
    root,
    "e2e-cards-v1",
    "e2e-test",
  ], { stdio: "pipe" });
}

test("knowledge cards use the four-layer template with a real rating badge", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "znt-knowledge-cards-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeContent(root);
  const { baseUrl } = await startApp(t, {
    contentDir: root,
    env: { TOKEN_RANK_STORE_PATH: path.join(root, "token-rank-store.json") },
  });

  for (const [page, label] of [["/", "homepage"], ["/knowledge", "knowledge page"]]) {
    const html = await (await fetch(`${baseUrl}${page}`)).text();
    assert.ok(
      html.includes("data-knowledge-card"),
      `${label} must render the shared knowledge card`,
    );
    assert.ok(
      html.includes('data-rating="AAA"'),
      `${label} must render the item's real rating badge`,
    );
    assert.match(
      html,
      /<article[^>]*data-knowledge-card/,
      `${label} card root must be an article, with the title as the link`,
    );
    assert.ok(
      html.includes('href="/knowledge/aaa-knowledge-entry"'),
      `${label} must link to the knowledge item`,
    );
    for (const metadata of ["证据", "来源", "引用"]) {
      assert.ok(html.includes(metadata), `${label} card must keep the ${metadata} metadata`);
    }
  }
});
