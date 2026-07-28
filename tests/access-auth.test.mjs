import assert from "node:assert/strict";
import test from "node:test";

process.env.ACCESS_PASSWORD = "fixed-test-password";
process.env.ACCESS_SESSION_SECRET = "test-session-secret-that-is-long-enough-for-hmac";
const auth = await import(`../src/lib/accessAuth.ts?test=${Date.now()}`);
const navigation = await import(`../src/lib/safeNextPath.ts?test=${Date.now()}`);

test("access sessions are signed, expire, and reject tampering", async () => {
  const now = Date.parse("2026-07-28T00:00:00Z");
  const session = await auth.createAccessSession(now);
  assert.equal(await auth.verifyAccessSession(session, now + 1_000), true);
  assert.equal(await auth.verifyAccessSession(`${session.slice(0, -1)}x`, now + 1_000), false);
  assert.equal(await auth.verifyAccessSession(session, now + auth.ACCESS_COOKIE_MAX_AGE * 1_000 + 1), false);
  process.env.ACCESS_PASSWORD = "rotated-test-password";
  assert.equal(await auth.verifyAccessSession(session, now + 1_000), false);
  process.env.ACCESS_PASSWORD = "fixed-test-password";
});

test("password comparison and return path validation keep their contracts", () => {
  assert.equal(auth.isPasswordValid("fixed-test-password"), true);
  assert.equal(auth.isPasswordValid("wrong"), false);
  assert.equal(navigation.safeNextPath("/daily/2026-07-28?tab=1"), "/daily/2026-07-28?tab=1");
  assert.equal(navigation.safeNextPath("//evil.example"), "/");
  assert.equal(navigation.safeNextPath("/\\evil.example"), "/");
  assert.equal(navigation.safeNextPath("https://evil.example"), "/");
});

test("access readiness rejects a short session secret", async () => {
  const originalSecret = process.env.ACCESS_SESSION_SECRET;
  process.env.ACCESS_SESSION_SECRET = "too-short";
  try {
    assert.equal(auth.isAccessConfigured(), false);
    assert.match(auth.getAccessConfigurationError(), /at least 32 characters/);
    await assert.rejects(auth.createAccessSession(), /at least 32 characters/);
  } finally {
    process.env.ACCESS_SESSION_SECRET = originalSecret;
  }
});
