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
    content: "分类描述。\n\n### 关键沉淀\n- **要点**：移动端触控热区验证。",
    key_insights: ["热区必须够大"],
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
      stats: {
        total_messages: 100,
        active_members: 10,
        groups: [{ name: "智能体先锋队一群", message_count: 100, active_users: 10 }],
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
      total_messages: 100,
      active_members: 10,
    }]),
  );
  fs.writeFileSync(path.join(root, "search-index.json"), "[]");
  fs.writeFileSync(path.join(root, "knowledge", "index.json"), "[]");
  execFileSync(process.execPath, [
    path.join(projectRoot, "scripts", "build_content_manifest.mjs"),
    root,
    "e2e-touch-v1",
    "e2e-test",
  ], { stdio: "pipe" });
}

test("mobile nav converges to four tabs plus 更多 and targets carry hit-area padding", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "znt-touch-targets-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeContent(root);
  const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), "znt-touch-store-"));
  t.after(() => fs.rmSync(storeDir, { recursive: true, force: true }));
  const { baseUrl } = await startApp(t, {
    contentDir: root,
    env: { TOKEN_RANK_STORE_PATH: path.join(storeDir, "store.json") },
  });

  const home = await (await fetch(`${baseUrl}/`)).text();

  // Bottom nav: four primary tabs plus a 更多 toggle, no seven-column grid.
  assert.ok(!home.includes("grid-cols-7"), "the seven-tab mobile nav must be gone");
  assert.ok(home.includes(">更多<"), "the mobile nav must offer a 更多 entry");
  const moreIndex = home.indexOf('data-more-panel');
  assert.ok(moreIndex >= 0, "the 更多 panel must be server-rendered for its links");
  for (const href of ["bbs.znt.group", 'href="/token-rank"', 'href="/search"']) {
    assert.ok(
      home.indexOf(href, moreIndex) > moreIndex,
      `the 更多 panel must carry the demoted entry (${href})`,
    );
  }

  // Small interactive chips and links declare the extended hit area.
  assert.ok(
    home.includes("touch-target"),
    "small interactive elements must extend their hit area to 44px",
  );
});
