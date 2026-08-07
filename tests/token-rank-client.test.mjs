import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  aggregateCodexFiles,
  codexCollectionComplete,
  codexHistoryWindow,
  parseCodexFile,
  selectCodexBackfillRecords,
} from "../public/token-rank/client.mjs";

function writeRollout(dir, id, values, fillerBytes = 0) {
  const file = path.join(dir, `rollout-2026-07-22T00-00-00-${id}.jsonl`);
  const lines = [];
  if (fillerBytes > 0) lines.push(JSON.stringify({ ignored: "x".repeat(fillerBytes) }));
  lines.push(...values.map((value) => JSON.stringify(value)));
  fs.writeFileSync(file, `${lines.join("\n")}\n`);
  const stat = fs.statSync(file);
  return { file, mtimeMs: stat.mtimeMs, size: stat.size };
}

function sessionMeta(id, timestamp, parentId = "") {
  return {
    timestamp,
    type: "session_meta",
    payload: {
      id,
      ...(parentId
        ? {
            forked_from_id: parentId,
            source: { subagent: { thread_spawn: { parent_thread_id: parentId } } },
          }
        : { source: "vscode" }),
    },
  };
}

function forkMeta(id, timestamp, parentId) {
  return {
    timestamp,
    type: "session_meta",
    payload: {
      id,
      forked_from_id: parentId,
      source: "vscode",
    },
  };
}

function guardianMeta(id, timestamp, parentId) {
  return {
    timestamp,
    type: "session_meta",
    payload: {
      id,
      parent_thread_id: parentId,
      thread_source: "subagent",
      source: { subagent: { other: "guardian" } },
    },
  };
}

function turnContext(timestamp, model = "gpt-5.6-sol", turnId = "") {
  return {
    timestamp,
    type: "turn_context",
    payload: { model, ...(turnId ? { turn_id: turnId } : {}) },
  };
}

function tokenCount(timestamp, input, cached, output, reasoning = 0) {
  return {
    timestamp,
    type: "event_msg",
    payload: {
      type: "token_count",
      info: {
        total_token_usage: {
          input_tokens: input,
          cached_input_tokens: cached,
          cache_write_input_tokens: 0,
          output_tokens: output,
          reasoning_output_tokens: reasoning,
          total_tokens: input + output,
        },
      },
    },
  };
}

function tokenCountWithLast(timestamp, total, last) {
  const value = tokenCount(
    timestamp,
    total.input,
    total.cached,
    total.output,
    total.reasoning || 0,
  );
  value.payload.info.last_token_usage = {
    input_tokens: last.input,
    cached_input_tokens: last.cached,
    cache_write_input_tokens: 0,
    output_tokens: last.output,
    reasoning_output_tokens: last.reasoning || 0,
    total_tokens: last.input + last.output,
  };
  return value;
}

function tokenCountWithLastOnly(timestamp, last) {
  const value = tokenCountWithLast(timestamp, last, last);
  delete value.payload.info.total_token_usage;
  return value;
}

function diagnostics(selectedFiles) {
  return {
    selectedFiles,
    parsedFiles: selectedFiles,
    cacheHits: 0,
    largeFiles: 0,
    replayEventsSkipped: 0,
    deferredFiles: 0,
    billableEvents: 0,
  };
}

test("Codex cumulative snapshots count deltas and split cached input once", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "znt-tokenrank-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const id = "00000000-0000-4000-8000-000000000001";
  const item = writeRollout(dir, id, [
    sessionMeta(id, "2026-07-22T00:00:00.000Z"),
    turnContext("2026-07-22T00:00:01.000Z"),
    tokenCount("2026-07-22T00:01:00.000Z", 100, 60, 10, 4),
    tokenCount("2026-07-22T00:01:01.000Z", 100, 60, 10, 4),
    tokenCount("2026-07-22T00:02:00.000Z", 160, 100, 15, 6),
  ]);

  const parsed = await parseCodexFile(item);
  const result = aggregateCodexFiles(
    [parsed],
    new Map([[id, parsed]]),
    "2026-07-22",
    "2026-07-22",
    diagnostics(1),
  );

  assert.equal(result.length, 1);
  assert.deepEqual(
    {
      input: result[0].inputTokens,
      output: result[0].outputTokens,
      cached: result[0].cacheReadTokens,
      total: result[0].totalTokens,
    },
    { input: 60, output: 15, cached: 100, total: 175 },
  );
});

