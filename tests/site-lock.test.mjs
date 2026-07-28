import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const projectRoot = process.cwd();
const lockHelper = path.join(projectRoot, "scripts/site_lock.py");
const updateScript = path.join(projectRoot, "scripts/update_after_digest.sh");
const deployScript = path.join(projectRoot, "scripts/deploy_vps.sh");

function temporaryRoot(t, prefix = "znt-site-lock-") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function writeOwner(lockDir, {
  pid = process.pid,
  startedAt = Math.floor(Date.now() / 1000),
  token = "owner-token",
} = {}) {
  fs.mkdirSync(lockDir, { recursive: true });
  fs.writeFileSync(
    path.join(lockDir, "owner"),
    `pid=${pid}\nstarted_at=${startedAt}\ntoken=${token}\n`,
    { mode: 0o600 },
  );
}

function runLock(args) {
  return spawnSync("python3", [lockHelper, ...args], {
    cwd: projectRoot,
    encoding: "utf8",
  });
}

function waitForChild(child) {
  return new Promise((resolve, reject) => {
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (status, signal) => resolve({ status, signal, stderr }));
  });
}

function writeExecutable(filePath, contents) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents, { mode: 0o755 });
}

function createUpdateFixture(t, deployBody = "exit 0\n") {
  const root = temporaryRoot(t, "znt-site-update-project-");
  const runtime = path.join(root, "runtime");
  const fixtureProject = path.join(root, "project");
  fs.mkdirSync(path.join(fixtureProject, "scripts"), { recursive: true });
  fs.mkdirSync(path.join(fixtureProject, "data", "daily"), { recursive: true });
  fs.mkdirSync(path.join(fixtureProject, "public", "digest-images"), { recursive: true });
  fs.copyFileSync(lockHelper, path.join(fixtureProject, "scripts", "site_lock.py"));

  writeExecutable(path.join(fixtureProject, "scripts", "generate_daily_from_essence.py"), `#!/usr/bin/env python3
import argparse
import json
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument("date")
parser.add_argument("--runtime-dir")
parser.add_argument("--output-dir", type=Path, required=True)
args = parser.parse_args()
args.output_dir.mkdir(parents=True, exist_ok=True)
(args.output_dir / f"{args.date}.json").write_text(json.dumps({"date": args.date}), encoding="utf-8")
`);
  writeExecutable(path.join(fixtureProject, "scripts", "check_daily_quality.py"), "#!/usr/bin/env python3\n");
  writeExecutable(path.join(fixtureProject, "scripts", "extract_knowledge.py"), "#!/usr/bin/env python3\n");
  writeExecutable(path.join(fixtureProject, "scripts", "generate_index.py"), "#!/usr/bin/env python3\n");
  writeExecutable(path.join(fixtureProject, "scripts", "generate_search_index.py"), "#!/usr/bin/env python3\n");
  writeExecutable(path.join(fixtureProject, "scripts", "sync_digest_images.mjs"), "#!/usr/bin/env node\n");
  writeExecutable(
    path.join(fixtureProject, "scripts", "deploy_vps.sh"),
    `#!/bin/bash\nset -euo pipefail\n${deployBody}`,
  );

  return { fixtureProject, runtime };
}

function runUpdate(runtime, extraEnv = {}, args = ["2026-07-27"]) {
  return spawnSync("bash", [updateScript, ...args], {
    cwd: projectRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      AGENT_KB_DIR: projectRoot,
      GROUP_DIGEST_RUNTIME: runtime,
      ZNT_SITE_LOCK_POLL_SECONDS: "0.01",
      ...extraEnv,
    },
  });
}

test("a fresh incomplete owner is protected by the creation grace period", (t) => {
  const root = temporaryRoot(t);
  const lockDir = path.join(root, "publication.lock");
  fs.mkdirSync(lockDir);
  fs.writeFileSync(path.join(lockDir, "owner"), "", { mode: 0o600 });

  const result = runLock(["reclaim", lockDir, "3600", "60"]);

  assert.equal(result.status, 1, result.stderr);
  assert.equal(fs.existsSync(lockDir), true);
});

