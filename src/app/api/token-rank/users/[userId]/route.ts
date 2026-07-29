import { NextResponse } from "next/server";
import { getTokenRankPublicProfile } from "@/lib/tokenRankStore";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    userId: string;
  }>;
};

function parseUserId(value: string) {
  if (!/^[1-9]\d*$/.test(value)) return null;
  const userId = Number(value);
  return Number.isSafeInteger(userId) && userId > 0 ? userId : null;
}

export async function GET(_request: Request, { params }: RouteContext) {
  const { userId: rawUserId } = await params;
  const userId = parseUserId(rawUserId);
  if (userId === null) return new NextResponse(null, { status: 404 });

  const profile = await getTokenRankPublicProfile(userId);
  if (!profile) return new NextResponse(null, { status: 404 });

  return NextResponse.json({ status: 0, profile });
}
