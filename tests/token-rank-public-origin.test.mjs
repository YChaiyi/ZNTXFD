import assert from "node:assert/strict";
import test from "node:test";

const install = await import(`../src/lib/tokenRankInstall.ts?test=${Date.now()}`);

test("Token Rank installation commands always use the trusted public origin", () => {
  assert.equal(install.normalizeTokenRankPublicOrigin(undefined), "https://znt.group");
  assert.equal(install.normalizeTokenRankPublicOrigin("https://znt.group/daily"), "https://znt.group");
  assert.equal(install.normalizeTokenRankPublicOrigin("https://www.znt.group"), "https://www.znt.group");
  assert.equal(install.normalizeTokenRankPublicOrigin("https://localhost:3017"), "https://znt.group");
  assert.equal(install.normalizeTokenRankPublicOrigin("http://znt.group"), "https://znt.group");
  assert.equal(install.normalizeTokenRankPublicOrigin("https://example.com"), "https://znt.group");

  const commands = install.createTokenRankInstallCommands(
    "znt_trk_example_token",
    "https://localhost:3017",
  );
  assert.match(commands.installMac, /^curl -fsSL https:\/\/znt\.group\/token-rank\/install\.sh/);
  assert.match(commands.installMac, /--endpoint https:\/\/znt\.group\/api\/token-rank\/upload/);
  assert.match(commands.installWin, /https:\/\/znt\.group\/token-rank\/install\.ps1/);
  assert.doesNotMatch(`${commands.installMac}\n${commands.installWin}\n${commands.agentPrompt}`, /localhost:3017/);
});

test("cached local Token Rank commands migrate to the public origin", () => {
  const value = "https://localhost:3017/token-rank/install.sh http://127.0.0.1:3017/api/token-rank/upload https://[::1]:3017/token-rank/client.mjs";
  assert.equal(
    install.replaceLegacyTokenRankOrigin(value),
    "https://znt.group/token-rank/install.sh https://znt.group/api/token-rank/upload https://znt.group/token-rank/client.mjs",
  );
});
