import { NextRequest, NextResponse } from "next/server";
import { getTokenRankLeaderboard, normalizeTokenRankRange } from "@/lib/tokenRankStore";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const metric = params.get("metric");
  const requestedRange = params.get("range") ?? "today";
  const range = normalizeTokenRankRange(requestedRange);

  if (!range) {
    return NextResponse.json(
      { status: 400, message: `不支持的榜单时间范围：${requestedRange}` },
      { status: 400 },
    );
  }

  return NextResponse.json(
    await getTokenRankLeaderboard({
      board: params.get("board") ?? "total",
      range,
      metric: metric === "norm" || metric === "cost" ? metric : "total",
    }),
  );
}
