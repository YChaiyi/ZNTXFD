import { execFileSync, spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";

const projectRoot = process.cwd();
const nextBin = path.join(projectRoot, "node_modules", "next", "dist", "bin", "next");
// The lock name matches the repository's `.next-stale-*` gitignore pattern.
const buildLockDir = path.join(projectRoot, ".next-stale-e2e-lock");
const buildStampPath = path.join(projectRoot, ".next", "znt-e2e-build-stamp.json");
const LOCK_STALE_MS = 5 * 60_000;

let built = false;

function cleanEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  delete env.NODE_ENV;
  if (!("ZNT_CONTENT_DIR" in extra)) delete env.ZNT_CONTENT_DIR;
  return env;
}

function sourceFingerprint() {
  const roots = [
    "src",
    "public",
    "next.config.ts",
    "tailwind.config.ts",
    "postcss.config.mjs",
    "package.json",
  ];
  const hash = crypto.createHash("sha256");
  const visit = (target, relative) => {
    const stat = fs.statSync(target);
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(target).sort()) {
        visit(path.join(target, entry), `${relative}/${entry}`);
      }
    } else {
      hash.update(`${relative}\0${stat.mtimeMs}\0${stat.size}\n`);
    }
  };
  for (const root of roots) {
    const absolute = path.join(projectRoot, root);
    if (fs.existsSync(absolute)) visit(absolute, root);
  }
  return hash.digest("hex");
}

function hasFreshBuild(fingerprint) {
  try {
    const stamp = JSON.parse(fs.readFileSync(buildStampPath, "utf8"));
    return stamp.fingerprint === fingerprint;
  } catch {
    return false;
  }
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// Test files run in separate processes that may all need the app. Exactly one
// process builds; the others wait on the lock and then reuse the stamped build.
export function buildApp() {
  if (built) return;
  const fingerprint = sourceFingerprint();
  const deadline = Date.now() + 10 * 60_000;
  for (;;) {
    if (hasFreshBuild(fingerprint)) {
      built = true;
      return;
    }
    try {
      fs.mkdirSync(buildLockDir);
      break;
    } catch {
      try {
        if (Date.now() - fs.statSync(buildLockDir).mtimeMs > LOCK_STALE_MS) {
          // Atomic rename so only one waiter can steal an abandoned lock;
          // a stat-then-delete pair could remove a lock that was just
          // re-acquired by another process.
          const graveyard = `${buildLockDir}.stale-${process.pid}`;
          fs.renameSync(buildLockDir, graveyard);
          fs.rmSync(graveyard, { recursive: true, force: true });
        }
      } catch {
        // Lock vanished or another waiter won the steal; retry.
      }
      if (Date.now() > deadline) {
        throw new Error("timed out waiting for a concurrent next build");
      }
      sleepSync(1000);
    }
  }
  try {
    if (!hasFreshBuild(fingerprint)) {
      execFileSync(process.execPath, [nextBin, "build"], {
        cwd: projectRoot,
        env: cleanEnv(),
        stdio: "pipe",
        encoding: "utf8",
      });
      fs.writeFileSync(buildStampPath, JSON.stringify({ fingerprint }));
    }
    built = true;
  } finally {
    fs.rmSync(buildLockDir, { recursive: true, force: true });
  }
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

export async function startApp(t, { contentDir, env: extraEnv = {} }) {
  buildApp();
  const port = await freePort();
  const child = spawn(process.execPath, [nextBin, "start", "-p", String(port)], {
    cwd: projectRoot,
    env: cleanEnv({ ZNT_CONTENT_DIR: contentDir, ...extraEnv }),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  t.after(() => new Promise((resolve) => {
    child.once("exit", resolve);
    child.kill();
  }));

  const baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 90_000;
  for (;;) {
    if (child.exitCode !== null) {
      throw new Error(`next start exited early (${child.exitCode}):\n${output}`);
    }
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.status < 500) break;
    } catch {
      // Server not accepting connections yet.
    }
    if (Date.now() > deadline) {
      throw new Error(`next start did not become ready:\n${output}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return { baseUrl };
}
