import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const DEVICE_ID = "c".repeat(32);

function beijingDate(time = Date.now()) {
  return new Date(time + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function addDays(date, offset) {
  const time = Date.parse(`${date}T00:00:00Z`) + offset * 86400000;
  return new Date(time).toISOString().slice(0, 10);
}

function legacyRecord({ date, tool = "codex", model }) {
  return {
    date,
    tool,
    model,
    inputTokens: 100,
    outputTokens: 10,
    cacheReadTokens: 60,
    cacheWriteTokens: 0,
    totalTokens: 170,
  };
}

function writeCodexFixture(home, nowMs) {
  const id = "019f87c4-0b80-7000-8000-000000000091";
  const dir = path.join(home, ".codex", "sessions", "2026", "07", "22");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `rollout-2026-07-22T00-00-00-${id}.jsonl`);
  const metaTime = new Date(nowMs - 120_000).toISOString();
  const usageTime = new Date(nowMs - 60_000).toISOString();
  const lines = [
    {
      timestamp: metaTime,
      type: "session_meta",
      payload: { id, source: "vscode" },
    },
    {
      timestamp: usageTime,
      type: "turn_context",
      payload: { model: "gpt-5.6-sol" },
    },
    {
      timestamp: usageTime,
      type: "event_msg",
      payload: {
        type: "token_count",
        info: {
          total_token_usage: {
            input_tokens: 100,
            cached_input_tokens: 60,
            cache_write_input_tokens: 0,
            output_tokens: 10,
            reasoning_output_tokens: 4,
            total_tokens: 110,
          },
        },
      },
    },
  ];
  fs.writeFileSync(file, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`);
}

function writeIncompleteCodexFixture(home, nowMs) {
  const id = "019f87c4-0b80-7000-8000-000000000092";
  const dir = path.join(home, ".codex", "sessions", "2026", "07", "22");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `rollout-2026-07-22T00-00-00-${id}.jsonl`);
  const metaTime = new Date(nowMs - 180_000).toISOString();
  const firstTime = new Date(nowMs - 120_000).toISOString();
  const secondTime = new Date(nowMs - 60_000).toISOString();
  const usage = (timestamp, input, cached, output) => ({
    timestamp,
    type: "event_msg",
    payload: {
      type: "token_count",
      info: {
        total_token_usage: {
          input_tokens: input,
          cached_input_tokens: cached,
          cache_write_input_tokens: 0,
          output_tokens: output,
          reasoning_output_tokens: 0,
          total_tokens: input + output,
        },
      },
    },
  });
  const lines = [
    { timestamp: metaTime, type: "session_meta", payload: { id, source: "vscode" } },
    { timestamp: firstTime, type: "turn_context", payload: { model: "gpt-5.6-sol" } },
    usage(firstTime, 100, 60, 10),
    usage(secondTime, 50, 30, 5),
  ];
  fs.writeFileSync(file, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`);
  return file;
}

async function readRequestJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

test("the real installer rebuilds legacy Codex history twice without touching other scopes", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "znt-tokenrank-install-test-"));
  const home = path.join(root, "home");
  const installDir = path.join(home, ".znt-tokenrank");
  const storePath = path.join(root, "store.json");
  fs.mkdirSync(installDir, { recursive: true });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  process.env.TOKEN_RANK_STORE_PATH = storePath;
  const store = await import(`../src/lib/tokenRankStore.ts?install-test=${Date.now()}`);
  const { token, user } = await store.createTokenRankUser({ name: "installer-e2e" });
  const today = beijingDate();
  const zeroDay = addDays(today, -1);
  const outside = addDays(today, -35);
  await store.appendTokenRankUsage(token, {
    deviceId: DEVICE_ID,
    clientVersion: "0.1.0",
    records: [
      legacyRecord({ date: today, model: "legacy-today" }),
      legacyRecord({ date: zeroDay, model: "legacy-zero" }),
      legacyRecord({ date: outside, model: "outside-window" }),
      legacyRecord({ date: zeroDay, tool: "claude-code", model: "other-tool" }),
    ],
  });

  fs.writeFileSync(path.join(installDir, "config.json"), JSON.stringify({ deviceId: DEVICE_ID }));
  writeCodexFixture(home, Date.now());

  const clientSource = fs.readFileSync(
    path.join(process.cwd(), "public", "token-rank", "client.mjs"),
    "utf8",
  );
  const uploads = [];
  const server = http.createServer(async (request, response) => {
    try {
      if (request.method === "GET" && request.url === "/token-rank/client.mjs") {
        response.writeHead(200, { "content-type": "text/javascript" });
        response.end(clientSource);
        return;
      }
      if (request.method === "POST" && request.url === "/api/token-rank/upload") {
        const body = await readRequestJson(request);
        uploads.push(body);
        const bearer = String(request.headers.authorization || "").replace(/^Bearer\s+/i, "");
        const result = await store.appendTokenRankUsage(bearer, body);
        response.writeHead(result.ok ? 200 : result.status, { "content-type": "application/json" });
        response.end(JSON.stringify(result.ok ? { status: 0, ...result } : {
          status: result.status,
          message: result.message,
        }));
        return;
      }
      response.writeHead(404);
      response.end("not found");
    } catch (error) {
      response.writeHead(500, { "content-type": "application/json" });
      response.end(JSON.stringify({ status: 500, message: error.message }));
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const address = server.address();
  assert.equal(typeof address, "object");
  const endpoint = `http://127.0.0.1:${address.port}/api/token-rank/upload`;
  const installer = path.join(process.cwd(), "public", "token-rank", "install.sh");
  const environment = {
    ...process.env,
    HOME: home,
    ZNT_TOKENRANK_HOME: installDir,
    ZNT_TOKENRANK_NODE: process.execPath,
  };

  const first = await execFileAsync("bash", [
    installer,
    "--token",
    token,
    "--endpoint",
    endpoint,
    "--no-schedule",
  ], { env: environment, timeout: 60_000 });
  assert.match(first.stdout, /客户端版本：0\.2\.1/);
  assert.equal(uploads.length, 1);
  assert.equal(uploads[0].protocolVersion, 2);
  assert.equal(uploads[0].snapshot.complete, true);
  assert.equal(uploads[0].snapshot.tool, "codex");
  assert.equal(uploads[0].snapshot.startDate, addDays(today, -34));
  assert.equal(uploads[0].snapshot.endDate, today);

  let data = JSON.parse(fs.readFileSync(storePath, "utf8"));
  let own = data.records.filter((record) => record.tokenHash === user.tokenHash);
  assert.ok(own.some((record) => record.model === "gpt-5.6-sol" && record.totalTokens === 110));
  assert.ok(!own.some((record) => record.model === "legacy-today"));
  assert.ok(!own.some((record) => record.model === "legacy-zero"));
  assert.ok(own.some((record) => record.model === "outside-window"));
  assert.ok(own.some((record) => record.model === "other-tool"));

  const second = await execFileAsync("bash", [
    installer,
    "--token",
    token,
    "--endpoint",
    endpoint,
    "--no-schedule",
  ], { env: environment, timeout: 60_000 });
  assert.match(second.stdout, /客户端版本：0\.2\.1/);
  assert.equal(uploads.length, 2);
  assert.equal(uploads[1].deviceId, DEVICE_ID);

  data = JSON.parse(fs.readFileSync(storePath, "utf8"));
  own = data.records.filter((record) => record.tokenHash === user.tokenHash);
  assert.equal(own.filter((record) => record.model === "gpt-5.6-sol").length, 1);
  assert.equal(own.find((record) => record.model === "gpt-5.6-sol").totalTokens, 110);
  assert.equal(JSON.parse(fs.readFileSync(path.join(installDir, "config.json"), "utf8")).deviceId, DEVICE_ID);
  assert.equal(fs.statSync(path.join(installDir, "config.json")).mode & 0o777, 0o600);
  assert.equal(fs.statSync(path.join(installDir, "codex-usage-cache-v7.json.gz")).mode & 0o777, 0o600);
  assert.equal(fs.existsSync(path.join(home, "Library", "LaunchAgents", "group.znt.tokenrank.plist")), false);
});

test("a rejected first upload restores the previous client and configuration", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "znt-tokenrank-install-rollback-"));
  const home = path.join(root, "home");
  const installDir = path.join(home, ".znt-tokenrank");
  fs.mkdirSync(installDir, { recursive: true });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const clientPath = path.join(installDir, "client.mjs");
  const configPath = path.join(installDir, "config.json");
  const previousClient = "console.log('previous-client');\n";
  const previousConfig = JSON.stringify({
    token: "znt_trk_previous",
    endpoint: "https://previous.invalid/api/token-rank/upload",
    deviceId: DEVICE_ID,
  }, null, 2);
  fs.writeFileSync(clientPath, previousClient);
  fs.writeFileSync(configPath, previousConfig);

  const clientSource = fs.readFileSync(
    path.join(process.cwd(), "public", "token-rank", "client.mjs"),
    "utf8",
  );
  let uploadAttempts = 0;
  const server = http.createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/token-rank/client.mjs") {
      response.writeHead(200, { "content-type": "text/javascript" });
      response.end(clientSource);
      return;
    }
    if (request.method === "POST" && request.url === "/api/token-rank/upload") {
      uploadAttempts += 1;
      await readRequestJson(request);
      response.writeHead(401, { "content-type": "application/json" });
      response.end(JSON.stringify({ status: 401, message: "rejected for rollback test" }));
      return;
    }
    response.writeHead(404);
    response.end("not found");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const address = server.address();
  assert.equal(typeof address, "object");
  const endpoint = `http://127.0.0.1:${address.port}/api/token-rank/upload`;
  const installer = path.join(process.cwd(), "public", "token-rank", "install.sh");

  await assert.rejects(
    execFileAsync("bash", [
      installer,
      "--token",
      "znt_trk_rejected",
      "--endpoint",
      endpoint,
      "--no-schedule",
    ], {
      env: {
        ...process.env,
        HOME: home,
        ZNT_TOKENRANK_HOME: installDir,
        ZNT_TOKENRANK_NODE: process.execPath,
      },
      timeout: 60_000,
    }),
    /首次同步失败/,
  );

  assert.equal(uploadAttempts, 1);
  assert.equal(fs.readFileSync(clientPath, "utf8"), previousClient);
  assert.equal(fs.readFileSync(configPath, "utf8"), previousConfig);
  assert.equal(fs.existsSync(path.join(installDir, "client.previous.mjs")), false);
  assert.equal(fs.readdirSync(installDir).some((name) => name.includes(".pending")), false);
});

