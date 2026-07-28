import { NextRequest, NextResponse } from "next/server";
import { getContentStatus } from "@/lib/data";
import { isAccessConfigured } from "@/lib/accessAuth";
import { isTokenRankStoreConfigured } from "@/lib/tokenRankStore";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function isLocal(request: NextRequest) {
  return request.headers.get("x-znt-local-health") === "1";
}

export async function GET(request: NextRequest) {
  if (!isLocal(request)) return new NextResponse(null, { status: 404 });
  const content = getContentStatus();
  const tokenRankStoreReady = isTokenRankStoreConfigured();
  const ready = content.ready && isAccessConfigured() && tokenRankStoreReady;
  return NextResponse.json(
    {
      ready,
      buildSha: process.env.BUILD_SHA ?? "unknown",
      contentVersion: content.contentVersion,
      contentSchemaVersion: content.schemaVersion,
      tokenRankStoreReady,
    },
    { status: ready ? 200 : 503 },
  );
}