test("Codex per-request usage survives interleaved cumulative counters without double counting", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "znt-tokenrank-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const id = "00000000-0000-4000-8000-000000000002";
  const second = tokenCountWithLast(
    "2026-07-22T00:02:00.000Z",
    { input: 80, cached: 40, output: 8 },
    { input: 20, cached: 10, output: 2 },
  );
  const sameUsageInAnotherModel = structuredClone(second);
  sameUsageInAnotherModel.timestamp = "2026-07-22T00:02:30.000Z";
  const item = writeRollout(dir, id, [
    sessionMeta(id, "2026-07-22T00:00:00.000Z"),
    turnContext("2026-07-22T00:00:01.000Z"),
    tokenCountWithLast(
      "2026-07-22T00:01:00.000Z",
      { input: 100, cached: 60, output: 10 },
      { input: 100, cached: 60, output: 10 },
    ),
    second,
    structuredClone(second),
    turnContext("2026-07-22T00:02:15.000Z", "gpt-5.6-terra"),
    sameUsageInAnotherModel,
    tokenCountWithLast(
      "2026-07-22T00:03:00.000Z",
      { input: 120, cached: 70, output: 12 },
      { input: 40, cached: 20, output: 4 },
    ),
  ]);

  const parsed = await parseCodexFile(item);
  const result = aggregateCodexFiles(
    [parsed],
    new Map([[id, parsed]]),
    "2026-07-22",
    "2026-07-22",
    diagnostics(1),
  );

  assert.equal(parsed.countersReset, false);
  assert.equal(parsed.events.length, 4, "only an identical event in the same model is deduplicated");
  assert.equal(result.reduce((sum, record) => sum + record.totalTokens, 0), 198);
});

test("Codex accepts complete per-request usage when cumulative counters are absent", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "znt-tokenrank-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const id = "00000000-0000-4000-8000-000000000003";
  const item = writeRollout(dir, id, [
    sessionMeta(id, "2026-07-22T00:00:00.000Z"),
    turnContext("2026-07-22T00:00:01.000Z"),
    tokenCountWithLastOnly(
      "2026-07-22T00:01:00.000Z",
      { input: 50, cached: 30, output: 5 },
    ),
  ]);

  const parsed = await parseCodexFile(item);
  const result = aggregateCodexFiles(
    [parsed],
    new Map([[id, parsed]]),
    "2026-07-22",
    "2026-07-22",
    diagnostics(1),
  );

  assert.equal(parsed.counterErrors, 0);
  assert.equal(parsed.unsupportedUsageEvents, 0);
  assert.equal(result.reduce((sum, record) => sum + record.totalTokens, 0), 55);
});

test("a repeated total-only signature cannot hide a cumulative counter reset", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "znt-tokenrank-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const id = "00000000-0000-4000-8000-000000000004";
  const parsed = await parseCodexFile(writeRollout(dir, id, [
    sessionMeta(id, "2026-07-22T00:00:00.000Z"),
    turnContext("2026-07-22T00:00:01.000Z"),
    tokenCount("2026-07-22T00:01:00.000Z", 100, 60, 10),
    tokenCount("2026-07-22T00:02:00.000Z", 200, 120, 20),
    tokenCount("2026-07-22T00:03:00.000Z", 100, 60, 10),
    tokenCount("2026-07-22T00:04:00.000Z", 210, 125, 21),
  ]));

  assert.equal(parsed.countersReset, true);
  assert.equal(parsed.cumulativeNonMonotonic, true);
  assert.ok(parsed.unsupportedUsageEvents > 0);
});