test("stale ownerless and dead-owner locks are reclaimed with exit code zero", (t) => {
  const root = temporaryRoot(t);
  const ownerless = path.join(root, "ownerless.lock");
  fs.mkdirSync(ownerless);
  const oldTime = new Date(Date.now() - 120_000);
  fs.utimesSync(ownerless, oldTime, oldTime);

  const ownerlessResult = runLock(["reclaim", ownerless, "3600", "30"]);
  assert.equal(ownerlessResult.status, 0, ownerlessResult.stderr);
  assert.equal(fs.existsSync(ownerless), false);

  const deadOwner = path.join(root, "dead-owner.lock");
  writeOwner(deadOwner, { pid: 99_999_999, token: "dead" });
  const deadOwnerResult = runLock(["reclaim", deadOwner, "3600", "30"]);
  assert.equal(deadOwnerResult.status, 0, deadOwnerResult.stderr);
  assert.equal(fs.existsSync(deadOwner), false);
});

test("an active owner is not reclaimed", (t) => {
  const root = temporaryRoot(t);
  const lockDir = path.join(root, "active.lock");
  writeOwner(lockDir);

  const result = runLock(["reclaim", lockDir, "3600", "30"]);

  assert.equal(result.status, 1, result.stderr);
  assert.equal(fs.existsSync(lockDir), true);
});

test("a live owner remains protected after its TTL", (t) => {
  const root = temporaryRoot(t);
  const lockDir = path.join(root, "live-owner-overdue.lock");
  writeOwner(lockDir, {
    pid: process.pid,
    startedAt: Math.floor(Date.now() / 1000) - 3601,
  });

  const result = runLock(["reclaim", lockDir, "3600", "30"]);

  assert.equal(result.status, 1, result.stderr);
  assert.equal(fs.existsSync(lockDir), true);
});

test("concurrent stale-lock reclaim has exactly one winner", async (t) => {
  const root = temporaryRoot(t);
  const lockDir = path.join(root, "stale.lock");
  writeOwner(lockDir, { pid: 99_999_999, token: "stale" });

  const contenders = Array.from({ length: 8 }, () => spawn(
    "python3",
    [lockHelper, "reclaim", lockDir, "3600", "30"],
    { cwd: projectRoot, stdio: ["ignore", "ignore", "pipe"] },
  ));
  const results = await Promise.all(contenders.map(waitForChild));
  const statuses = results.map(({ status }) => status).sort();

  assert.deepEqual(statuses, [0, 1, 1, 1, 1, 1, 1, 1], JSON.stringify(results));
  assert.equal(fs.existsSync(lockDir), false);
});

test("release requires the current token and cannot remove a replacement lock", (t) => {
  const root = temporaryRoot(t);
  const lockDir = path.join(root, "owned.lock");
  writeOwner(lockDir, { token: "replacement-token" });

  const oldOwner = runLock(["release", lockDir, "old-token"]);
  assert.equal(oldOwner.status, 1, oldOwner.stderr);
  assert.equal(fs.existsSync(lockDir), true);
  assert.match(fs.readFileSync(path.join(lockDir, "owner"), "utf8"), /token=replacement-token/);

  const currentOwner = runLock(["release", lockDir, "replacement-token"]);
  assert.equal(currentOwner.status, 0, currentOwner.stderr);
  assert.equal(fs.existsSync(lockDir), false);
});

test("invalid inputs and guard I/O failures use operational exit code two", (t) => {
  const root = temporaryRoot(t);
  const lockDir = path.join(root, "guard-error.lock");
  writeOwner(lockDir);

  const invalidTtl = runLock(["reclaim", lockDir, "0", "30"]);
  assert.equal(invalidTtl.status, 2, invalidTtl.stderr);
  assert.equal(fs.existsSync(lockDir), true);

  const emptyToken = runLock(["release", lockDir, ""]);
  assert.equal(emptyToken.status, 2, emptyToken.stderr);
  assert.equal(fs.existsSync(lockDir), true);

  fs.mkdirSync(`${lockDir}.reclaim.guard`);
  const guardError = runLock(["reclaim", lockDir, "3600", "30"]);
  assert.equal(guardError.status, 2, guardError.stderr);
  assert.equal(fs.existsSync(lockDir), true);
});

