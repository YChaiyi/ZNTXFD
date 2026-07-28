import { NextRequest, NextResponse } from "next/server";
import { createTokenRankUser, TOKEN_RANK_COOKIE } from "@/lib/tokenRankStore";

export const runtime = "nodejs";

function commandSet(origin: string, token: string) {
  const endpoint = `${origin}/api/token-rank/upload`;
  const installMac = `curl -fsSL ${origin}/token-rank/install.sh | bash -s -- --token ${token} --endpoint ${endpoint}`;
  const installWin = `powershell -ExecutionPolicy Bypass -Command "iwr ${origin}/token-rank/install.ps1 -UseB | iex; znt-tokenrank connect -Token ${token} -Endpoint ${endpoint}"`;
  const agentPrompt = `请帮我在这台电脑上接入「智能体先锋队 Token 消耗榜」。请执行官方安装命令：${installMac} 。它只上报 token 数量、工具、模型和日期，不上传代码、对话正文或 API Key。执行后请运行一次同步检查，并在汇报时把 znt_trk_ 开头的个人令牌打码。`;

  return { installMac, installWin, agentPrompt };
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as {
    name?: unknown;
    role?: unknown;
  } | null;
  const name = typeof body?.name === "string" ? body.name : "";
  const role = typeof body?.role === "string" ? body.role : "";

  const { user, token } = await createTokenRankUser({ name, role });

  const response = NextResponse.json({
    status: 0,
    user,
    token,
    ...commandSet(request.nextUrl.origin, token),
  });

  response.cookies.set(TOKEN_RANK_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 365,
    path: "/",
  });

  return response;
}
