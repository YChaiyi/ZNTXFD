import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { startApp } from "./app-server.mjs";

const projectRoot = process.cwd();
const date = "2026-07-28";
const beijingToday = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);

test("generator omits the 关键沉淀 heading when no item has a summary", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "znt-empty-sections-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const runtimeDir = path.join(root, "runtime");
  const outputDir = path.join(root, "daily");
  const groupDir = path.join(runtimeDir, "out", "智能体先锋队一群-群精华项目");
  fs.mkdirSync(groupDir, { recursive: true });
  fs.writeFileSync(path.join(groupDir, "2026-05-20-essence.json"), JSON.stringify({
    group_name: "智能体先锋队一群",
    actions: [],
    stats: { message_count: 8, active_users: 3 },
    items: [{
      title: "只有标题没有摘要",
      summary: "",
      rating: "A",
      type: "chat",
      tags: ["流程"],
      quotes: [],
    }],
  }));

  execFileSync("python3", [
    "scripts/generate_daily_from_essence.py",
    "2026-05-20",
    "--runtime-dir", runtimeDir,
    "--output-dir", outputDir,
  ], { encoding: "utf8", stdio: "pipe" });

  const report = JSON.parse(fs.readFileSync(path.join(outputDir, "2026-05-20.json"), "utf8"));
  for (const topic of report.topics) {
    assert.ok(
      !topic.content.includes("### 关键沉淀"),
      "a topic without summarized items must not carry a bare 关键沉淀 heading",
    );
  }
});

test("quality check rejects a section heading with no body", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "znt-empty-sections-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dailyDir = path.join(root, "daily");
  fs.mkdirSync(dailyDir, { recursive: true });
  fs.writeFileSync(path.join(dailyDir, "2026-05-20.json"), JSON.stringify({
    date: "2026-05-20",
    topics: [{
      title: "话题一",
      content: `${"结构化沉淀。".repeat(20)}\n\n### 关键沉淀`,
      key_insights: ["要点"],
      tags: ["标签"],
      action_items: [],
    }],
  }));

  assert.throws(() => execFileSync("python3", [
    "scripts/check_daily_quality.py",
    "2026-05-20",
    "--daily-dir", dailyDir,
  ], { encoding: "utf8", stdio: "pipe" }));
});

function writeContent(root) {
  fs.mkdirSync(path.join(root, "daily"), { recursive: true });
  fs.mkdirSync(path.join(root, "knowledge"), { recursive: true });
  fs.mkdirSync(path.join(root, "digest-images", date), { recursive: true });

  const topic = {
    title: "AI 编程与项目交付",
    content: "分类描述：验证空小节处理。\n\n### 关键沉淀\n\n### 证据原话\n- 成员甲：这是一条真实证据。",
    key_insights: ["空小节不应出现在页面上"],
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
    "e2e-empty-v1",
    "e2e-test",
  ], { stdio: "pipe" });
}

function storeUser(userId, name) {
  return {
    userId,
    tokenHash: `hash-${userId}`,
    name,
    role: "测试",
    createdAt: "2026-07-01T00:00:00.000Z",
    public: true,
    active: true,
  };
}

function storeRecord(userId, totalTokens) {
  return {
    userId,
    tokenHash: `hash-${userId}`,
    deviceId: `device-${userId}`,
    clientVersion: "0.2.0",
    date: beijingToday,
    tool: "codex",
    model: "test",
    inputTokens: totalTokens,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens,
    inputTokenSemantics: "fresh",
    createdAt: new Date().toISOString(),
  };
}

function writeStore(filePath, users, records) {
  fs.writeFileSync(filePath, JSON.stringify({
    revision: 1,
    users,
    records,
    collectors: [],
    lastUploadAt: new Date().toISOString(),
  }));
}

test("legacy empty sections are hidden and zero token rows leave the board", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "znt-empty-states-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeContent(root);
  // The store must live outside the content root: the manifest describes
  // the complete bundle, and any extra file fails content validation.
  const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), "znt-empty-store-"));
  t.after(() => fs.rmSync(storeDir, { recursive: true, force: true }));
  const storePath = path.join(storeDir, "token-rank-store.json");
  writeStore(storePath, [storeUser(1, "有量成员"), storeUser(2, "零值成员")], [storeRecord(1, 5000)]);
  const { baseUrl } = await startApp(t, {
    contentDir: root,
    env: { TOKEN_RANK_STORE_PATH: storePath },
  });

  const daily = await (await fetch(`${baseUrl}/daily/${date}`)).text();
  assert.ok(
    !daily.includes(">关键沉淀<"),
    "a legacy bare 关键沉淀 heading must be hidden by the renderer",
  );
  assert.ok(
    daily.includes(">证据原话<"),
    "sections with real content must survive",
  );
  assert.ok(
    daily.includes("这是一条真实证据"),
    "the section body must render instead of being swallowed with the heading",
  );

  const board = await (await fetch(`${baseUrl}/token-rank`)).text();
  assert.ok(board.includes("有量成员"), "members with usage stay on the board");
  assert.ok(!board.includes("零值成员"), "zero-value members must not pad the board");
});

test("an all-zero board shows the explicit empty state", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "znt-empty-states-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeContent(root);
  const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), "znt-empty-store-"));
  t.after(() => fs.rmSync(storeDir, { recursive: true, force: true }));
  const storePath = path.join(storeDir, "token-rank-store.json");
  writeStore(storePath, [storeUser(2, "零值成员")], []);
  const { baseUrl } = await startApp(t, {
    contentDir: root,
    env: { TOKEN_RANK_STORE_PATH: storePath },
  });

  const board = await (await fetch(`${baseUrl}/token-rank`)).text();
  assert.ok(!board.includes("零值成员"), "zero-value members must not appear");
  assert.ok(board.includes("暂无真实上榜数据"), "the explicit empty state must show");
});