test("an incomplete migrated history installs safely and retries the authoritative rebuild", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "znt-tokenrank-install-migrated-"));
  const home = path.join(root, "home");
  const installDir = path.join(home, ".znt-tokenrank");
  fs.mkdirSync(installDir, { recursive: true });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const incompleteFile = writeIncompleteCodexFixture(home, Date.now());
  const clientSource = fs.readFileSync(
    path.join(process.cwd(), "public", "token-rank", "client.mjs"),
    "utf8",
  );
  const uploads = [];
  const server = http.createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/token-rank/client.mjs") {
      response.writeHead(200, { "content-type": "text/javascript" });
      response.end(clientSource);
      return;
    }
    if (request.method === "POST" && request.url === "/api/token-rank/upload") {
      const body = await readRequestJson(request);
      uploads.push(body);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ status: 0, accepted: body.records.length }));
      return;
    }
    response.writeHead(404);
    response.end("not found");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const address = server.address();
  assert.equal(typeof address, "object");
  const endpoint = `http://127.0.0.1:${address.port}/api/token-rank/upload`;
  const environment = {
    ...process.env,
    HOME: home,
    ZNT_TOKENRANK_HOME: installDir,
    ZNT_TOKENRANK_NODE: process.execPath,
  };

  const first = await execFileAsync("bash", [
    path.join(process.cwd(), "public", "token-rank", "install.sh"),
    "--token",
    "znt_trk_migrated_history",
    "--endpoint",
    endpoint,
    "--no-schedule",
  ], { env: environment, timeout: 60_000 });

  assert.match(first.stderr, /保留线上旧统计.*自动重试完整重建/);
  assert.match(first.stdout, /客户端版本：0\.2\.1/);
  assert.equal(uploads.length, 1);
  assert.equal(uploads[0].records.some((record) => record.tool === "codex"), false);
  assert.equal(Object.hasOwn(uploads[0], "collector"), false);
  assert.equal(Object.hasOwn(uploads[0], "snapshot"), false);
  assert.equal(JSON.parse(fs.readFileSync(path.join(installDir, "config.json"), "utf8")).pendingCodexHistoryRebuild, true);

  fs.rmSync(incompleteFile);
  writeCodexFixture(home, Date.now());
  await execFileAsync(process.execPath, [path.join(installDir, "client.mjs")], {
    env: environment,
    timeout: 60_000,
  });

  assert.equal(uploads.length, 2);
  assert.equal(uploads[1].snapshot.complete, true);
  assert.equal(uploads[1].snapshot.tool, "codex");
  assert.equal(Object.hasOwn(
    JSON.parse(fs.readFileSync(path.join(installDir, "config.json"), "utf8")),
    "pendingCodexHistoryRebuild",
  ), false);
});

