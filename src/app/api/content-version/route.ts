import { NextResponse } from "next/server";
import { getContentStatus } from "@/lib/data";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET() {
  const content = getContentStatus();
  return NextResponse.json(
    {
      ready: content.ready,
      contentVersion: content.contentVersion,
      schemaVersion: content.schemaVersion,
    },
    { status: content.ready ? 200 : 503 },
  );
}
