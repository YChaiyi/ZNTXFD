#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const MANIFEST_NAME = ".znt-code-release.json";
function fail(message) {
  console.error(`code release manifest: ${message}`);
  process.exit(1);
}

function assertSha(value) {
  if (!/^[0-9a-f]{40}$/.test(value ?? "")) fail("invalid code SHA");
}

function assertDirectory(root, label) {
  let stat;
  try {
    stat = fs.lstatSync(root);
  } catch {
    fail(`${label} does not exist`);
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail(`${label} must be a real directory`);
}

function fileHash(root, relative) {
  const target = path.join(root, relative);
  let stat;
  try {
    stat = fs.lstatSync(target);
  } catch {
    fail(`required file is missing: ${relative}`);
  }
  if (!stat.isFile() || stat.isSymbolicLink()) fail(`required path is not a regular file: ${relative}`);
  return crypto.createHash("sha256").update(fs.readFileSync(target)).digest("hex");
}

function sourceTreeFiles(root, releaseTree = false) {
  const files = [];

  function visit(relativeDirectory) {
    const directory = path.join(root, relativeDirectory);
    const entries = fs.readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name, "en"));
    for (const entry of entries) {
      const relative = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      if (releaseTree && !relativeDirectory && (entry.name === ".next" || entry.name === "node_modules")) {
        continue;
      }
      if (releaseTree && relative === MANIFEST_NAME) continue;
      if (entry.isDirectory()) visit(relative);
      else if (entry.isFile()) files.push(relative);
      else fail(`source tree contains an unsupported path: ${relative}`);
    }
  }

  visit("");
  return files;
}

function releaseInventory(root) {
  const directories = [];
  const entries = {};

  function visit(relativeDirectory) {
    const directory = path.join(root, relativeDirectory);
    const children = fs.readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name, "en"));
    for (const child of children) {
      const relative = relativeDirectory ? `${relativeDirectory}/${child.name}` : child.name;
      if (relative === MANIFEST_NAME) continue;
      if (child.isDirectory()) {
        directories.push(relative);
        visit(relative);
      } else if (child.isFile()) {
        entries[relative] = { type: "file", sha256: fileHash(root, relative) };
      } else if (child.isSymbolicLink()) {
        const target = fs.readlinkSync(path.join(root, relative));
        entries[relative] = {
          type: "symlink",
          sha256: crypto.createHash("sha256").update(target).digest("hex"),
        };
      } else {
        fail(`release contains an unsupported path: ${relative}`);
      }
    }
  }

  visit("");
  return { directories, entries };
}

function create(root, codeSha) {
  assertDirectory(root, "release");
  assertSha(codeSha);
  const manifestPath = path.join(root, MANIFEST_NAME);
  if (fs.existsSync(manifestPath)) fail(`${MANIFEST_NAME} already exists`);
  const inventory = releaseInventory(root);
  const manifest = {
    schemaVersion: 2,
    codeSha,
    tokenRankUploadProtocol: 2,
    tokenRankPartialUpload: true,
    directories: inventory.directories,
    entries: inventory.entries,
  };
  const temporary = `${manifestPath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(manifest, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o640,
  });
  fs.renameSync(temporary, manifestPath);
}

function verify(root, codeSha) {
  assertDirectory(root, "release");
  assertSha(codeSha);
  const manifestPath = path.join(root, MANIFEST_NAME);
  let stat;
  try {
    stat = fs.lstatSync(manifestPath);
  } catch {
    fail(`${MANIFEST_NAME} is missing`);
  }
  if (!stat.isFile() || stat.isSymbolicLink()) fail(`${MANIFEST_NAME} must be a regular file`);

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch {
    fail(`${MANIFEST_NAME} is not valid JSON`);
  }
  if (manifest.schemaVersion !== 2) fail("unsupported manifest schema");
  if (manifest.codeSha !== codeSha) fail("manifest SHA does not match the release path");
  if (manifest.tokenRankUploadProtocol !== 2 || manifest.tokenRankPartialUpload !== true) {
    fail("manifest does not require Token Rank partial upload support");
  }
  if (!Array.isArray(manifest.directories) || manifest.directories.some((entry) => typeof entry !== "string")) {
    fail("manifest directory inventory is invalid");
  }
  if (!manifest.entries || typeof manifest.entries !== "object" || Array.isArray(manifest.entries)) {
    fail("manifest release inventory is invalid");
  }
  const actual = releaseInventory(root);
  if (JSON.stringify(manifest.directories) !== JSON.stringify(actual.directories)) {
    fail("release directory set changed");
  }
  const recordedPaths = Object.keys(manifest.entries).sort();
  const actualPaths = Object.keys(actual.entries).sort();
  if (JSON.stringify(recordedPaths) !== JSON.stringify(actualPaths)) fail("release entry set changed");
  for (const relative of actualPaths) {
    const recorded = manifest.entries[relative];
    const observed = actual.entries[relative];
    if (
      !recorded || typeof recorded !== "object" ||
      recorded.type !== observed.type || recorded.sha256 !== observed.sha256
    ) {
      fail(`release entry changed: ${relative}`);
    }
  }
}

function matchSource(releaseRoot, sourceRoot) {
  assertDirectory(releaseRoot, "release");
  assertDirectory(sourceRoot, "source checkout");
  const releaseFiles = sourceTreeFiles(releaseRoot, true);
  const sourceFiles = sourceTreeFiles(sourceRoot);
  if (JSON.stringify(releaseFiles) !== JSON.stringify(sourceFiles)) {
    fail("active release source file set differs from GitHub main");
  }
  for (const relative of sourceFiles) {
    if (fileHash(releaseRoot, relative) !== fileHash(sourceRoot, relative)) {
      fail(`active release differs from GitHub main: ${relative}`);
    }
  }
}

const [command, root, value] = process.argv.slice(2);
if (command === "create") create(root, value);
else if (command === "verify") verify(root, value);
else if (command === "match-source") matchSource(root, value);
else fail("usage: code-release-manifest.mjs create|verify RELEASE SHA | match-source RELEASE SOURCE");
