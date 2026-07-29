const DEFAULT_TOKEN_RANK_PUBLIC_ORIGIN = "https://znt.group";
const ALLOWED_PUBLIC_HOSTS = new Set(["znt.group", "www.znt.group"]);
const LEGACY_LOCAL_ORIGIN = /https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]):3017(?=$|[\/"'\s])/g;

export function normalizeTokenRankPublicOrigin(value: string | undefined) {
  const candidate = value?.trim();
  if (!candidate) return DEFAULT_TOKEN_RANK_PUBLIC_ORIGIN;

  try {
    const origin = new URL(candidate);
    if (
      origin.protocol !== "https:"
      || origin.username
      || origin.password
      || origin.port
      || !ALLOWED_PUBLIC_HOSTS.has(origin.hostname)
    ) {
      return DEFAULT_TOKEN_RANK_PUBLIC_ORIGIN;
    }
    return origin.origin;
  } catch {
    return DEFAULT_TOKEN_RANK_PUBLIC_ORIGIN;
  }
}

export function getTokenRankPublicOrigin() {
  return normalizeTokenRankPublicOrigin(process.env.ZNT_PUBLIC_SITE_URL);
}

export function replaceLegacyTokenRankOrigin(value: string, publicOrigin = getTokenRankPublicOrigin()) {
  return value.replace(LEGACY_LOCAL_ORIGIN, normalizeTokenRankPublicOrigin(publicOrigin));
}

export function createTokenRankInstallCommands(token: string, publicOrigin = getTokenRankPublicOrigin()) {
  const origin = normalizeTokenRankPublicOrigin(publicOrigin);
  const endpoint = `${origin}/api/token-rank/upload`;
  const installMac = `curl -fsSL ${origin}/token-rank/install.sh | bash -s -- --token ${token} --endpoint ${endpoint}`;
  const installWin = `powershell -ExecutionPolicy Bypass -Command "iwr ${origin}/token-rank/install.ps1 -UseB | iex; znt-tokenrank connect -Token ${token} -Endpoint ${endpoint}"`;
  const agentPrompt = `请帮我在这台电脑上接入「智能体先锋队 Token 消耗榜」。请执行官方安装命令：${installMac} 。它只上报 token 数量、工具、模型和日期，不上传代码、对话正文或 API Key。执行后请运行一次同步检查，并在汇报时把 znt_trk_ 开头的个人令牌打码。`;

  return { installMac, installWin, agentPrompt };
}