test("a cumulative-only event after interleaved totals is deferred instead of guessed", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "znt-tokenrank-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const id = "00000000-0000-4000-8000-000000000005";
  const parsed = await parseCodexFile(writeRollout(dir, id, [
    sessionMeta(id, "2026-07-22T00:00:00.000Z"),
    turnContext("2026-07-22T00:00:01.000Z"),
    tokenCountWithLast(
      "2026-07-22T00:01:00.000Z",
      { input: 100, cached: 60, output: 10 },
      { input: 100, cached: 60, output: 10 },
    ),
    tokenCountWithLast(
      "2026-07-22T00:02:00.000Z",
      { input: 50, cached: 30, output: 5 },
      { input: 10, cached: 5, output: 1 },
    ),
    tokenCount("2026-07-22T00:03:00.000Z", 120, 70, 12),
  ]));

  assert.equal(parsed.events.length, 2);
  assert.equal(parsed.countersReset, false);
  assert.equal(parsed.cumulativeNonMonotonic, true);
  assert.equal(parsed.unsupportedUsageEvents, 1);
});

test("spawned Codex rollouts exclude inherited history before the child boundary", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "znt-tokenrank-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const parentId = "00000000-0000-4000-8000-000000000011";
  const childId = "00000000-0000-4000-8000-000000000012";
  const parentValues = [
    sessionMeta(parentId, "2026-07-22T00:00:00.000Z"),
    turnContext("2026-07-22T00:00:01.000Z"),
    tokenCount("2026-07-22T00:01:00.000Z", 100, 60, 10),
    tokenCount("2026-07-22T00:02:00.000Z", 160, 100, 15),
  ];
  const parent = await parseCodexFile(writeRollout(dir, parentId, parentValues));
  const child = await parseCodexFile(writeRollout(dir, childId, [
    sessionMeta(childId, "2026-07-22T00:02:30.000Z", parentId),
    ...parentValues,
    { timestamp: "2026-07-22T00:02:31.000Z", type: "inter_agent_communication_metadata", payload: { trigger_turn: {} } },
    turnContext("2026-07-22T00:02:32.000Z", "gpt-5.6-terra"),
    tokenCount("2026-07-22T00:03:00.000Z", 210, 140, 20),
  ]));
  const diag = diagnostics(2);
  const result = aggregateCodexFiles(
    [parent, child],
    new Map([[parentId, parent], [childId, child]]),
    "2026-07-22",
    "2026-07-22",
    diag,
  );

  assert.equal(result.reduce((sum, record) => sum + record.totalTokens, 0), 230);
  assert.equal(result.reduce((sum, record) => sum + record.cacheReadTokens, 0), 140);
  assert.equal(diag.replayEventsSkipped, 2);
  assert.equal(diag.deferredFiles, 0);
});

test("Codex files larger than 8 MiB are streamed instead of dropped", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "znt-tokenrank-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const id = "00000000-0000-4000-8000-000000000021";
  const item = writeRollout(dir, id, [
    sessionMeta(id, "2026-07-22T00:00:00.000Z"),
    tokenCount("2026-07-22T00:01:00.000Z", 50, 20, 5),
  ], 8 * 1024 * 1024 + 1);

  assert.ok(item.size > 8 * 1024 * 1024);
  const parsed = await parseCodexFile(item);
  assert.equal(parsed.events.length, 1);
  assert.equal(parsed.events[0].totalTokens, 55);
});

