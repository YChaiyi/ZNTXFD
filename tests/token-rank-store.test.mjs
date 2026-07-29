import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const DEVICE_A = "a".repeat(32);
const DEVICE_B = "b".repeat(32);
let moduleSequence = 0;

function beijingDate(time = Date.now()) {
  return new Date(time + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function addDays(date, offset) {
  const time = Date.parse(`${date}T00:00:00Z`) + offset * 86400000;
  return new Date(time).toISOString().slice(0, 10);
}

async function setupStore(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "znt-tokenrank-store-test-"));
  const storePath = path.join(dir, "store.json");
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  process.env.TOKEN_RANK_STORE_PATH = storePath;
  moduleSequence += 1;
  const store = await import(`../src/lib/tokenRankStore.ts?store-test=${moduleSequence}`);
  return { store, storePath };
}

function legacyRecord({ date, tool = "codex", model = "unknown", total = 110 }) {
  return {
    date,
    tool,
    model,
    inputTokens: 100,
    outputTokens: 10,
    cacheReadTokens: 60,
    cacheWriteTokens: 0,
    totalTokens: total,
  };
}

function codexRecord({ date, model = "gpt-5.6-sol", input = 30, output = 5, cache = 65 }) {
  return {
    date,
    tool: "codex",
    model,
    inputTokens: input,
    outputTokens: output,
    cacheReadTokens: cache,
    cacheWriteTokens: 0,
    totalTokens: input + output + cache,
    inputTokenSemantics: "fresh",
  };
}

function v2Payload({
  records = [],
  deviceId = DEVICE_A,
  snapshotId = "snapshot-1",
  observedThrough = new Date().toISOString(),
  includeSnapshot = true,
} = {}) {
  const observedMs = Date.parse(observedThrough);
  const normalizedObservedThrough = new Date(observedMs).toISOString();
  const endDate = beijingDate(observedMs);
  const startDate = addDays(endDate, -34);
  return {
    protocolVersion: 2,
    deviceId,
    clientVersion: "0.2.0",
    collector: {
      tool: "codex",
      observedThrough: normalizedObservedThrough,
    },
    ...(includeSnapshot
      ? {
          snapshot: {
            id: snapshotId,
            tool: "codex",
            complete: true,
            observedThrough: normalizedObservedThrough,
            startDate,
            endDate,
            timeZone: "Asia/Shanghai",
          },
        }
      : {}),
    records,
  };
}

function persisted(storePath) {
  return JSON.parse(fs.readFileSync(storePath, "utf8"));
}

test("a v2 Codex snapshot clears zero days and preserves every ownership boundary", async (t) => {
  const { store, storePath } = await setupStore(t);
  const { token: tokenA, user: userA } = await store.createTokenRankUser({ name: "owner-a" });
  const { token: tokenB, user: userB } = await store.createTokenRankUser({ name: "owner-b" });
  assert.notEqual(userA.userId, userB.userId);
  assert.ok(Number.isSafeInteger(userA.userId));

  const today = beijingDate();
  const zeroDay = addDays(today, -1);
  const outside = addDays(today, -35);
  await store.appendTokenRankUsage(tokenA, {
    deviceId: DEVICE_A,
    clientVersion: "0.1.0",
    records: [
      legacyRecord({ date: today, model: "legacy-today" }),
      legacyRecord({ date: zeroDay, model: "legacy-zero-day" }),
      legacyRecord({ date: outside, model: "outside-window" }),
      legacyRecord({ date: zeroDay, tool: "claude-code", model: "other-tool" }),
    ],
  });
  await store.appendTokenRankUsage(tokenA, {
    deviceId: DEVICE_B,
    clientVersion: "0.1.0",
    records: [legacyRecord({ date: zeroDay, model: "other-device" })],
  });
  await store.appendTokenRankUsage(tokenB, {
    deviceId: DEVICE_A,
    clientVersion: "0.1.0",
    records: [legacyRecord({ date: zeroDay, model: "other-user" })],
  });

  const result = await store.appendTokenRankUsage(tokenA, v2Payload({
    records: [codexRecord({ date: today, model: "gpt-a" })],
  }));
  assert.deepEqual(result, { ok: true, accepted: 1, replaced: 2 });

  const data = persisted(storePath);
  const ownerRecords = data.records.filter((record) => record.tokenHash === userA.tokenHash);
  assert.ok(ownerRecords.some((record) => record.model === "gpt-a"));
  assert.ok(!ownerRecords.some((record) => record.model === "legacy-today"));
  assert.ok(!ownerRecords.some((record) => record.model === "legacy-zero-day"));
  assert.ok(ownerRecords.some((record) => record.model === "outside-window"));
  assert.ok(ownerRecords.some((record) => record.model === "other-tool"));
  assert.ok(ownerRecords.some((record) => record.model === "other-device"));
  assert.ok(data.records.some(
    (record) => record.tokenHash === userB.tokenHash && record.model === "other-user",
  ));
});

