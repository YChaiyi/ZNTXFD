import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const repositoryRoot = process.cwd();
const implementationScript = path.join(repositoryRoot, "scripts", "sync_workstation_source.sh");
const sourcePolicyScript = path.join(repositoryRoot, "scripts", "check_source_only.sh");

const contentAgentRules = `# ZNT 内容运营助手

只负责日报、知识沉淀、索引和日报图片的生成、校验与内容发布。
不得发布源码，不得使用 ubuntu、sudo、systemctl、Vercel 或整站 rsync。
`;

const protectedFiles = [
  "data/daily/2026-07-30.json",
  "data/knowledge/index.json",
  "data/knowledge/items/2026-07-30-example.json",
  "data/index.json",
  "data/search-index.json",
  "data/token-rank.json",
  "public/digest-images/2026-07-30/group1.avif",
  ".env.local",
  ".npmrc",
  ".logs/site-update.log",
  ".work/runtime-state.json",
];

const protectedRoots = [
  "data",
  "public/digest-images",
  ".env.local",
  ".npmrc",
  ".logs",
  ".work",
];

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: "utf8",
    ...options,
    env: {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_OPTIONAL_LOCKS: "0",
      GIT_TERMINAL_PROMPT: "0",
      LC_ALL: "C",
      ...options.env,
    },
  }).trim();
}

function git(cwd, args) {
  return run("git", args, { cwd });
}

function writeFile(root, relativePath, contents, mode) {
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents);
  if (mode !== undefined) fs.chmodSync(target, mode);
}

function hashFile(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function snapshotEntry(root, relativePath, output) {
  const target = path.join(root, relativePath);
  const stat = fs.lstatSync(target);
  const record = {
    path: relativePath,
    ino: stat.ino,
    mode: stat.mode,
    size: stat.size,
    type: stat.isDirectory() ? "directory" : stat.isFile() ? "file" : stat.isSymbolicLink() ? "symlink" : "other",
  };
  if (stat.isFile()) record.sha256 = hashFile(target);
  if (stat.isSymbolicLink()) record.target = fs.readlinkSync(target);
  output.push(record);
  if (!stat.isDirectory()) return;

  for (const name of fs.readdirSync(target).sort()) {
    snapshotEntry(root, path.join(relativePath, name), output);
  }
}

function snapshotTree(root) {
  const output = [];
  for (const name of fs.readdirSync(root).sort()) snapshotEntry(root, name, output);
  return output;
}

function snapshotSelected(root, relativePaths) {
  const output = [];
  for (const relativePath of [...relativePaths].sort()) snapshotEntry(root, relativePath, output);
  return output;
}

function findFileWithContents(root, basename, expectedContents) {
  if (!fs.existsSync(root)) return null;
  const pending = [root];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(target);
      } else if (entry.isFile() && entry.name === basename && fs.readFileSync(target, "utf8") === expectedContents) {
        return target;
      }
    }
  }
  return null;
}

function initializeRepository(directory) {
  run("git", ["init", "--quiet", "--initial-branch=main", directory]);
  git(directory, ["config", "user.name", "ZNT workstation fixture"]);
  git(directory, ["config", "user.email", "fixture@example.test"]);
}