test("reinstalling without a Codex source does not clear existing Codex history", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "znt-tokenrank-install-no-codex-"));
  const home = path.join(root, "home");
  const installDir = path.join(home, ".znt-tokenrank");
  const storePath = path.join(root, "store.json");
  fs.mkdirSync(installDir, { recursive: true });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  process.env.TOKEN_RANK_STORE_PATH = storePath;
  const store = await import(`../src/lib/tokenRankStore.ts?no-codex-install-test=${Date.now()}`);
  const { token, user } = await store.createTokenRankUser({ name: "no-codex-installer-e2e" });
  const today = beijingDate();
  await store.appendTokenRankUsage(token, {
    deviceId: DEVICE_ID,
    clientVersion: "0.1.0",
    records: [legacyRecord({ date: today, model: "must-survive-no-source" })],
  });
  fs.writeFileSync(path.join(installDir, "config.json"), JSON.stringify({ deviceId: DEVICE_ID }));

  const clientSource = fs.readFileSync(
    path.join(process.cwd(), "public", "token-rank", "client.mjs"),
    "utf8",
  );
  const uploads = [];
  const server = http.createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/token-rank/client.mjs") {
      response.writeHead(200, { "content-type": "text/javascript" });
      response.end(clientSource);
      return;
    }
    if (request.method === "POST" && request.url === "/api/token-rank/upload") {
      const body = await readRequestJson(request);
      uploads.push(body);
      const bearer = String(request.headers.authorization || "").replace(/^Bearer\s+/i, "");
      const result = await store.appendTokenRankUsage(bearer, body);
      response.writeHead(result.ok ? 200 : result.status, { "content-type": "application/json" });
      response.end(JSON.stringify(result.ok ? { status: 0, ...result } : {
        status: result.status,
        message: result.message,
      }));
      return;
    }
    response.writeHead(404);
    response.end("not found");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const address = server.address();
  assert.equal(typeof address, "object");

  await execFileAsync("bash", [
    path.join(process.cwd(), "public", "token-rank", "install.sh"),
    "--token",
    token,
    "--endpoint",
    `http://127.0.0.1:${address.port}/api/token-rank/upload`,
    "--no-schedule",
  ], {
    env: {
      ...process.env,
      HOME: home,
      ZNT_TOKENRANK_HOME: installDir,
      ZNT_TOKENRANK_NODE: process.execPath,
    },
    timeout: 60_000,
  });

  assert.equal(uploads.length, 1);
  assert.equal(Object.hasOwn(uploads[0], "collector"), false);
  assert.equal(Object.hasOwn(uploads[0], "snapshot"), false);
  assert.equal(uploads[0].records.some((record) => record.tool === "codex"), false);
  const data = JSON.parse(fs.readFileSync(storePath, "utf8"));
  const own = data.records.filter((record) => record.tokenHash === user.tokenHash);
  assert.ok(own.some((record) => record.model === "must-survive-no-source"));
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(installDir, "config.json"), "utf8")).pendingCodexHistoryRebuild,
    true,
  );
});

