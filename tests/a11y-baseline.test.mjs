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
    content: "分类描述。\n\n### 关键沉淀\n- **要点**：无障碍基线验证。",
    key_insights: ["焦点态与对比度是底线"],
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
    "e2e-a11y-v1",
    "e2e-test",
  ], { stdio: "pipe" });
}

test("a11y baseline: focus outline, honest text tokens, structured archive cards", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "znt-a11y-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeContent(root);
  const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), "znt-a11y-store-"));
  t.after(() => fs.rmSync(storeDir, { recursive: true, force: true }));
  const { baseUrl } = await startApp(t, {
    contentDir: root,
    env: { TOKEN_RANK_STORE_PATH: path.join(storeDir, "store.json") },
  });

  const home = await (await fetch(`${baseUrl}/`)).text();

  // Global keyboard focus outline is compiled into the stylesheet.
  const cssHref = home.match(/\/_next\/static\/css\/[^"]+\.css/)?.[0];
  assert.ok(cssHref, "the page must reference a compiled stylesheet");
  const css = await (await fetch(`${baseUrl}${cssHref}`)).text();
  assert.match(
    css,
    /:focus-visible\{outline:2px solid/,
    "keyboard focus must draw a 2px outline",
  );

  // The disclaimer is readable text and must not use the disabled token.
  const disclaimerIndex = home.indexOf("免责声明：");
  assert.ok(disclaimerIndex >= 0, "the disclaimer must exist");
  const disclaimerHead = home.slice(Math.max(0, disclaimerIndex - 300), disclaimerIndex);
  assert.ok(
    !disclaimerHead.includes("text-foreground-disabled"),
    "the disclaimer must not render in below-contrast disabled color",
  );

  // Metadata never drops below 12px.
  for (const page of [home]) {
    assert.ok(
      !page.includes("text-[11px]") && !page.includes("text-[10px]"),
      "metadata text must stay at or above 12px",
    );
  }

  const dailyList = await (await fetch(`${baseUrl}/daily`)).text();
  assert.ok(
    !dailyList.includes("text-[11px]") && !dailyList.includes("text-[10px]"),
    "archive metadata must stay at or above 12px",
  );

  // Archive cards: article root, title as the stretched link with a label.
  assert.match(
    dailyList,
    /<article[^>]*data-archive-card/,
    "archive cards must be articles, not whole-card links",
  );
  assert.ok(
    dailyList.includes(`aria-label="端到端测试期刊`),
    "the archive card title link must carry a concise label",
  );
  assert.ok(
    !dailyList.includes('text-foreground-disabled">消息'),
    "archive stat labels must use the readable muted token",
  );
});
