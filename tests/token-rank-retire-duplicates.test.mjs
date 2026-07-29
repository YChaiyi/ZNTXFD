import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { run } from "../ops/bin/znt-token-rank-retire-duplicates.mjs";

const NOW = Date.parse("2026-07-29T04:00:00.000Z");

function user(userId, tokenHash, name) {
  return {
    userId,
    tokenHash,
    name,
    role: "测试",
    createdAt: "2026-07-01T00:00:00.000Z",
    public: true,
    active: true,
  };
}

function record(tokenHash, userId, date, totalTokens) {
  return {
    userId,
    tokenHash,
    deviceId: `device-${userId}`,
    clientVersion: "0.2.0",
    date,
    tool: "codex",
    model: "test",
    inputTokens: totalTokens,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens,
    inputTokenSemantics: "fresh",
    createdAt: "2026-07-29T00:00:00.000Z",
  };
}

test("duplicate retirement keeps the high scorer, retires zero-token duplicates, and preserves history", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "znt-tokenrank-retire-test-"));
  const storePath = path.join(directory, "store.json");
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));

  const store = {
    revision: 10,
    users: [
      user(1, "high", "haiyi"),
      user(2, "low", "Haiyi"),
      user(3, "south-a", "南山客"),
      user(4, "south-b", " 南山客 "),
      user(5, "fresh", "新用户"),
    ],
    records: [
      record("high", 1, "2026-07-29", 16574061096),
      record("low", 2, "2026-06-29", 999),
    ],
    collectors: [
      { userId: 2, tokenHash: "low", deviceId: "device-2", tool: "codex" },
      { userId: 3, tokenHash: "south-a", deviceId: "device-3", tool: "codex" },
    ],
    lastUploadAt: "2026-07-29T00:00:00.000Z",
  };
  fs.writeFileSync(storePath, JSON.stringify(store, null, 2), { mode: 0o600 });
  const before = fs.readFileSync(storePath, "utf8");

  const preview = run(storePath, false, NOW);
  assert.deepEqual(preview.retirements.map((item) => item.userId), [2, 3, 4]);
  assert.equal(preview.retiredCount, 0);
  assert.deepEqual(preview.tied, []);
  assert.equal(fs.readFileSync(storePath, "utf8"), before);

  const applied = run(storePath, true, NOW);
  assert.equal(applied.retiredCount, 3);
  const saved = JSON.parse(fs.readFileSync(storePath, "utf8"));
  assert.equal(saved.revision, 11);
  assert.deepEqual(
    saved.users.filter((item) => item.active === false).map((item) => item.userId).sort((a, b) => a - b),
    [2, 3, 4],
  );
  assert.equal(saved.users.find((item) => item.userId === 1).active, true);
  assert.equal(saved.users.find((item) => item.userId === 5).active, true);
  assert.equal(saved.records.length, store.records.length);
  assert.equal(saved.collectors.length, store.collectors.length);
});