test("Codex event dates use the UTC+8 day boundary", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "znt-tokenrank-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const id = "00000000-0000-4000-8000-000000000031";
  const parsed = await parseCodexFile(writeRollout(dir, id, [
    sessionMeta(id, "2026-07-21T15:59:00.000Z"),
    tokenCount("2026-07-21T15:59:59.999Z", 10, 0, 1),
    tokenCount("2026-07-21T16:00:00.000Z", 20, 0, 2),
  ]));

  assert.deepEqual(parsed.events.map((event) => event.date), ["2026-07-21", "2026-07-22"]);
  const result = aggregateCodexFiles(
    [parsed],
    new Map([[id, parsed]]),
    "2026-07-22",
    "2026-07-22",
    diagnostics(1),
  );
  assert.equal(result[0].totalTokens, 11, "the first event after midnight uses the prior snapshot as baseline");
});

test("ordinary forks count child work when the parent ended earlier", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "znt-tokenrank-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const parentId = "019f87b0-0000-7000-8000-000000000041";
  const childId = "019f87c4-0b80-7000-8000-000000000042";
  const parentValues = [
    sessionMeta(parentId, "2026-07-22T00:00:00.000Z"),
    tokenCount("2026-07-22T00:01:00.000Z", 100, 60, 10),
    tokenCount("2026-07-22T00:02:00.000Z", 160, 100, 15),
    tokenCount("2026-07-22T00:02:01.000Z", 160, 100, 15),
  ];
  const parent = await parseCodexFile(writeRollout(dir, parentId, parentValues));
  const child = await parseCodexFile(writeRollout(dir, childId, [
    forkMeta(childId, "2026-07-22T03:00:00.000Z", parentId),
    ...parentValues,
    turnContext("2026-07-22T03:00:01.000Z", "gpt-5.6-sol", childId),
    tokenCount("2026-07-22T03:01:00.000Z", 210, 140, 20),
  ]));
  const diag = diagnostics(2);
  const result = aggregateCodexFiles(
    [parent, child],
    new Map([[parentId, parent], [childId, child]]),
    "2026-07-22",
    "2026-07-22",
    diag,
  );

  assert.equal(parent.maxTimestampMs < child.rootTimestampMs, true);
  assert.equal(result.reduce((sum, record) => sum + record.totalTokens, 0), 230);
  assert.equal(diag.deferredFiles, 0);
  assert.equal(diag.replayEventsSkipped, 3, "the repeated zero-delta snapshot remains in the replay prefix");
});

test("ordinary forks defer when no current UUIDv7 turn boundary is present", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "znt-tokenrank-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const parentId = "019f87b0-0000-7000-8000-000000000051";
  const childId = "019f87c4-0b80-7000-8000-000000000052";
  const first = tokenCount("2026-07-22T00:01:00.000Z", 100, 60, 10);
  const parent = await parseCodexFile(writeRollout(dir, parentId, [
    sessionMeta(parentId, "2026-07-22T00:00:00.000Z"),
    first,
    tokenCount("2026-07-22T00:02:00.000Z", 160, 100, 15),
  ]));
  const child = await parseCodexFile(writeRollout(dir, childId, [
    forkMeta(childId, "2026-07-22T03:00:00.000Z", parentId),
    first,
    tokenCount("2026-07-22T03:01:00.000Z", 210, 140, 20),
  ]));
  const diag = diagnostics(2);
  const result = aggregateCodexFiles(
    [parent, child],
    new Map([[parentId, parent], [childId, child]]),
    "2026-07-22",
    "2026-07-22",
    diag,
  );

  assert.equal(result.reduce((sum, record) => sum + record.totalTokens, 0), 175);
  assert.equal(diag.deferredFiles, 1);
  assert.equal(codexCollectionComplete(diag), false);
});

test("Codex rebuild window is exactly 35 Beijing calendar days", () => {
  assert.deepEqual(
    codexHistoryWindow(Date.parse("2026-07-22T07:30:00.000Z")),
    { startDate: "2026-06-18", endDate: "2026-07-22", tools: ["codex"] },
  );
});