test("the installer completes scheduled setup under a UTF-8 locale", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "znt-tokenrank-install-utf8-"));
  const home = path.join(root, "home");
  const installDir = path.join(home, ".znt-tokenrank");
  const fakeBin = path.join(root, "bin");
  fs.mkdirSync(fakeBin, { recursive: true });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  fs.writeFileSync(path.join(fakeBin, "uname"), [
    "#!/bin/sh",
    "echo Darwin",
    "",
  ].join("\n"), { mode: 0o755 });
  fs.writeFileSync(path.join(fakeBin, "launchctl"), [
    "#!/bin/sh",
    "exit 0",
    "",
  ].join("\n"), { mode: 0o755 });

  const clientSource = fs.readFileSync(
    path.join(process.cwd(), "public", "token-rank", "client.mjs"),
    "utf8",
  );
  let uploadAttempts = 0;
  const server = http.createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/token-rank/client.mjs") {
      response.writeHead(200, { "content-type": "text/javascript" });
      response.end(clientSource);
      return;
    }
    if (request.method === "POST" && request.url === "/api/token-rank/upload") {
      uploadAttempts += 1;
      const body = await readRequestJson(request);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ status: 0, accepted: body.records.length }));
      return;
    }
    response.writeHead(404);
    response.end("not found");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const address = server.address();
  assert.equal(typeof address, "object");

  const result = await execFileAsync("bash", [
    path.join(process.cwd(), "public", "token-rank", "install.sh"),
    "--token",
    "znt_trk_utf8_status",
    "--endpoint",
    `http://127.0.0.1:${address.port}/api/token-rank/upload`,
  ], {
    env: {
      ...process.env,
      HOME: home,
      LANG: "C.UTF-8",
      LC_ALL: "C.UTF-8",
      PATH: `${fakeBin}:${process.env.PATH}`,
      ZNT_TOKENRANK_HOME: installDir,
      ZNT_TOKENRANK_NODE: process.execPath,
    },
    timeout: 60_000,
  });

  assert.equal(uploadAttempts, 1);
  assert.match(result.stdout, /配置目录：.*\.znt-tokenrank。客户端版本：0\.2\.1/);
  assert.equal(fs.existsSync(path.join(home, "Library", "LaunchAgents", "group.znt.tokenrank.plist")), true);
});