test("a non-deploy update keeps the historical skip-success behavior for an active date lock", (t) => {
  const runtime = temporaryRoot(t, "znt-site-update-runtime-");
  const date = "2026-07-27";
  const lockDir = path.join(runtime, ".schedule", `site-update-${date}.running`);
  writeOwner(lockDir);

  const result = runUpdate(runtime, {}, [date]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /already running; active lock/);
  assert.equal(fs.existsSync(lockDir), true);
  assert.equal(fs.existsSync(path.join(runtime, ".schedule", `site-update-${date}.ok`)), false);
});

test("a deploy times out with exit code two instead of reporting success", (t) => {
  const runtime = temporaryRoot(t, "znt-site-deploy-runtime-");
  const date = "2026-07-27";
  const lockDir = path.join(runtime, ".schedule", `site-update-${date}.running`);
  writeOwner(lockDir);

  const result = runUpdate(runtime, {
    ZNT_SITE_DATE_LOCK_WAIT_SECONDS: "0",
  }, [date, "--deploy"]);

  assert.equal(result.status, 2, result.stderr);
  assert.match(result.stdout, /timed out waiting for site update/);
  assert.equal(fs.existsSync(lockDir), true);
  assert.equal(fs.existsSync(path.join(runtime, ".schedule", `site-update-${date}.ok`)), false);
});

test("a content-lock release failure propagates exit code two and suppresses the success stamp", (t) => {
  const deployBody = `
test "\${ZNT_CONTENT_LOCK_HELD:-}" = "1"
touch "$GROUP_DIGEST_RUNTIME/.schedule/site-content.publish.lock/injected-release-failure"
`;
  const { fixtureProject, runtime } = createUpdateFixture(t, deployBody);
  const date = "2026-07-27";

  const result = spawnSync("bash", [updateScript, date, "--deploy"], {
    cwd: projectRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      AGENT_KB_DIR: fixtureProject,
      GROUP_DIGEST_RUNTIME: runtime,
      ZNT_SITE_LOCK_POLL_SECONDS: "0.01",
    },
  });

  assert.equal(result.status, 2, `${result.stdout}\n${result.stderr}`);
  assert.equal(fs.existsSync(path.join(runtime, ".schedule", `site-update-${date}.ok`)), false);
});

test("different-date deploys serialize their publication critical sections", async (t) => {
  const deployBody = `
critical_dir="$GROUP_DIGEST_RUNTIME/publication-critical-section"
if ! mkdir "$critical_dir" 2>/dev/null; then
  exit 91
fi
printf '%s\\n' "$1" >> "$GROUP_DIGEST_RUNTIME/deploy-order"
sleep 0.25
rmdir "$critical_dir"
`;
  const { fixtureProject, runtime } = createUpdateFixture(t, deployBody);
  const dates = ["2026-07-26", "2026-07-27"];
  const environment = {
    ...process.env,
    AGENT_KB_DIR: fixtureProject,
    GROUP_DIGEST_RUNTIME: runtime,
    ZNT_SITE_LOCK_POLL_SECONDS: "0.01",
    ZNT_SITE_CONTENT_LOCK_WAIT_SECONDS: "10",
  };
  const children = dates.map((date) => spawn(
    "bash",
    [updateScript, date, "--deploy"],
    { cwd: projectRoot, env: environment, stdio: ["ignore", "ignore", "pipe"] },
  ));

  const results = await Promise.all(children.map(waitForChild));

  assert.deepEqual(results.map(({ status }) => status), [0, 0], JSON.stringify(results));
  const deployedDates = fs.readFileSync(path.join(runtime, "deploy-order"), "utf8").trim().split("\n").sort();
  assert.deepEqual(deployedDates, dates);
  assert.equal(fs.existsSync(path.join(runtime, "publication-critical-section")), false);
  assert.equal(fs.existsSync(path.join(runtime, ".schedule", "site-content.publish.lock")), false);
  for (const date of dates) {
    assert.equal(fs.existsSync(path.join(runtime, ".schedule", `site-update-${date}.ok`)), true);
    assert.equal(fs.existsSync(path.join(runtime, ".schedule", `site-update-${date}.running`)), false);
  }
});

test("deploy_vps requires proof that the outer content lock is held", () => {
  const result = spawnSync("bash", [deployScript, "2026-07-27"], {
    cwd: projectRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      ZNT_CONTENT_LOCK_HELD: "",
    },
  });

  assert.equal(result.status, 2, result.stderr);
  assert.match(result.stderr, /global content lock is held/);
});
