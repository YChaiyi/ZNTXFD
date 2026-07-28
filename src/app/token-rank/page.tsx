import type { Metadata } from "next";
import { TokenRankClient } from "./TokenRankClient";
import { getTokenRankData } from "@/lib/data";
import { getTokenRankLeaderboard } from "@/lib/tokenRankStore";

export const metadata: Metadata = {
  title: "Token 消耗榜 | 智能体先锋队",
  description: "智能体先锋队社群 AI 编程工具 Token 消耗排行榜",
};

export const dynamic = "force-dynamic";

export default async function TokenRankPage() {
  const baseData = getTokenRankData();
  const leaderboard = await getTokenRankLeaderboard({
    board: "total",
    range: "today",
    metric: "total",
  });

  return (
    <TokenRankClient
      data={{
        ...baseData,
        entries: leaderboard.entries,
        totalMembers: leaderboard.totalMembers,
        updatedAt: leaderboard.updatedAt,
        aggregate: leaderboard.aggregate,
      }}
    />
  );
}