test("historical backfill selection refreshes its Beijing window at upload time", () => {
  const beforeMidnight = Date.parse("2026-08-07T15:59:59.000Z");
  const afterMidnight = Date.parse("2026-08-07T16:00:01.000Z");
  const records = [
    "2026-07-04",
    "2026-07-05",
    "2026-08-06",
    "2026-08-07",
    "2026-08-08",
  ].flatMap((date) => [
    { date, tool: "codex", model: "gpt-5.6-sol" },
    { date, tool: "cursor", model: "cursor" },
  ]);

  assert.deepEqual(
    selectCodexBackfillRecords(records, beforeMidnight).map((record) => record.date),
    ["2026-07-04", "2026-07-05", "2026-08-06"],
  );
  assert.deepEqual(
    selectCodexBackfillRecords(records, afterMidnight).map((record) => record.date),
    ["2026-07-05", "2026-08-06", "2026-08-07"],
  );
});

test("guardian subagents use direct parent metadata and ignore a false trigger boundary", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "znt-tokenrank-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const parentId = "019f87b0-0000-7000-8000-000000000061";
  const childId = "019f87c4-0b80-7000-8000-000000000062";
  const parentValues = [
    sessionMeta(parentId, "2026-07-22T00:00:00.000Z"),
    tokenCount("2026-07-22T00:01:00.000Z", 100, 60, 10),
    tokenCount("2026-07-22T00:02:00.000Z", 160, 100, 15),
  ];
  const parent = await parseCodexFile(writeRollout(dir, parentId, parentValues));
  const child = await parseCodexFile(writeRollout(dir, childId, [
    guardianMeta(childId, "2026-07-22T03:00:00.000Z", parentId),
    { timestamp: "2026-07-22T03:00:00.100Z", type: "inter_agent_communication_metadata", payload: { trigger_turn: false } },
    ...parentValues,
    turnContext("2026-07-22T03:00:01.000Z", "gpt-5.6-sol", childId),
    tokenCount("2026-07-22T03:01:00.000Z", 210, 140, 20),
  ]));
  const diag = diagnostics(2);
  const result = aggregateCodexFiles(
    [parent, child],
    new Map([[parentId, parent], [childId, child]]),
    "2026-07-22",
    "2026-07-22",
    diag,
  );

  assert.equal(child.parentId, parentId);
  assert.equal(child.spawnedSubagent, true);
  assert.equal(child.replayEventsSkipped, 2);
  assert.equal(result.reduce((sum, record) => sum + record.totalTokens, 0), 230);
});

test("a boundaryless fork is proven empty only when its terminal counters equal the parent", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "znt-tokenrank-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const parentId = "019f87b0-0000-7000-8000-000000000071";
  const childId = "019f87c4-0b80-7000-8000-000000000072";
  const parentValues = [
    sessionMeta(parentId, "2026-07-22T00:00:00.000Z"),
    tokenCount("2026-07-22T00:01:00.000Z", 100, 60, 10),
    tokenCount("2026-07-22T00:02:00.000Z", 160, 100, 15),
  ];
  const parent = await parseCodexFile(writeRollout(dir, parentId, parentValues));
  const child = await parseCodexFile(writeRollout(dir, childId, [
    guardianMeta(childId, "2026-07-22T03:00:00.000Z", parentId),
    ...parentValues,
  ]));
  const diag = diagnostics(2);
  const result = aggregateCodexFiles(
    [parent, child],
    new Map([[parentId, parent], [childId, child]]),
    "2026-07-22",
    "2026-07-22",
    diag,
  );

  assert.equal(result.reduce((sum, record) => sum + record.totalTokens, 0), 175);
  assert.equal(diag.deferredFiles, 0);
  assert.equal(diag.replayEventsSkipped, 2);
});

