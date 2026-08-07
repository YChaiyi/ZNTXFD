import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const tool = "ops/lib/code-release-manifest.mjs";
const sha = "a".repeat(40);
const sourceFiles = [
  "next.config.ts",
  "package-lock.json",
  "package.json",
  "public/token-rank/client.mjs",
  "public/token-rank/install.sh",
  "src/app/token-rank/page.tsx",
  "src/app/api/health/route.ts",
  "src/app/api/token-rank/upload/route.ts",
  "src/lib/tokenRankStore.ts",
];

function write(root, relative, content = `${relative}\n`) {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "znt-release-integrity-"));
  const release = path.join(root, "release");
  const source = path.join(root, "source");
  fs.mkdirSync(release);
  fs.mkdirSync(source);
  for (const relative of sourceFiles) {
    write(release, relative);
    write(source, relative);
  }
  write(release, ".next/BUILD_ID", "build-id\n");
  return { root, release, source };
}

function run(args) {
  return spawnSync(process.execPath, [tool, ...args], { encoding: "utf8" });
}

test("code release manifest detects source and build tampering", (t) => {
  const { root, release } = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const created = run(["create", release, sha]);
  assert.equal(created.status, 0, created.stderr);
  const manifest = JSON.parse(fs.readFileSync(path.join(release, ".znt-code-release.json"), "utf8"));
  assert.equal(manifest.schemaVersion, 2);
  assert.equal(manifest.codeSha, sha);
  assert.equal(manifest.tokenRankUploadProtocol, 2);
  assert.equal(manifest.tokenRankPartialUpload, true);
  assert.equal(manifest.entries["public/token-rank/client.mjs"].type, "file");
  assert.ok(manifest.directories.includes("src/app/api/health"));

  const verified = run(["verify", release, sha]);
  assert.equal(verified.status, 0, verified.stderr);

  fs.appendFileSync(path.join(release, "public/token-rank/client.mjs"), "tampered\n");
  const changed = run(["verify", release, sha]);
  assert.notEqual(changed.status, 0);
  assert.match(changed.stderr, /release entry changed/);
});

test("code release manifest rejects added files, removed directories, and changed links", (t) => {
  const { root, release } = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.symlinkSync("../package.json", path.join(release, "public", "package-link"));
  assert.equal(run(["create", release, sha]).status, 0);

  write(release, "public/unrecorded.mjs", "unexpected\n");
  assert.match(run(["verify", release, sha]).stderr, /release entry set changed/);
  fs.rmSync(path.join(release, "public/unrecorded.mjs"));

  fs.rmSync(path.join(release, "public", "package-link"));
  fs.symlinkSync("../next.config.ts", path.join(release, "public", "package-link"));
  assert.match(run(["verify", release, sha]).stderr, /release entry changed/);
});

test("unsealed release adoption requires source equality with GitHub checkout", (t) => {
  const { root, release, source } = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const matching = run(["match-source", release, source]);
  assert.equal(matching.status, 0, matching.stderr);

  fs.appendFileSync(path.join(source, "src/app/token-rank/page.tsx"), "changed\n");
  const mismatch = run(["match-source", release, source]);
  assert.notEqual(mismatch.status, 0);
  assert.match(mismatch.stderr, /active release differs from GitHub main/);

  fs.writeFileSync(path.join(source, "src/app/token-rank/page.tsx"), "src/app/token-rank/page.tsx\n");
  write(release, "src/app/obsolete-page.tsx");
  const extra = run(["match-source", release, source]);
  assert.notEqual(extra.status, 0);
  assert.match(extra.stderr, /source file set differs from GitHub main/);
});

test("deployment seals code and validates protocol before code or content activation", () => {
  const common = fs.readFileSync("ops/lib/deploy-common.sh", "utf8");
  const deploy = fs.readFileSync("ops/bin/znt-code-deploy", "utf8");
  const promote = fs.readFileSync("ops/bin/znt-content-promote", "utf8");
  const rollback = fs.readFileSync("ops/bin/znt-rollback", "utf8");
  const bootstrap = fs.readFileSync("ops/bootstrap_vps.sh", "utf8");

  assert.match(common, /find -P "\$release" -xdev .*"\$ZNT_CHATTR_BIN" \+i/);
  assert.match(common, /health\.tokenRankUploadProtocol === 2/);
  assert.match(common, /health\.tokenRankPartialUpload === true/);
  assert.match(common, /znt_code_release_permissions_valid/);
  assert.match(common, /partial seal was removed/);
  assert.match(deploy, /znt_seal_code_release "\$release" "\$SHA"/);
  assert.match(deploy, /--recover-unsealed/);
  assert.match(deploy, /\.quarantine/);
  assert.match(deploy, /never become a normal rollback target/);
  assert.match(deploy, /capture_legacy_content "\$previous_code"/);
  assert.match(deploy, /legacy_content_matches "\$previous_code" "\$activation_content"/);
  assert.match(deploy, /legacy content changed during the recovery build/);
  assert.match(deploy, /active release changed during sealing; the seal was removed/);
  assert.match(deploy, /active code release is not sealed/);
  assert.match(deploy, /znt_prune_releases .* code/);
  assert.match(promote, /znt_code_release_valid "\$previous_code" "\$previous_code_sha"/);
  assert.match(promote, /znt_content_smoke "\$version" "\$previous_code_sha"/);
  assert.match(bootstrap, /code-release-manifest\.mjs/);
  assert.match(bootstrap, /prepare-integrity/);
  assert.match(bootstrap, /active code release must be sealed before prepare/);
  assert.match(bootstrap, /znt_seal_code_release "\$release" "\$code_sha"/);
  assert.ok(
    rollback.indexOf("znt_code_release_valid") < rollback.indexOf('systemctl stop "$SERVICE"', rollback.indexOf('znt_code_release_valid')),
    "rollback must validate its target before stopping the service",
  );
  assert.match(rollback, /znt_start_and_check "\$SERVICE" "\$target_sha" "\$ROOT" "\$target_content_version"/);
});

test("health matching requires the exact code, content, and partial-upload protocol", () => {
  const common = path.resolve("ops/lib/deploy-common.sh");
  const expectedSha = "b".repeat(40);
  const expectedContent = "content-v1";
  const runHealth = (body) => spawnSync("bash", [
    "-c",
    'source "$1"; ZNT_NODE_BIN="$2"; curl() { printf "%s" "$HEALTH_BODY"; }; znt_health_matches "$3" "$4"',
    "bash",
    common,
    process.execPath,
    expectedSha,
    expectedContent,
  ], {
    encoding: "utf8",
    env: { ...process.env, HEALTH_BODY: JSON.stringify(body) },
  });

  const valid = runHealth({
    ready: true,
    buildSha: expectedSha,
    contentVersion: expectedContent,
    tokenRankUploadProtocol: 2,
    tokenRankPartialUpload: true,
  });
  assert.equal(valid.status, 0, valid.stderr);

  for (const invalid of [
    { ready: true, buildSha: expectedSha, contentVersion: expectedContent },
    { ready: true, buildSha: expectedSha, contentVersion: "other", tokenRankUploadProtocol: 2, tokenRankPartialUpload: true },
    { ready: true, buildSha: expectedSha, contentVersion: expectedContent, tokenRankUploadProtocol: 1, tokenRankPartialUpload: true },
  ]) {
    assert.notEqual(runHealth(invalid).status, 0);
  }
});