test("a scheduler failure restores the previous client, config, and launchd file", {
  skip: process.platform !== "darwin",
}, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "znt-tokenrank-install-schedule-rollback-"));
  const home = path.join(root, "home");
  const installDir = path.join(home, ".znt-tokenrank");
  const launchAgentsDir = path.join(home, "Library", "LaunchAgents");
  const fakeBin = path.join(root, "bin");
  fs.mkdirSync(installDir, { recursive: true });
  fs.mkdirSync(launchAgentsDir, { recursive: true });
  fs.mkdirSync(fakeBin, { recursive: true });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const clientPath = path.join(installDir, "client.mjs");
  const configPath = path.join(installDir, "config.json");
  const plistPath = path.join(launchAgentsDir, "group.znt.tokenrank.plist");
  const previousClient = "console.log('previous-scheduled-client');\n";
  const previousConfig = JSON.stringify({
    token: "znt_trk_previous_schedule",
    endpoint: "https://previous.invalid/api/token-rank/upload",
    deviceId: DEVICE_ID,
  }, null, 2);
  const previousPlist = "previous launchd definition\n";
  fs.writeFileSync(clientPath, previousClient, { mode: 0o744 });
  fs.writeFileSync(configPath, previousConfig, { mode: 0o640 });
  fs.writeFileSync(plistPath, previousPlist, { mode: 0o644 });
  const fakeLaunchctl = path.join(fakeBin, "launchctl");
  fs.writeFileSync(fakeLaunchctl, [
    "#!/bin/sh",
    "if [ \"$1\" = \"load\" ]; then exit 42; fi",
    "exit 0",
    "",
  ].join("\n"), { mode: 0o755 });

  const clientSource = fs.readFileSync(
    path.join(process.cwd(), "public", "token-rank", "client.mjs"),
    "utf8",
  );
  let uploadAttempts = 0;
  const server = http.createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/token-rank/client.mjs") {
      response.writeHead(200, { "content-type": "text/javascript" });
      response.end(clientSource);
      return;
    }
    if (request.method === "POST" && request.url === "/api/token-rank/upload") {
      uploadAttempts += 1;
      const body = await readRequestJson(request);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ status: 0, accepted: body.records.length }));
      return;
    }
    response.writeHead(404);
    response.end("not found");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const address = server.address();
  assert.equal(typeof address, "object");

  await assert.rejects(
    execFileAsync("bash", [
      path.join(process.cwd(), "public", "token-rank", "install.sh"),
      "--token",
      "znt_trk_schedule_rollback",
      "--endpoint",
      `http://127.0.0.1:${address.port}/api/token-rank/upload`,
    ], {
      env: {
        ...process.env,
        HOME: home,
        PATH: `${fakeBin}:${process.env.PATH}`,
        ZNT_TOKENRANK_HOME: installDir,
        ZNT_TOKENRANK_NODE: process.execPath,
      },
      timeout: 60_000,
    }),
    /后台任务安装失败，已恢复原客户端与配置/,
  );

  assert.equal(uploadAttempts, 1);
  assert.equal(fs.readFileSync(clientPath, "utf8"), previousClient);
  assert.equal(fs.readFileSync(configPath, "utf8"), previousConfig);
  assert.equal(fs.readFileSync(plistPath, "utf8"), previousPlist);
  assert.equal(fs.statSync(clientPath).mode & 0o777, 0o744);
  assert.equal(fs.statSync(configPath).mode & 0o777, 0o640);
  assert.equal(fs.readdirSync(installDir).some((name) => name.includes("previous")), false);
});

