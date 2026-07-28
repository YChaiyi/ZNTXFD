import { NextRequest, NextResponse } from "next/server";
import { extractBearerToken, getTokenRankMe, TOKEN_RANK_COOKIE } from "@/lib/tokenRankStore";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const token =
    extractBearerToken(request.headers) ||
    request.cookies.get(TOKEN_RANK_COOKIE)?.value ||
    request.nextUrl.searchParams.get("token") ||
    "";
  const me = await getTokenRankMe(token);

  if (!me) {
    return NextResponse.json(
      { status: 401, message: "未找到你的上榜身份，请先生成专属命令" },
      { status: 401 },
    );
  }

  return NextResponse.json({ status: 0, ...me });
}
