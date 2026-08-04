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
    content: "### 关键沉淀\n- **要点**：端到端验证加入社群入口。",
    key_insights: ["转化入口应当全站可达"],
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
    "e2e-join-v1",
    "e2e-test",
  ], { stdio: "pipe" });
}

test("every page carries a join-community entrance and an independent contact block", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "znt-join-community-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeContent(root);
  const { baseUrl } = await startApp(t, {
    contentDir: root,
    env: { TOKEN_RANK_STORE_PATH: path.join(root, "token-rank-store.json") },
  });

  const home = await (await fetch(`${baseUrl}/`)).text();
  assert.ok(home.includes('href="#join"'), "top bar must carry a persistent join CTA");
  assert.ok(home.includes("加入社群"), "the CTA must be labeled 加入社群");
  const joinIndex = home.indexOf('id="join"');
  assert.ok(joinIndex >= 0, "the join section must exist on every page");
  assert.ok(
    home.indexOf("wangzongplus", joinIndex) > joinIndex,
    "the join section must carry the WeChat contact",
  );
  assert.ok(
    !home.includes("请联系微信"),
    "the disclaimer must no longer be the contact's only home",
  );

  const daily = await (await fetch(`${baseUrl}/daily/${date}`)).text();
  assert.ok(
    daily.includes('id="join"') && daily.includes('href="#join"'),
    "detail pages must carry the join section at the end of the read",
  );
});
