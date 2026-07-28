import { NextRequest, NextResponse } from "next/server";
import { findTokenRankUser, TOKEN_RANK_COOKIE } from "@/lib/tokenRankStore";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as { token?: unknown } | null;
  const token = typeof body?.token === "string" ? body.token.trim() : "";
  const user = await findTokenRankUser(token);

  if (!user) {
    return NextResponse.json(
      { status: 401, message: "令牌无效，请检查 znt_trk_ 开头的专属令牌" },
      { status: 401 },
    );
  }

  const response = NextResponse.json({ status: 0, user });
  response.cookies.set(TOKEN_RANK_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 365,
    path: "/",
  });

  return response;
}
