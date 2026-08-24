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
    content: "分类描述。\n\n### 关键沉淀\n- **要点**：翻页可供性验证。",
    key_insights: ["禁用态要能被识别"],
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
    "e2e-paging-v1",
    "e2e-test",
  ], { stdio: "pipe" });
}

test("issue switcher signals disabled ends, drops the self-link, and hides avatar initials", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "znt-paging-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeContent(root);
  const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), "znt-paging-store-"));
  t.after(() => fs.rmSync(storeDir, { recursive: true, force: true }));
  const { baseUrl } = await startApp(t, {
    contentDir: root,
    env: { TOKEN_RANK_STORE_PATH: path.join(storeDir, "store.json") },
  });

  const daily = await (await fetch(`${baseUrl}/daily/${date}`)).text();

  // Single-issue fixture: both ends of the switcher are disabled.
  assert.ok(
    daily.includes('aria-disabled="true"'),
    "unreachable switcher ends must be marked disabled",
  );
  assert.ok(
    daily.includes("已是最新一期"),
    "the dead next control must explain itself",
  );
  assert.ok(
    daily.includes("已是最早一期"),
    "the dead previous control must explain itself",
  );

  // 本期 is a status cell, not a link to the archive.
  const switcherStart = daily.indexOf('aria-label="切换期刊"');
  const switcherEnd = daily.indexOf("</nav>", switcherStart);
  const switcher = daily.slice(switcherStart, switcherEnd);
  assert.ok(switcherStart >= 0, "the switcher must exist");
  assert.ok(
    !switcher.includes('href="/daily"'),
    "本期 must not link to the archive",
  );
  assert.ok(
    switcher.includes('aria-current="page"'),
    "本期 must be marked as the current page",
  );

  // Avatar initials stay visual-only; text extraction reads the name once.
  assert.match(
    daily,
    /aria-hidden="true"[^>]*>成</,
    "the contributor avatar initial must be decorative",
  );
});
