import { NextRequest, NextResponse } from "next/server";
import { getTokenRankLeaderboard } from "@/lib/tokenRankStore";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const metric = params.get("metric");

  return NextResponse.json(
    await getTokenRankLeaderboard({
      board: params.get("board") ?? "total",
      range: params.get("range") ?? "today",
      metric: metric === "norm" || metric === "cost" ? metric : "total",
    }),
  );
}
