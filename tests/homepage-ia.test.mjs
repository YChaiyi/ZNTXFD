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
    content: "### 关键沉淀\n- **要点**：端到端验证首页信息架构。",
    key_insights: ["首页应当五秒内讲清价值"],
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
      stats: {
        total_messages: 1491,
        active_members: 40,
        groups: [
          { name: "智能体先锋队一群", message_count: 101, active_users: 8 },
          { name: "智能体先锋队二群", message_count: 202, active_users: 9 },
          { name: "智能体先锋队三群", message_count: 303, active_users: 10 },
          { name: "智能体先锋队四群", message_count: 404, active_users: 11 },
          { name: "智能体先锋队五群", message_count: 505, active_users: 12 },
        ],
      },
    }),
  );
  fs.writeFileSync(
    path.join(root, "index.json"),
    JSON.stringify([{
      date,
      title: "端到端测试期刊",
      tags: ["编程"],
      topic_count: 1,
      total_messages: 1491,
      active_members: 40,
    }]),
  );
  fs.writeFileSync(path.join(root, "search-index.json"), "[]");
  fs.writeFileSync(path.join(root, "knowledge", "index.json"), "[]");
  execFileSync(process.execPath, [
    path.join(projectRoot, "scripts", "build_content_manifest.mjs"),
    root,
    "e2e-ia-v1",
    "e2e-test",
  ], { stdio: "pipe" });
}

test("homepage leads with a value proposition and only four core blocks", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "znt-homepage-ia-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeContent(root);
  const { baseUrl } = await startApp(t, {
    contentDir: root,
    env: { TOKEN_RANK_STORE_PATH: path.join(root, "token-rank-store.json") },
  });

  const home = await (await fetch(`${baseUrl}/`)).text();

  // Hero: one-line positioning plus primary and secondary CTA (#16).
  assert.ok(
    home.includes("每天从 5 个 AI 实战社群沉淀可信知识"),
    "hero must state the value proposition",
  );
  assert.ok(
    (home.match(/href="#join"/g) ?? []).length >= 2,
    "hero must carry a primary join CTA in addition to the top bar one",
  );
  assert.ok(
    home.includes("看今日期刊"),
    "hero must carry a secondary CTA to today's issue",
  );

  // Social proof stays on the first screen as a data band (#16).
  for (const label of ["期内容", "条消息", "高价值观点", "贡献者"]) {
    assert.ok(home.includes(label), `data band must keep the ${label} stat`);
  }

  // Core blocks survive (#15).
  assert.ok(home.includes("编辑精选"), "editor picks stay a core block");
  assert.ok(home.includes("热门提问"), "hot questions stay a core block");

  // Demoted blocks lose their section headings but keep text entrances (#15).
  for (const heading of ["往期精华", "本期弹药索引", "Token 消耗榜", "正在形成的知识脉络"]) {
    assert.ok(
      !home.includes(`>${heading}<`),
      `${heading} must no longer render as a full section`,
    );
  }
  for (const href of ['href="/daily"', 'href="/token-rank"', 'href="/topics"']) {
    assert.ok(home.includes(href), `demoted block must keep a text entrance (${href})`);
  }

  // Group anchors from #26 survive as chips inside the hero issue card.
  for (const key of ["group1", "group2", "group3", "group4", "group5"]) {
    assert.ok(
      home.includes(`/daily/${date}#digest-${key}`),
      `group chip ${key} must keep its anchor`,
    );
  }
});