test("an empty authoritative snapshot clears stale Codex and records a stable real sync time", async (t) => {
  const { store, storePath } = await setupStore(t);
  const { token } = await store.createTokenRankUser({ name: "empty-snapshot" });
  const today = beijingDate();
  await store.appendTokenRankUsage(token, {
    deviceId: DEVICE_A,
    clientVersion: "0.1.0",
    records: [legacyRecord({ date: today })],
  });

  const result = await store.appendTokenRankUsage(token, v2Payload({
    records: [],
    snapshotId: "empty-snapshot",
  }));
  assert.deepEqual(result, { ok: true, accepted: 0, replaced: 1 });
  const data = persisted(storePath);
  assert.equal(data.records.length, 0);
  assert.equal(data.collectors.length, 1);
  assert.ok(data.collectors[0].lastSync);
  assert.equal(data.lastUploadAt, data.collectors[0].lastSync);

  const firstBoard = await store.getTokenRankLeaderboard({ range: "today" });
  await new Promise((resolve) => setTimeout(resolve, 5));
  const secondBoard = await store.getTokenRankLeaderboard({ range: "today" });
  assert.equal(firstBoard.updatedAt, data.lastUploadAt);
  assert.equal(secondBoard.updatedAt, firstBoard.updatedAt, "GET must not manufacture a new sync time");
  const me = await store.getTokenRankMe(token);
  assert.equal(me.totals.lastSync, data.collectors[0].lastSync);
});

test("v2 validation rejects the entire package without changing persisted bytes", async (t) => {
  const { store, storePath } = await setupStore(t);
  const { token } = await store.createTokenRankUser({ name: "strict-validation" });
  const today = beijingDate();
  await store.appendTokenRankUsage(token, {
    deviceId: DEVICE_A,
    clientVersion: "0.1.0",
    records: [legacyRecord({ date: today })],
  });
  const goodRecord = codexRecord({ date: today });
  const base = v2Payload({ records: [goodRecord] });
  const tooMany = Array.from({ length: 2001 }, (_, index) => ({
    ...goodRecord,
    model: `model-${index}`,
  }));
  const invalidPayloads = [
    { ...base, deviceId: "not-a-device" },
    { ...base, snapshot: { ...base.snapshot, complete: false } },
    { ...base, snapshot: { ...base.snapshot, startDate: addDays(base.snapshot.startDate, 1) } },
    { ...base, records: [{ ...goodRecord, date: "2026-02-30" }] },
    { ...base, records: [goodRecord, { ...goodRecord }] },
    { ...base, records: [{ ...goodRecord, totalTokens: goodRecord.totalTokens + 1 }] },
    { ...base, records: [{ ...goodRecord, date: addDays(base.snapshot.startDate, -1) }] },
    { ...base, records: tooMany },
  ];

  for (const payload of invalidPayloads) {
    const before = fs.readFileSync(storePath, "utf8");
    const result = await store.appendTokenRankUsage(token, payload);
    assert.equal(result.ok, false);
    assert.equal(result.status, 400);
    assert.equal(fs.readFileSync(storePath, "utf8"), before);
  }
});