test("a launchd backup failure leaves the old installation and scheduler untouched", {
  skip: process.platform !== "darwin",
}, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "znt-tokenrank-install-schedule-backup-"));
  const home = path.join(root, "home");
  const installDir = path.join(home, ".znt-tokenrank");
  const launchAgentsDir = path.join(home, "Library", "LaunchAgents");
  const fakeBin = path.join(root, "bin");
  const launchctlMarker = path.join(root, "launchctl-called");
  fs.mkdirSync(installDir, { recursive: true });
  fs.mkdirSync(launchAgentsDir, { recursive: true });
  fs.mkdirSync(fakeBin, { recursive: true });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const clientPath = path.join(installDir, "client.mjs");
  const configPath = path.join(installDir, "config.json");
  const plistPath = path.join(launchAgentsDir, "group.znt.tokenrank.plist");
  const previousClient = "console.log('client-before-schedule-backup-failure');\n";
  const previousConfig = JSON.stringify({
    token: "znt_trk_before_schedule_backup_failure",
    endpoint: "https://previous.invalid/api/token-rank/upload",
    deviceId: DEVICE_ID,
  }, null, 2);
  const previousPlist = "plist before schedule backup failure\n";
  fs.writeFileSync(clientPath, previousClient, { mode: 0o744 });
  fs.writeFileSync(configPath, previousConfig, { mode: 0o640 });
  fs.writeFileSync(plistPath, previousPlist, { mode: 0o644 });

  fs.writeFileSync(path.join(fakeBin, "cp"), [
    "#!/bin/sh",
    "for arg do",
    "  case \"$arg\" in",
    "    *schedule.previous.plist) exit 43 ;;",
    "  esac",
    "done",
    "exec /bin/cp \"$@\"",
    "",
  ].join("\n"), { mode: 0o755 });
  fs.writeFileSync(path.join(fakeBin, "launchctl"), [
    "#!/bin/sh",
    `touch ${JSON.stringify(launchctlMarker)}`,
    "exit 0",
    "",
  ].join("\n"), { mode: 0o755 });

  const clientSource = fs.readFileSync(
    path.join(process.cwd(), "public", "token-rank", "client.mjs"),
    "utf8",
  );
  let uploadAttempts = 0;
  const server = http.createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/token-rank/client.mjs") {
      response.writeHead(200, { "content-type": "text/javascript" });
      response.end(clientSource);
      return;
    }
    if (request.method === "POST" && request.url === "/api/token-rank/upload") {
      uploadAttempts += 1;
      const body = await readRequestJson(request);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ status: 0, accepted: body.records.length }));
      return;
    }
    response.writeHead(404);
    response.end("not found");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const address = server.address();
  assert.equal(typeof address, "object");

  await assert.rejects(
    execFileAsync("bash", [
      path.join(process.cwd(), "public", "token-rank", "install.sh"),
      "--token",
      "znt_trk_schedule_backup_failure",
      "--endpoint",
      `http://127.0.0.1:${address.port}/api/token-rank/upload`,
    ], {
      env: {
        ...process.env,
        HOME: home,
        PATH: `${fakeBin}:${process.env.PATH}`,
        ZNT_TOKENRANK_HOME: installDir,
        ZNT_TOKENRANK_NODE: process.execPath,
      },
      timeout: 60_000,
    }),
    /后台任务安装失败，已恢复原客户端与配置/,
  );

  assert.equal(uploadAttempts, 1);
  assert.equal(fs.readFileSync(clientPath, "utf8"), previousClient);
  assert.equal(fs.readFileSync(configPath, "utf8"), previousConfig);
  assert.equal(fs.readFileSync(plistPath, "utf8"), previousPlist);
  assert.equal(fs.statSync(clientPath).mode & 0o777, 0o744);
  assert.equal(fs.statSync(configPath).mode & 0o777, 0o640);
  assert.equal(fs.statSync(plistPath).mode & 0o777, 0o644);
  assert.equal(fs.existsSync(launchctlMarker), false);
  assert.equal(fs.readdirSync(installDir).some((name) => name.includes("previous")), false);
});