function createSourceFixture(root) {
  assert.ok(fs.existsSync(implementationScript), `missing implementation: ${implementationScript}`);
  assert.ok(fs.existsSync(sourcePolicyScript), `missing source policy: ${sourcePolicyScript}`);

  const seed = path.join(root, "source-seed");
  const bare = path.join(root, "source.git");
  const source = path.join(root, "clean-main");
  fs.mkdirSync(seed);
  initializeRepository(seed);

  fs.mkdirSync(path.join(seed, "scripts"), { recursive: true });
  fs.copyFileSync(implementationScript, path.join(seed, "scripts", "sync_workstation_source.sh"));
  fs.copyFileSync(sourcePolicyScript, path.join(seed, "scripts", "check_source_only.sh"));
  fs.chmodSync(path.join(seed, "scripts", "sync_workstation_source.sh"), 0o755);
  fs.chmodSync(path.join(seed, "scripts", "check_source_only.sh"), 0o755);

  writeFile(seed, ".gitignore", [
    "node_modules/",
    ".next/",
    ".env*",
    "!.env.example",
    ".npmrc",
    ".logs/",
    ".work/",
    "AGENTS.md",
    "data/**",
    "public/digest-images/**",
    "",
  ].join("\n"));
  writeFile(seed, ".env.example", "ZNT_SITE_URL=https://znt.group\n");
  writeFile(seed, "README.md", "# source-only fixture\n");
  writeFile(seed, "LICENSE", "fixture license\n");
  writeFile(seed, "package.json", `${JSON.stringify({ name: "znt-source-fixture", version: "1.0.0", private: true }, null, 2)}\n`);
  writeFile(seed, "package-lock.json", `${JSON.stringify({
    name: "znt-source-fixture",
    version: "1.0.0",
    lockfileVersion: 3,
    requires: true,
    packages: { "": { name: "znt-source-fixture", version: "1.0.0" } },
  }, null, 2)}\n`);
  writeFile(seed, "eslint.config.mjs", "export default [];\n");
  writeFile(seed, "next-env.d.ts", "// fixture\n");
  writeFile(seed, "next.config.ts", "export default {};\n");
  writeFile(seed, "postcss.config.mjs", "export default {};\n");
  writeFile(seed, "tailwind.config.ts", "export default {};\n");
  writeFile(seed, "tsconfig.json", "{}\n");
  writeFile(seed, ".github/workflows/ci.yml", "name: fixture\n");
  writeFile(seed, "ops/workstation/AGENTS.content.md", contentAgentRules);
  writeFile(seed, "ops/workstation/content-agent-AGENTS.md", contentAgentRules);
  writeFile(seed, "ops/README.md", "fixture operations\n");
  writeFile(seed, "scripts/deploy_vps.sh", "#!/bin/bash\necho 'content-only publisher'\n", 0o755);
  writeFile(seed, "src/source-marker.txt", "current source\n");
  writeFile(seed, "tests/source-fixture.test.mjs", "// fixture test\n");
  writeFile(seed, "public/favicon.ico", "fixture favicon\n");
  writeFile(seed, "public/token-rank/client.mjs", "export const source = 'current';\n");

  git(seed, ["add", "."]);
  git(seed, ["commit", "--quiet", "-m", "fixture main"]);
  const expectedSha = git(seed, ["rev-parse", "HEAD"]);
  assert.match(expectedSha, /^[0-9a-f]{40}$/);

  run("git", ["init", "--bare", "--quiet", "--initial-branch=main", bare]);
  git(seed, ["remote", "add", "origin", bare]);
  git(seed, ["push", "--quiet", "origin", "main"]);
  run("git", ["clone", "--quiet", "--branch", "main", bare, source]);

  assert.equal(git(source, ["status", "--porcelain", "--untracked-files=all"]), "");
  assert.equal(git(source, ["rev-parse", "HEAD"]), expectedSha);
  assert.equal(git(source, ["remote", "get-url", "origin"]), bare);
  assert.equal(git(source, ["ls-remote", "origin", "refs/heads/main"]).split(/\s+/)[0], expectedSha);
  return { bare, expectedSha, source };
}

