import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("deployment flock is exclusive and recovers immediately after a crash", async (t) => {
  if (!fs.existsSync("/usr/bin/flock")) {
    t.skip("Linux flock is not available on this host");
    return;
  }

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "znt-lock-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const holder = spawn("bash", [
    "-c",
    [
      "source ops/lib/deploy-common.sh",
      'znt_lock_acquire "$1" holder',
      'printf "ready\\n"',
      "sleep 30",
    ].join("; "),
    "bash",
    root,
  ], { stdio: ["ignore", "pipe", "pipe"] });
  t.after(() => holder.kill("SIGKILL"));

  await new Promise((resolve, reject) => {
    let output = "";
    holder.stdout.setEncoding("utf8");
    holder.stdout.on("data", (chunk) => {
      output += chunk;
      if (output.includes("ready\n")) resolve();
    });
    holder.once("exit", (code) => reject(new Error(`lock holder exited early: ${code}`)));
  });

  assert.throws(() => {
    execFileSync("bash", [
      "-c",
      'source ops/lib/deploy-common.sh; znt_lock_acquire "$1" contender',
      "bash",
      root,
    ], { stdio: "ignore" });
  });

  holder.kill("SIGKILL");
  await once(holder, "exit");

  execFileSync("bash", [
    "-c",
    'source ops/lib/deploy-common.sh; znt_lock_acquire "$1" recovered; znt_lock_release',
    "bash",
    root,
  ]);
});