test("snapshot ids are idempotent and older Codex collectors or v1 clients cannot roll back data", async (t) => {
  const { store, storePath } = await setupStore(t);
  const { token } = await store.createTokenRankUser({ name: "high-water" });
  const now = Date.now();
  const today = beijingDate(now);
  const payload = v2Payload({
    records: [codexRecord({ date: today, model: "current" })],
    snapshotId: "stable-id",
    observedThrough: new Date(now).toISOString(),
  });
  const first = await store.appendTokenRankUsage(token, payload);
  assert.deepEqual(first, { ok: true, accepted: 1, replaced: 0 });
  const afterFirst = fs.readFileSync(storePath, "utf8");

  const retry = await store.appendTokenRankUsage(token, payload);
  assert.deepEqual(retry, { ok: true, accepted: 1, replaced: 0, idempotent: true });
  assert.equal(fs.readFileSync(storePath, "utf8"), afterFirst);

  const reusedId = await store.appendTokenRankUsage(token, {
    ...payload,
    records: [codexRecord({ date: today, model: "changed", input: 31 })],
  });
  assert.equal(reusedId.ok, false);
  assert.equal(reusedId.status, 409);

  const older = v2Payload({
    records: [codexRecord({ date: today, model: "older" })],
    snapshotId: "older-id",
    observedThrough: new Date(now - 60_000).toISOString(),
  });
  const stale = await store.appendTokenRankUsage(token, older);
  assert.equal(stale.ok, false);
  assert.equal(stale.status, 409);

  const legacyCodex = await store.appendTokenRankUsage(token, {
    deviceId: DEVICE_A,
    clientVersion: "0.1.0",
    records: [legacyRecord({ date: today, model: "legacy-return" })],
  });
  assert.equal(legacyCodex.ok, false);
  assert.equal(legacyCodex.status, 409);

  const otherDeviceCodex = await store.appendTokenRankUsage(token, {
    deviceId: DEVICE_B,
    clientVersion: "0.1.0",
    records: [legacyRecord({ date: today, model: "other-device-after-v2" })],
  });
  assert.equal(otherDeviceCodex.ok, true);

  const legacyOtherTool = await store.appendTokenRankUsage(token, {
    deviceId: DEVICE_A,
    clientVersion: "0.1.0",
    records: [legacyRecord({ date: today, tool: "claude-code", model: "allowed" })],
  });
  assert.equal(legacyOtherTool.ok, true);
  assert.ok(persisted(storePath).records.some((record) => record.model === "allowed"));
  assert.ok(persisted(storePath).records.some((record) => record.model === "current"));
  assert.ok(persisted(storePath).records.some((record) => record.model === "other-device-after-v2"));
});

test("legacy cache normalization is limited to Codex", async (t) => {
  const { store, storePath } = await setupStore(t);
  const { token, user } = await store.createTokenRankUser({ name: "cache-semantics" });
  const today = beijingDate();
  await store.appendTokenRankUsage(token, {
    deviceId: DEVICE_A,
    clientVersion: "0.1.0",
    records: [
      legacyRecord({ date: today, tool: "codex", model: "codex-old" }),
      legacyRecord({ date: today, tool: "gemini", model: "gemini-old" }),
    ],
  });
  const data = persisted(storePath);
  const codex = data.records.find(
    (record) => record.tokenHash === user.tokenHash && record.model === "codex-old",
  );
  const gemini = data.records.find(
    (record) => record.tokenHash === user.tokenHash && record.model === "gemini-old",
  );
  assert.equal(codex.inputTokens, 40);
  assert.equal(codex.totalTokens, 110);
  assert.equal(gemini.inputTokens, 100);
  assert.equal(gemini.totalTokens, 170);
});

test("local concurrent registrations retain every user and generate unique safe ids", async (t) => {
  const { store, storePath } = await setupStore(t);
  await Promise.all(
    Array.from({ length: 20 }, (_, index) => store.createTokenRankUser({ name: `user-${index}` })),
  );
  const users = persisted(storePath).users;
  assert.equal(users.length, 20);
  assert.equal(new Set(users.map((user) => user.userId)).size, 20);
  assert.ok(users.every((user) => Number.isSafeInteger(user.userId) && user.userId > 0));
});

