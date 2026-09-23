import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { startApp } from "./app-server.mjs";

const projectRoot = process.cwd();
const date = "2026-07-28";

const GROUPS = [
  { key: "group1", name: "智能体先锋队一群", messages: 101, active: 8 },
  { key: "group2", name: "智能体先锋队二群", messages: 202, active: 9 },
  { key: "group3", name: "智能体先锋队三群", messages: 303, active: 10 },
  { key: "group4", name: "智能体先锋队四群", messages: 404, active: 11 },
  { key: "group5", name: "智能体先锋队五群", messages: 505, active: 12 },
];

function writeContent(root, { withGroups }) {
  fs.mkdirSync(path.join(root, "daily"), { recursive: true });
  fs.mkdirSync(path.join(root, "knowledge"), { recursive: true });
  fs.mkdirSync(path.join(root, "digest-images", date), { recursive: true });

  const stats = {
    total_messages: 1491,
    active_members: 40,
    ...(withGroups
      ? {
          groups: GROUPS.map((group) => ({
            name: group.name,
            message_count: group.messages,
            active_users: group.active,
          })),
        }
      : {}),
  };
  const topic = {
    title: "AI 编程与项目交付",
    content: "### 关键沉淀\n- **要点**：端到端验证首页群卡片的链接与数据来源。",
    key_insights: ["首页群卡片应展示每个群的真实数据"],
    tools_mentioned: [],
    action_items: [],
    contributors: ["测试成员"],
    tags: ["编程"],
  };
  fs.writeFileSync(
    path.join(root, "daily", `${date}.json`),
    JSON.stringify({ date, title: "端到端测试期刊", topics: [topic], stats }),
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
    "e2e-fixture-v1",
    "e2e-test",
  ], { stdio: "pipe" });
}

function startFixtureApp(t, root) {
  return startApp(t, {
    contentDir: root,
    env: { TOKEN_RANK_STORE_PATH: path.join(root, "token-rank-store.json") },
  });
}

test("homepage group cards link to distinct daily anchors with per-group counts", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "znt-homepage-cards-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeContent(root, { withGroups: true });
  const { baseUrl } = await startFixtureApp(t, root);

  const home = await (await fetch(`${baseUrl}/`)).text();
  for (const group of GROUPS) {
    assert.ok(
      home.includes(`/daily/${date}#digest-${group.key}`),
      `homepage must link ${group.key} to its own daily section`,
    );
    assert.match(
      home,
      new RegExp(`data-group-count="${group.key}"[^>]*>${group.messages}<`),
      `homepage must show the real message count for ${group.key}`,
    );
  }

  const daily = await (await fetch(`${baseUrl}/daily/${date}`)).text();
  for (const group of GROUPS) {
    assert.ok(
      daily.includes(`id="digest-${group.key}"`),
      `daily page must anchor the ${group.key} section`,
    );
  }
});

test("homepage group cards degrade gracefully for legacy content without group stats", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "znt-homepage-cards-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeContent(root, { withGroups: false });
  const { baseUrl } = await startFixtureApp(t, root);

  const home = await (await fetch(`${baseUrl}/`)).text();
  assert.ok(
    !home.includes("data-group-count="),
    "legacy content must not fabricate identical per-card counts",
  );
  for (const group of GROUPS) {
    assert.ok(
      home.includes(`/daily/${date}#digest-${group.key}`),
      `anchors must still work for legacy content (${group.key})`,
    );
  }
});