test("a non-monotonic boundaryless fork cannot masquerade as an empty replay", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "znt-tokenrank-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const parentId = "019f87b0-0000-7000-8000-000000000073";
  const childId = "019f87c4-0b80-7000-8000-000000000074";
  const parentUsage = tokenCountWithLast(
    "2026-07-22T00:01:00.000Z",
    { input: 100, cached: 60, output: 10 },
    { input: 100, cached: 60, output: 10 },
  );
  const parent = await parseCodexFile(writeRollout(dir, parentId, [
    sessionMeta(parentId, "2026-07-22T00:00:00.000Z"),
    parentUsage,
  ]));
  const child = await parseCodexFile(writeRollout(dir, childId, [
    guardianMeta(childId, "2026-07-22T01:00:00.000Z", parentId),
    parentUsage,
    tokenCountWithLast(
      "2026-07-22T01:01:00.000Z",
      { input: 50, cached: 30, output: 5 },
      { input: 10, cached: 5, output: 1 },
    ),
    tokenCountWithLast(
      "2026-07-22T01:02:00.000Z",
      { input: 100, cached: 60, output: 10 },
      { input: 50, cached: 30, output: 5 },
    ),
  ]));
  const diag = diagnostics(2);
  const result = aggregateCodexFiles(
    [parent, child],
    new Map([[parentId, parent], [childId, child]]),
    "2026-07-22",
    "2026-07-22",
    diag,
  );

  assert.equal(child.countersReset, false, "last usage keeps the child events countable");
  assert.equal(child.cumulativeNonMonotonic, true);
  assert.equal(child.forkBoundaryMissing, true);
  assert.equal(diag.deferredFiles, 1);
  assert.equal(result.reduce((sum, record) => sum + record.totalTokens, 0), 110);
});

test("an identical usage signature is counted again after an explicit child boundary", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "znt-tokenrank-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const parentId = "019f87b0-0000-7000-8000-000000000075";
  const childId = "019f87c4-0b80-7000-8000-000000000076";
  const usage = tokenCountWithLast(
    "2026-07-22T00:01:00.000Z",
    { input: 20, cached: 10, output: 2 },
    { input: 20, cached: 10, output: 2 },
  );
  const repeatedAfterBoundary = structuredClone(usage);
  repeatedAfterBoundary.timestamp = "2026-07-22T01:01:00.000Z";
  const parent = await parseCodexFile(writeRollout(dir, parentId, [
    sessionMeta(parentId, "2026-07-22T00:00:00.000Z"),
    usage,
  ]));
  const child = await parseCodexFile(writeRollout(dir, childId, [
    sessionMeta(childId, "2026-07-22T01:00:00.000Z", parentId),
    usage,
    {
      timestamp: "2026-07-22T01:00:30.000Z",
      type: "inter_agent_communication_metadata",
      payload: { trigger_turn: {} },
    },
    repeatedAfterBoundary,
  ]));
  const result = aggregateCodexFiles(
    [parent, child],
    new Map([[parentId, parent], [childId, child]]),
    "2026-07-22",
    "2026-07-22",
    diagnostics(2),
  );

  assert.equal(child.replayEventsSkipped, 1);
  assert.equal(child.events.length, 1);
  assert.equal(result.reduce((sum, record) => sum + record.totalTokens, 0), 44);
});

test("missing required cumulative counters make an authoritative scan incomplete", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "znt-tokenrank-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const id = "019f87c4-0b80-7000-8000-000000000081";
  const broken = tokenCount("2026-07-22T03:01:00.000Z", 100, 60, 10);
  delete broken.payload.info.total_token_usage.input_tokens;
  const parsed = await parseCodexFile(writeRollout(dir, id, [
    sessionMeta(id, "2026-07-22T03:00:00.000Z"),
    broken,
  ]));

  assert.equal(parsed.counterErrors, 1);
  assert.equal(codexCollectionComplete({
    deferredFiles: 0,
    scanErrors: 0,
    parseErrors: 0,
    counterErrors: parsed.counterErrors,
    timestampErrors: 0,
    unsupportedUsageEvents: 0,
    counterResets: 0,
  }), false);
});