function createLegacyProject(root) {
  const project = path.join(root, "project");
  const legacyRemote = path.join(root, "legacy.git");
  fs.mkdirSync(project);
  initializeRepository(project);
  run("git", ["init", "--bare", "--quiet", "--initial-branch=main", legacyRemote]);

  writeFile(project, ".gitignore", "node_modules/\n.next/\n");
  writeFile(project, "README.md", "legacy source\n");
  writeFile(project, "package.json", "{\"name\":\"legacy\",\"private\":true}\n");
  writeFile(project, "scripts/deploy_vps.sh", [
    "#!/bin/bash",
    "rsync -az --delete --rsync-path='sudo rsync' ./ ubuntu@43.128.59.181:/var/www/znt.group/current/",
    "ssh ubuntu@43.128.59.181 'sudo systemctl restart znt-group.service'",
    "",
  ].join("\n"), 0o755);
  writeFile(project, "scripts/legacy-danger.sh", "#!/bin/bash\necho legacy-danger\n", 0o755);
  writeFile(project, "src/source-marker.txt", "legacy source\n");
  writeFile(project, "public/token-rank/client.mjs", "export const source = 'legacy';\n");

  writeFile(project, "data/daily/2026-07-30.json", "{\"date\":\"2026-07-30\",\"title\":\"生产日报\"}\n");
  writeFile(project, "data/knowledge/index.json", "[{\"id\":\"2026-07-30-example\"}]\n");
  writeFile(project, "data/knowledge/items/2026-07-30-example.json", "{\"id\":\"2026-07-30-example\",\"title\":\"知识沉淀\"}\n");
  writeFile(project, "data/index.json", "[{\"date\":\"2026-07-30\"}]\n");
  writeFile(project, "data/search-index.json", "[{\"title\":\"生产检索\"}]\n");
  writeFile(project, "data/token-rank.json", "{\"legacyProductionState\":true}\n");
  writeFile(project, "public/digest-images/2026-07-30/group1.avif", Buffer.from([0, 1, 2, 3, 255]));
  writeFile(project, ".env.local", "PRODUCTION_SECRET=keep-exactly\n");
  writeFile(project, ".npmrc", "registry=https://registry.npmjs.org/\n//example.test/:_authToken=keep-exactly\n");
  writeFile(project, ".logs/site-update.log", "historical log\n");
  writeFile(project, ".work/runtime-state.json", "{\"keep\":true}\n");

  const oldAgents = "# 旧 Agent 指令\n使用 Vercel，并将整个项目 rsync 到服务器。\n";
  const oldVercelIgnore = "data/\npublic/digest-images/\n";
  writeFile(project, "AGENTS.md", oldAgents);
  writeFile(project, ".vercelignore", oldVercelIgnore);

  git(project, ["add", "."]);
  git(project, ["commit", "--quiet", "-m", "legacy production tree"]);
  git(project, ["remote", "add", "origin", legacyRemote]);
  git(project, ["push", "--quiet", "origin", "main"]);

  // Production data commonly changes after the old source commit. The sync must
  // preserve these dirty bytes while detaching them from the new Git history.
  fs.appendFileSync(path.join(project, "data", "daily", "2026-07-30.json"), "\n");
  fs.appendFileSync(path.join(project, ".logs", "site-update.log"), "newer operational entry\n");

  return { legacyRemote, oldAgents, oldVercelIgnore, project };
}

function createFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "znt-workstation-sync-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = createSourceFixture(root);
  const legacy = createLegacyProject(root);
  const backupRoot = path.join(root, "backups");
  const runtime = path.join(root, "runtime");
  const home = path.join(root, "home");
  const fakeBin = path.join(root, "bin");
  fs.mkdirSync(path.join(runtime, ".schedule"), { recursive: true });
  fs.mkdirSync(home);
  fs.mkdirSync(backupRoot);
  // The migration's activity check is tested with an empty process table. A
  // fixture-local ps keeps this deterministic on sandboxes that deny ps(1).
  writeFile(fakeBin, "ps", "#!/bin/sh\nexit 0\n", 0o755);
  return { ...source, ...legacy, backupRoot, fakeBin, home, root, runtime };
}

function runSync(fixture, mode, extraEnv = {}) {
  const args = [
    path.join(fixture.source, "scripts", "sync_workstation_source.sh"),
    mode,
    "--project-dir", fixture.project,
    "--source-dir", fixture.source,
    "--expected-sha", fixture.expectedSha,
    "--repository", fixture.bare,
    "--backup-root", fixture.backupRoot,
  ];
  if (mode === "--apply") args.push("--confirm-content-paused");
  return spawnSync("bash", args, {
    cwd: fixture.root,
    encoding: "utf8",
    timeout: 30_000,
    env: {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_OPTIONAL_LOCKS: "0",
      GIT_TERMINAL_PROMPT: "0",
      GROUP_DIGEST_RUNTIME: fixture.runtime,
      HOME: fixture.home,
      LC_ALL: "C",
      PATH: `${fixture.fakeBin}${path.delimiter}${process.env.PATH ?? ""}`,
      ZNT_SYNC_MIN_FREE_BYTES: "0",
      ZNT_SYNC_SKIP_PROCESS_CHECK: "1",
      ZNT_SYNC_TEST_MODE: "1",
      ...extraEnv,
    },
  });
}

function commandFailure(result) {
  return `status=${result.status} signal=${result.signal}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`;
}

test("workstation source sync dry-run leaves the entire project tree unchanged", (t) => {
  const fixture = createFixture(t);
  const before = snapshotTree(fixture.project);

  const result = runSync(fixture, "--dry-run");
  assert.equal(result.status, 0, commandFailure(result));
  assert.deepEqual(snapshotTree(fixture.project), before);
  assert.deepEqual(fs.readdirSync(fixture.backupRoot), []);
});

