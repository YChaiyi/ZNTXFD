import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const extractor = "ops/lib/extract-content-archive.py";

test("content upload extractor accepts files and rejects symbolic links", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "znt-content-extract-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const source = path.join(root, "source");
  const destination = path.join(root, "destination");
  const archive = path.join(root, "valid.tar.gz");
  fs.mkdirSync(path.join(source, "daily"), { recursive: true });
  fs.mkdirSync(path.join(source, "knowledge", "items"), { recursive: true });
  fs.mkdirSync(destination);
  fs.writeFileSync(path.join(source, "daily", "2026-07-28.json"), "{}\n");
  fs.writeFileSync(path.join(source, "knowledge", "items", "2026-07-28-中文知识.json"), "{}\n");
  execFileSync("tar", ["-C", source, "-czf", archive, "."], {
    env: { ...process.env, COPYFILE_DISABLE: "1" },
  });

  execFileSync("python3", [extractor, archive, destination]);
  assert.equal(fs.readFileSync(path.join(destination, "daily", "2026-07-28.json"), "utf8"), "{}\n");
  assert.equal(
    fs.readFileSync(path.join(destination, "knowledge", "items", "2026-07-28-中文知识.json"), "utf8"),
    "{}\n",
  );

  const malicious = path.join(root, "malicious");
  const rejected = path.join(root, "rejected");
  const maliciousArchive = path.join(root, "malicious.tar.gz");
  fs.mkdirSync(malicious);
  fs.mkdirSync(rejected);
  fs.symlinkSync("/etc/passwd", path.join(malicious, "link"));
  execFileSync("tar", ["-C", malicious, "-czf", maliciousArchive, "."], {
    env: { ...process.env, COPYFILE_DISABLE: "1" },
  });

  assert.throws(() => {
    execFileSync("python3", [extractor, maliciousArchive, rejected], { stdio: "ignore" });
  });
  assert.deepEqual(fs.readdirSync(rejected), []);
});

