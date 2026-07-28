import { NextRequest, NextResponse } from "next/server";
import { appendTokenRankUsage, extractBearerToken } from "@/lib/tokenRankStore";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const token = extractBearerToken(request.headers);
  const body = (await request.json().catch(() => null)) ?? {};
  const result = await appendTokenRankUsage(token, body);

  if (!result.ok) {
    return NextResponse.json(
      { status: result.status, message: result.message },
      { status: result.status },
    );
  }

  return NextResponse.json({
    status: 0,
    accepted: result.accepted,
    replaced: result.replaced,
    idempotent: result.idempotent ?? false,
    receivedAt: new Date().toISOString(),
  });
}