test("nickname registration rejects canonical duplicates without creating another identity", async (t) => {
  const { store, storePath } = await setupStore(t);
  const first = await store.createTokenRankUser({ name: "  Haiyi  " });
  const before = fs.readFileSync(storePath, "utf8");

  await assert.rejects(
    store.createTokenRankUser({ name: "ｈａｉｙｉ" }),
    (error) => error?.code === "nickname_taken" && error?.status === 409,
  );
  await assert.rejects(
    store.createTokenRankUser({ name: "   " }),
    (error) => error?.code === "invalid_nickname" && error?.status === 400,
  );
  assert.equal(fs.readFileSync(storePath, "utf8"), before);
  assert.equal(first.user.name, "Haiyi");

  const results = await Promise.allSettled(
    Array.from({ length: 20 }, () => store.createTokenRankUser({ name: "same nickname" })),
  );
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 19);
  const users = persisted(storePath).users;
  assert.equal(users.filter((user) => user.name === "same nickname").length, 1);
});

test("retired identities are excluded from the leaderboard and cannot upload", async (t) => {
  const { store, storePath } = await setupStore(t);
  const { token, user } = await store.createTokenRankUser({ name: "retired-user" });
  const data = persisted(storePath);
  data.users = data.users.map((candidate) => candidate.userId === user.userId
    ? { ...candidate, active: false, retiredAt: new Date().toISOString() }
    : candidate);
  fs.writeFileSync(storePath, JSON.stringify(data));

  const upload = await store.appendTokenRankUsage(token, {});
  assert.deepEqual(upload, {
    ok: false,
    status: 410,
    message: "此专属命令已停用，请使用保留的客户端",
  });
  const board = await store.getTokenRankLeaderboard({ range: "30d" });
  assert.equal(board.totalMembers, 0);
  assert.equal(board.entries.length, 0);
});

test("a retired nickname can be reclaimed by a new active identity", async (t) => {
  const { store, storePath } = await setupStore(t);
  const retired = await store.createTokenRankUser({ name: "南山客" });
  const data = persisted(storePath);
  data.users = data.users.map((candidate) => candidate.userId === retired.user.userId
    ? { ...candidate, active: false, retiredAt: new Date().toISOString() }
    : candidate);
  fs.writeFileSync(storePath, JSON.stringify(data));

  const replacement = await store.createTokenRankUser({ name: " 南山客 " });
  assert.notEqual(replacement.user.userId, retired.user.userId);
  assert.equal(replacement.user.name, "南山客");
  const users = persisted(storePath).users;
  assert.equal(users.filter((candidate) => candidate.name === "南山客" && candidate.active !== false).length, 1);
});

test("leaderboard aggregate covers every member and keeps total separate from norm", async (t) => {
  const { store } = await setupStore(t);
  const today = beijingDate();

  for (let index = 0; index < 21; index += 1) {
    const { token } = await store.createTokenRankUser({ name: `rank-${index}` });
    const result = await store.appendTokenRankUsage(token, {
      deviceId: DEVICE_A,
      clientVersion: "0.1.0",
      records: [legacyRecord({
        date: today,
        tool: "claude-code",
        model: `model-${index}`,
      })],
    });
    assert.equal(result.ok, true);
  }

  const board = await store.getTokenRankLeaderboard({
    board: "claude-code",
    range: "today",
    metric: "norm",
  });
  const visibleTotal = board.entries.reduce((sum, entry) => sum + entry.score, 0);
  const visibleNorm = board.entries.reduce((sum, entry) => sum + entry.norm, 0);

  assert.equal(board.entries.length, 20);
  assert.equal(board.totalMembers, 21);
  assert.equal(board.aggregate.total, 21 * 170);
  assert.equal(board.aggregate.norm, 21 * 110);
  assert.equal(visibleTotal, 20 * 170);
  assert.equal(visibleNorm, 20 * 110);
  assert.ok(board.aggregate.total > visibleTotal);
  assert.ok(board.aggregate.norm > visibleNorm);
  assert.notEqual(board.aggregate.total, board.aggregate.norm);
});

