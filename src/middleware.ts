import { NextRequest, NextResponse } from "next/server";
import { getContentStatus } from "@/lib/data";

const CONTENT_INDEPENDENT_EXACT = new Set([
  "/login",
  "/api/health",
  "/api/token-rank/upload",
  "/token-rank/install.sh",
  "/token-rank/install.ps1",
  "/token-rank/client.mjs",
  "/favicon.ico",
]);

function requiresContent(pathname: string) {
  return (
    !CONTENT_INDEPENDENT_EXACT.has(pathname) &&
    !pathname.startsWith("/_next/") &&
    pathname !== "/stats" &&
    !pathname.startsWith("/stats/") &&
    !pathname.startsWith("/token-rank") &&
    !pathname.startsWith("/api/token-rank/")
  );
}

function isApiRequest(pathname: string) {
  return pathname.startsWith("/api/");
}

function unavailableResponse(pathname: string, message: string) {
  if (isApiRequest(pathname)) {
    return NextResponse.json({ status: 503, message }, { status: 503 });
  }
  return new NextResponse("Service unavailable", {
    status: 503,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (requiresContent(pathname)) {
    const content = getContentStatus();
    if (!content.ready) {
      return unavailableResponse(pathname, "生产内容暂不可用");
    }
  }
  return NextResponse.next();
}

export const runtime = "nodejs";

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
