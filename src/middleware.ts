import { NextRequest, NextResponse } from "next/server";
import {
  ACCESS_COOKIE_NAME,
  isAccessConfigured,
  verifyAccessSession,
} from "@/lib/accessAuth";
import { getContentStatus } from "@/lib/data";
import { safeNextPath } from "@/lib/safeNextPath";

const PUBLIC_EXACT = new Set([
  "/login",
  "/api/auth/verify",
  "/api/token-rank/upload",
  "/token-rank/install.sh",
  "/token-rank/install.ps1",
  "/token-rank/client.mjs",
  "/favicon.ico",
]);

function isPublicPath(pathname: string) {
  return (
    PUBLIC_EXACT.has(pathname) ||
    pathname.startsWith("/_next/") ||
    pathname === "/stats" ||
    pathname.startsWith("/stats/")
  );
}

function isApiRequest(pathname: string) {
  return pathname.startsWith("/api/");
}

function requiresContent(pathname: string) {
  return !pathname.startsWith("/token-rank") && !pathname.startsWith("/api/token-rank/");
}

function healthAllowed(request: NextRequest) {
  if (request.nextUrl.pathname !== "/api/health") return false;
  return request.headers.get("x-znt-local-health") === "1";
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
  const { pathname, search } = request.nextUrl;
  if (isPublicPath(pathname) || healthAllowed(request)) return NextResponse.next();

  if (!isAccessConfigured()) {
    return unavailableResponse(pathname, "访问控制未配置");
  }

  if (requiresContent(pathname)) {
    const content = getContentStatus();
    if (!content.ready) {
      return unavailableResponse(pathname, "生产内容暂不可用");
    }
  }

  const session = request.cookies.get(ACCESS_COOKIE_NAME)?.value;
  if (await verifyAccessSession(session)) return NextResponse.next();

  if (isApiRequest(pathname)) {
    return NextResponse.json({ status: 401, message: "需要网站访问密码" }, { status: 401 });
  }

  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.search = "";
  loginUrl.searchParams.set("next", safeNextPath(`${pathname}${search}`));
  return NextResponse.redirect(loginUrl);
}

export const runtime = "nodejs";

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
