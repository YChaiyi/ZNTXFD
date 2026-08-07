import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const projectRoot = process.cwd();
const date = "2026-07-28";
const title = "公开访问测试日报";

function createFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "znt-public-access-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
  fs.mkdirSync(path.join(root, "data", "daily"), { recursive: true });
  fs.mkdirSync(path.join(root, "runtime"), { recursive: true });
  fs.copyFileSync(
    path.join(projectRoot, "scripts", "sitectl.sh"),
    path.join(root, "scripts", "sitectl.sh"),
  );
  fs.writeFileSync(
    path.join(root, "data", "daily", `${date}.json`),
    `${JSON.stringify({ date, title })}\n`,
  );
  return root;
}

function listen(t, handler) {
  const requests = [];
  const server = http.createServer((request, response) => {
    requests.push({
      method: request.method,
      path: request.url,
      cookie: request.headers.cookie || "",
    });
    handler(request, response);
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      t.after(() => new Promise((closeResolve) => server.close(closeResolve)));
      const address = server.address();
      resolve({
        baseUrl: `http://127.0.0.1:${address.port}`,
        requests,
      });
    });
  });
}

function runVerify(root, baseUrl, extraEnv = {}) {
  const env = {
    ...process.env,
    GROUP_DIGEST_RUNTIME: path.join(root, "runtime"),
    ZNT_SITE_URL: baseUrl,
    ...extraEnv,
  };
  delete env.ACCESS_PASSWORD;
  delete env.ZNT_SITE_PASSWORD;
  Object.assign(env, extraEnv);

  return new Promise((resolve, reject) => {
    const child = spawn("bash", ["scripts/sitectl.sh", "verify", date], {
      cwd: root,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (status, signal) => resolve({ status, signal, stdout, stderr }));
  });
}

function sendPublicContent(request, response) {
  if (request.url === `/daily/${date}`) {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(`<h1>${title}</h1><time>${date}</time>`);
    return;
  }
  if (request.url === "/api/content-version") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ contentVersion: "public-test-v1" }));
    return;
  }
  response.writeHead(404);
  response.end();
}

function sendLegacyProtectedContent(request, response) {
  if (request.url === "/api/auth/verify" && request.method === "POST") {
    response.writeHead(200, {
      "content-type": "application/json",
      "set-cookie": "legacy-session=valid; Path=/; HttpOnly",
    });
    response.end(JSON.stringify({ success: true }));
    return;
  }
  if (request.headers.cookie === "legacy-session=valid") {
    sendPublicContent(request, response);
    return;
  }
  if (request.url === `/daily/${date}`) {
    response.writeHead(307, { location: `/login?next=%2Fdaily%2F${date}` });
    response.end();
    return;
  }
  response.writeHead(401, { "content-type": "application/json" });
  response.end(JSON.stringify({ message: "password required" }));
}

test("source exposes content publicly while retaining non-access safety gates", () => {
  const middleware = fs.readFileSync("src/middleware.ts", "utf8");
  const health = fs.readFileSync("src/app/api/health/route.ts", "utf8");
  const nginx = fs.readFileSync("ops/nginx/znt.group.conf", "utf8");

  assert.doesNotMatch(middleware, /accessAuth|ACCESS_COOKIE_NAME|verifyAccessSession|需要网站访问密码/);
  assert.match(middleware, /getContentStatus/);
  assert.match(middleware, /status: 503/);
  assert.doesNotMatch(health, /isAccessConfigured|ACCESS_PASSWORD/);
  assert.match(health, /tokenRankUploadProtocol:\s*2/);
  assert.match(health, /tokenRankPartialUpload:\s*true/);
  assert.equal(fs.existsSync("src/app/api/auth/verify/route.ts"), false);
  assert.equal(fs.existsSync("src/lib/accessAuth.ts"), false);
  assert.equal(fs.existsSync("src/lib/safeNextPath.ts"), false);
  assert.match(nginx, /location = \/api\/token-rank\/login/);
  assert.match(nginx, /location = \/api\/token-rank\/register/);
  assert.equal((nginx.match(/limit_req zone=znt_identity/g) || []).length, 2);
  assert.doesNotMatch(nginx, /api\/auth\/verify|znt_login/);
});

test("site:verify validates a public site without calling the legacy login API", async (t) => {
  const root = createFixture(t);
  const { baseUrl, requests } = await listen(t, sendPublicContent);
  const result = await runVerify(root, baseUrl);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /"accessMode": "public"/);
  assert.equal(requests.some((request) => request.path === "/api/auth/verify"), false);
});

test("site:verify can validate a rollback to the legacy password-protected site", async (t) => {
  const root = createFixture(t);
  const { baseUrl, requests } = await listen(t, sendLegacyProtectedContent);
  const result = await runVerify(root, baseUrl, { ZNT_SITE_PASSWORD: "legacy-test-password" });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /"accessMode": "authenticated"/);
  assert.equal(requests.filter((request) => request.path === "/api/auth/verify").length, 1);
});

test("site:verify reports a protected rollback when no legacy password is configured", async (t) => {
  const root = createFixture(t);
  const { baseUrl, requests } = await listen(t, sendLegacyProtectedContent);
  const result = await runVerify(root, baseUrl);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Site still requires a password/);
  assert.equal(requests.some((request) => request.path === "/api/auth/verify"), false);
});

test("site:verify does not mistake unavailable content for a password gate", async (t) => {
  const root = createFixture(t);
  const { baseUrl, requests } = await listen(t, (_request, response) => {
    response.writeHead(503, { "content-type": "application/json" });
    response.end(JSON.stringify({ message: "content unavailable" }));
  });
  const result = await runVerify(root, baseUrl, { ZNT_SITE_PASSWORD: "legacy-test-password" });

  assert.notEqual(result.status, 0);
  assert.doesNotMatch(result.stderr, /Site still requires a password|Legacy site login failed/);
  assert.equal(requests.some((request) => request.path === "/api/auth/verify"), false);
});

test("site:verify does not mistake an ordinary redirect for the legacy login page", async (t) => {
  const root = createFixture(t);
  const { baseUrl, requests } = await listen(t, (request, response) => {
    if (request.url === `/daily/${date}`) {
      response.writeHead(308, { location: `/daily/${date}/` });
      response.end();
      return;
    }
    sendPublicContent(request, response);
  });
  const result = await runVerify(root, baseUrl, { ZNT_SITE_PASSWORD: "legacy-test-password" });

  assert.notEqual(result.status, 0);
  assert.doesNotMatch(result.stderr, /Site still requires a password|Legacy site login failed/);
  assert.equal(requests.some((request) => request.path === "/api/auth/verify"), false);
});