test("public profiles expose active legacy identities with complete sanitized aggregates", async (t) => {
  const { store, storePath } = await setupStore(t);
  const { token, user } = await store.createTokenRankUser({ name: "public-profile", role: "测试角色" });
  const today = beijingDate();
  const earlier = addDays(today, -2);

  await store.appendTokenRankUsage(token, {
    deviceId: DEVICE_A,
    clientVersion: "0.1.0",
    records: [
      legacyRecord({ date: today, tool: "codex", model: "today-codex" }),
      legacyRecord({ date: earlier, tool: "claude-code", model: "earlier-claude" }),
    ],
  });
  await store.appendTokenRankUsage(token, {
    deviceId: DEVICE_B,
    clientVersion: "0.1.0",
    records: [legacyRecord({ date: earlier, tool: "cursor", model: "earlier-cursor" })],
  });

  const data = persisted(storePath);
  data.users = data.users.map((candidate) => candidate.userId === user.userId
    ? { ...candidate, public: false }
    : candidate);
  data.collectors.push({
    userId: user.userId,
    tokenHash: user.tokenHash,
    deviceId: DEVICE_A,
    tool: "codex",
    protocolVersion: 2,
    clientVersion: "0.2.0",
    observedThrough: "2030-01-01T00:00:00.000Z",
    lastSync: "2030-01-01T00:00:00.000Z",
  });
  fs.writeFileSync(storePath, JSON.stringify(data));

  const profile = await store.getTokenRankPublicProfile(user.userId);
  assert.ok(profile, "legacy public:false must not hide an active profile");
  assert.deepEqual(profile.user, {
    userId: user.userId,
    name: "public-profile",
    role: "测试角色",
  });
  assert.deepEqual(profile.totals, {
    total: 450,
    norm: 270,
    cost: 0.00027,
    activeDays: 2,
    deviceCount: 2,
    lastSync: "2030-01-01T00:00:00.000Z",
  });
  assert.deepEqual(profile.todayTotals, {
    total: 110,
    norm: 50,
    cost: 0.000066,
    activeDays: 1,
    deviceCount: 1,
    lastSync: "2030-01-01T00:00:00.000Z",
  });
  assert.deepEqual(profile.byTool, {
    codex: 110,
    "claude-code": 170,
    cursor: 170,
  });
  assert.deepEqual(profile.byModel, {
    "today-codex": 110,
    "earlier-claude": 170,
    "earlier-cursor": 170,
  });
  assert.deepEqual(profile.daily, [
    { date: earlier, total: 340, norm: 220, cost: 0.000204 },
    { date: today, total: 110, norm: 50, cost: 0.000066 },
  ]);

  const serialized = JSON.stringify(profile);
  assert.equal(serialized.includes(token), false);
  assert.equal(serialized.includes(user.tokenHash), false);
  assert.equal(serialized.includes(user.createdAt), false);
  assert.equal(serialized.includes(DEVICE_A), false);
  assert.equal(serialized.includes("0.1.0"), false);
  assert.equal(serialized.includes("collector"), false);
  assert.equal(Object.hasOwn(persisted(storePath).users[0], "public"), true);
});

test("public profiles reject invalid, missing, and retired identities", async (t) => {
  const { store, storePath } = await setupStore(t);
  const { user } = await store.createTokenRankUser({ name: "retired-public-profile" });

  assert.equal(await store.getTokenRankPublicProfile(0), null);
  assert.equal(await store.getTokenRankPublicProfile(-1), null);
  assert.equal(await store.getTokenRankPublicProfile(Number.MAX_SAFE_INTEGER + 1), null);
  assert.equal(await store.getTokenRankPublicProfile(user.userId + 1), null);

  const data = persisted(storePath);
  data.users = data.users.map((candidate) => candidate.userId === user.userId
    ? { ...candidate, active: false, retiredAt: new Date().toISOString() }
    : candidate);
  fs.writeFileSync(storePath, JSON.stringify(data));
  assert.equal(await store.getTokenRankPublicProfile(user.userId), null);
});

test("new Token Rank identities do not persist the retired public visibility flag", async (t) => {
  const { store, storePath } = await setupStore(t);
  const { user } = await store.createTokenRankUser({ name: "no-public-flag" });
  const stored = persisted(storePath).users.find((candidate) => candidate.userId === user.userId);
  assert.equal(Object.hasOwn(stored, "public"), false);
});