test("workstation source sync applies clean main without replacing production content", (t) => {
  const fixture = createFixture(t);
  const protectedBefore = snapshotSelected(fixture.project, protectedRoots);

  const result = runSync(fixture, "--apply");
  assert.equal(result.status, 0, commandFailure(result));

  assert.equal(git(fixture.project, ["rev-parse", "HEAD"]), fixture.expectedSha);
  assert.equal(git(fixture.project, ["branch", "--show-current"]), "main");
  assert.equal(git(fixture.project, ["remote", "get-url", "origin"]), fixture.bare);
  assert.equal(git(fixture.project, ["ls-remote", "origin", "refs/heads/main"]).split(/\s+/)[0], fixture.expectedSha);
  assert.equal(git(fixture.project, ["status", "--porcelain", "--untracked-files=all"]), "");
  assert.equal(git(fixture.project, ["diff", "--exit-code", "HEAD", "--"]), "");
  assert.deepEqual(
    git(fixture.project, ["ls-files"]).split("\n"),
    git(fixture.source, ["ls-files"]).split("\n"),
  );

  assert.deepEqual(snapshotSelected(fixture.project, protectedRoots), protectedBefore);
  const tracked = new Set(git(fixture.project, ["ls-files"]).split("\n"));
  for (const relativePath of protectedFiles) {
    assert.equal(tracked.has(relativePath), false, `${relativePath} must not be tracked`);
    assert.equal(git(fixture.project, ["check-ignore", relativePath]).trim(), relativePath);
  }

  assert.equal(
    fs.readFileSync(path.join(fixture.project, "scripts", "deploy_vps.sh"), "utf8"),
    "#!/bin/bash\necho 'content-only publisher'\n",
  );
  assert.equal(fs.existsSync(path.join(fixture.project, "scripts", "legacy-danger.sh")), false);
  assert.equal(fs.readFileSync(path.join(fixture.project, "AGENTS.md"), "utf8"), contentAgentRules);
  assert.equal(fs.existsSync(path.join(fixture.project, ".vercelignore")), false);
  assert.ok(findFileWithContents(fixture.backupRoot, "AGENTS.md", fixture.oldAgents), "old AGENTS.md was not backed up");
  assert.ok(
    findFileWithContents(fixture.backupRoot, ".vercelignore", fixture.oldVercelIgnore),
    "old .vercelignore was not backed up",
  );
});

test("workstation source sync rolls source and Git back after an injected mutation failure", (t) => {
  const fixture = createFixture(t);
  const protectedBefore = snapshotSelected(fixture.project, protectedRoots);
  const oldHead = git(fixture.project, ["rev-parse", "HEAD"]);
  const oldBranch = git(fixture.project, ["branch", "--show-current"]);
  const oldOrigin = git(fixture.project, ["remote", "get-url", "origin"]);
  const oldStatus = git(fixture.project, ["status", "--porcelain", "--untracked-files=all"]);
  const oldTracked = git(fixture.project, ["ls-files"]);
  const oldDangerousScript = fs.readFileSync(path.join(fixture.project, "scripts", "deploy_vps.sh"), "utf8");

  const result = runSync(fixture, "--apply", { ZNT_SYNC_FAIL_AFTER_MUTATION: "2" });
  assert.notEqual(result.status, 0, "failure injection unexpectedly succeeded");
  assert.match(result.stderr, /injected failure after mutation 2/, commandFailure(result));
  assert.match(result.stdout, /restoring previous source/, commandFailure(result));

  assert.equal(git(fixture.project, ["rev-parse", "HEAD"]), oldHead);
  assert.equal(git(fixture.project, ["branch", "--show-current"]), oldBranch);
  assert.equal(git(fixture.project, ["remote", "get-url", "origin"]), oldOrigin);
  assert.equal(git(fixture.project, ["status", "--porcelain", "--untracked-files=all"]), oldStatus);
  assert.equal(git(fixture.project, ["ls-files"]), oldTracked);
  assert.equal(fs.readFileSync(path.join(fixture.project, "scripts", "deploy_vps.sh"), "utf8"), oldDangerousScript);
  assert.equal(fs.readFileSync(path.join(fixture.project, "AGENTS.md"), "utf8"), fixture.oldAgents);
  assert.equal(fs.readFileSync(path.join(fixture.project, ".vercelignore"), "utf8"), fixture.oldVercelIgnore);
  assert.deepEqual(snapshotSelected(fixture.project, protectedRoots), protectedBefore);
});