test("restricted SSH accounts use root-owned forced-command dispatchers", () => {
  const sshd = fs.readFileSync("ops/sshd/znt-restricted.conf", "utf8");
  assert.match(sshd, /AuthorizedKeysFile \/etc\/ssh\/authorized_keys\/zntdeploy/);
  assert.match(sshd, /ForceCommand \/usr\/local\/bin\/znt-deploy-ssh/);
  assert.match(sshd, /AuthorizedKeysFile \/etc\/ssh\/authorized_keys\/zntcontent/);
  assert.match(sshd, /ForceCommand \/usr\/local\/bin\/znt-content-ssh/);
  assert.equal(/\beval\b|\b(?:ba|z|k)?sh\s+-c\b/.test(
    fs.readFileSync("ops/bin/znt-deploy-ssh", "utf8")
      + fs.readFileSync("ops/bin/znt-content-ssh", "utf8"),
  ), false);
  for (const dispatcher of ["ops/bin/znt-deploy-ssh", "ops/bin/znt-content-ssh"]) {
    assert.match(fs.readFileSync(dispatcher, "utf8"), /PATH=\/usr\/local\/sbin:\/usr\/local\/bin:\/usr\/sbin:\/usr\/bin:\/sbin:\/bin/);
  }
  const promoter = fs.readFileSync("ops/bin/znt-content-promote", "utf8");
  assert.match(promoter, /"\$version" = "\$staging_version"/);
  assert.match(promoter, /\[\[ \$# -eq 3 \]\]/);
  assert.match(fs.readFileSync("ops/bin/znt-rollback", "utf8"), /\[\[ \$# -eq 0 \]\]/);
  const bootstrap = fs.readFileSync("ops/bootstrap_vps.sh", "utf8");
  assert.match(bootstrap, /sshd -T -C "user=\$account,host=localhost,addr=127\.0\.0\.1"/);
  assert.match(bootstrap, /validate_effective_ssh_account zntdeploy \/usr\/local\/bin\/znt-deploy-ssh/);
  assert.match(bootstrap, /validate_effective_ssh_account zntcontent \/usr\/local\/bin\/znt-content-ssh/);
  assert.match(bootstrap, /install -o root -g "\$account" -m 0640 \/dev\/null "\$key_file"/);
  assert.match(bootstrap, /chown root:"\$account" "\$key_file"/);
  assert.match(bootstrap, /chmod 0640 "\$key_file"/);
  assert.match(bootstrap, /"root:\$account 640"/);
});

test("code deployment accepts only a SHA and binds it to public GitHub main", () => {
  const workflow = fs.readFileSync(".github/workflows/ci.yml", "utf8");
  const dispatcher = fs.readFileSync("ops/bin/znt-deploy-ssh", "utf8");
  const deploy = fs.readFileSync("ops/bin/znt-code-deploy", "utf8");
  const common = fs.readFileSync("ops/lib/deploy-common.sh", "utf8");
  const bootstrap = fs.readFileSync("ops/bootstrap_vps.sh", "utf8");

  assert.doesNotMatch(workflow, /upload-code|znt-source-.*\.tar\.gz|archive_sha/);
  assert.match(workflow, /"deploy-code \$\{GITHUB_SHA\}"/);
  assert.match(workflow, /ServerAliveInterval=30/);
  assert.doesNotMatch(dispatcher, /upload-code|source archive|archive_sha/);
  assert.match(dispatcher, /znt-code-deploy "\$sha"/);
  assert.match(dispatcher, /flock -w 7200/);
  assert.match(common, /ZNT_SOURCE_REPOSITORY_URL="https:\/\/github\.com\/YChaiyi\/ZNTXFD\.git"/);
  assert.match(common, /clone --quiet --no-tags --depth=1 --single-branch --branch main/);
  assert.match(common, /ls-remote --exit-code "\$ZNT_SOURCE_REPOSITORY_URL" refs\/heads\/main/);
  assert.match(common, /source checkout exceeds the file-count limit/);
  assert.match(common, /source checkout exceeds the byte limit/);
  assert.match(common, /--slice=znt-build\.slice/);
  assert.match(common, /--property=MemoryMax=2G/);
  assert.match(common, /znt_stop_active_build_unit/);
  assert.match(common, /exec \{ZNT_ACTIVE_LOCK_FD\}>&-/);
  assert.match(dispatcher, /exec \{UPLOAD_LOCK_FD\}>&-/);
  assert.match(fs.readFileSync("ops/bin/znt-content-ssh", "utf8"), /exec \{UPLOAD_LOCK_FD\}>&-/);
  assert.ok(
    deploy.indexOf("is already active") < deploy.indexOf("znt_clone_verified_public_main"),
    "active-SHA idempotency must run before the expensive clone/build",
  );
  assert.doesNotMatch(bootstrap, /--source-archive|--source-sha256|SOURCE_ARCHIVE/);
  assert.match(bootstrap, /build_initial_code "\$code_sha" "\$snapshot"/);
});

test("release scripts do not roll back links after committing deployment state", () => {
  for (const file of [
    "ops/bin/znt-code-deploy",
    "ops/bin/znt-content-promote",
    "ops/bin/znt-rollback",
  ]) {
    const script = fs.readFileSync(file, "utf8");
    const stateWrite = script.lastIndexOf("znt_write_state");
    const commitMarker = script.indexOf("switched=0", stateWrite);
    const finalOutput = script.lastIndexOf("echo ");
    assert.ok(stateWrite >= 0, `${file} must write deployment state`);
    assert.ok(commitMarker > stateWrite, `${file} must clear rollback state after committing`);
    assert.ok(finalOutput > commitMarker, `${file} must commit before final output`);
  }
});

test("the application entrypoint binds Next.js to loopback only", () => {
  const entrypoint = fs.readFileSync("ops/bin/znt-app-start", "utf8");
  assert.match(entrypoint, /exec "\$NPM_BIN" start -- --hostname 127\.0\.0\.1/);
});
