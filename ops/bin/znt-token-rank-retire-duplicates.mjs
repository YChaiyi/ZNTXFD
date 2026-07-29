#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function fail(message) {
  throw new Error(message);
}

function beijingDateAt(time) {
  return new Date(time + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function addDays(date, offset) {
  const time = Date.parse(`${date}T00:00:00Z`) + offset * 86400000;
  return new Date(time).toISOString().slice(0, 10);
}

export function normalizeNickname(value) {
  return typeof value === "string"
    ? value.normalize("NFKC").trim().replace(/\s+/gu, " ").slice(0, 32)
    : "";
}

function nicknameKey(value) {
  return normalizeNickname(value).toLowerCase();
}

function isActive(user) {
  return user?.active !== false;
}

function tokenTotal(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function validateStore(store) {
  if (!store || typeof store !== "object" || !Array.isArray(store.users) || !Array.isArray(store.records)) {
    fail("Token Rank store 的 users 或 records 无效");
  }
  if (!Array.isArray(store.collectors)) fail("Token Rank store 的 collectors 无效");
  if (!Number.isSafeInteger(store.revision) || store.revision < 0) {
    fail("Token Rank store 的 revision 无效");
  }
}

export function planDuplicateRetirements(store, now = Date.now()) {
  validateStore(store);
  const today = beijingDateAt(now);
  const start = addDays(today, -29);
  const activeUsers = store.users.filter(isActive);
  const knownTokens = new Set(activeUsers.map((user) => user.tokenHash));
  const totals = new Map();

  for (const record of store.records) {
    if (!record || !knownTokens.has(record.tokenHash)) continue;
    if (typeof record.date !== "string" || record.date < start || record.date > today) continue;
    totals.set(record.tokenHash, (totals.get(record.tokenHash) ?? 0) + tokenTotal(record.totalTokens));
  }

  const groups = new Map();
  for (const user of activeUsers) {
    const key = nicknameKey(user.name);
    if (!key) continue;
    const group = groups.get(key) ?? [];
    group.push(user);
    groups.set(key, group);
  }

  const retirements = [];
  const tied = [];
  for (const users of groups.values()) {
    if (users.length < 2) continue;
    const scored = users.map((user) => ({
      user,
      recent30dTokens: totals.get(user.tokenHash) ?? 0,
    }));
    const highest = Math.max(...scored.map((item) => item.recent30dTokens));
    const allZero = highest === 0;
    const candidates = allZero
      ? scored
      : scored.filter((item) => item.recent30dTokens < highest);

    if (candidates.length > 0) {
      retirements.push(...candidates.map((item) => ({
        userId: item.user.userId,
        name: normalizeNickname(item.user.name),
        recent30dTokens: item.recent30dTokens,
      })));
    }

    const remaining = scored.filter((item) => !candidates.includes(item));
    if (remaining.length > 1) {
      tied.push({
        name: normalizeNickname(users[0].name),
        recent30dTokens: highest,
        userIds: remaining.map((item) => item.user.userId).sort((a, b) => a - b),
      });
    }
  }

  retirements.sort((a, b) => a.name.localeCompare(b.name) || a.userId - b.userId);
  tied.sort((a, b) => a.name.localeCompare(b.name));
  return { start, end: today, retirements, tied };
}

function parseArgs(argv) {
  let storePath = "";
  let apply = false;
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--store") {
      storePath = argv[index + 1] ?? "";
      index += 1;
    } else if (value === "--apply") {
      apply = true;
    } else {
      fail(`未知参数：${value}`);
    }
  }
  if (!storePath || !path.isAbsolute(storePath)) {
    fail("必须通过 --store 提供绝对 Token Rank store 路径");
  }
  return { storePath, apply };
}

function writeStoreAtomically(storePath, store, sourceStat) {
  const temporary = `${storePath}.${process.pid}.dedupe.tmp`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(store, null, 2)}\n`, { mode: sourceStat.mode & 0o777 });
    fs.chmodSync(temporary, sourceStat.mode & 0o777);
    if (typeof process.getuid === "function" && process.getuid() === 0) {
      fs.chownSync(temporary, sourceStat.uid, sourceStat.gid);
    } else if (typeof process.getuid === "function" && sourceStat.uid !== process.getuid()) {
      fail("非 root 用户只能修改自己拥有的 Token Rank store");
    }
    fs.renameSync(temporary, storePath);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

export function run(storePath, apply, now = Date.now()) {
  const sourceStat = fs.lstatSync(storePath);
  if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) {
    fail("Token Rank store 必须是普通文件");
  }
  const store = JSON.parse(fs.readFileSync(storePath, "utf8"));
  const plan = planDuplicateRetirements(store, now);

  if (apply && plan.retirements.length > 0) {
    const retiredIds = new Set(plan.retirements.map((item) => item.userId));
    const retiredAt = new Date(now).toISOString();
    store.users = store.users.map((user) => retiredIds.has(user.userId)
      ? { ...user, active: false, retiredAt, retiredReason: "duplicate_nickname" }
      : user);
    store.revision += 1;
    writeStoreAtomically(storePath, store, sourceStat);
  }

  return { apply, ...plan, retiredCount: apply ? plan.retirements.length : 0 };
}

function main() {
  const { storePath, apply } = parseArgs(process.argv.slice(2));
  const result = run(storePath, apply);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

function isMainModule() {
  if (!process.argv[1]) return false;
  try {
    return fs.realpathSync(fileURLToPath(import.meta.url)) === fs.realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

if (isMainModule()) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}
