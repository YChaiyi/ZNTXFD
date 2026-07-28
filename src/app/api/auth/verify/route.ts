import { NextRequest, NextResponse } from "next/server";
import {
  ACCESS_COOKIE_MAX_AGE,
  ACCESS_COOKIE_NAME,
  createAccessSession,
  getAccessConfigurationError,
  isPasswordValid,
} from "@/lib/accessAuth";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const configurationError = getAccessConfigurationError();
  if (configurationError) {
    return NextResponse.json(
      { success: false, message: "访问控制未完整配置" },
      { status: 500 },
    );
  }

  const body = (await request.json().catch(() => null)) as {
    password?: unknown;
  } | null;
  const password = typeof body?.password === "string" ? body.password : "";

  if (!isPasswordValid(password)) {
    return NextResponse.json(
      { success: false, message: "密码错误" },
      { status: 401 },
    );
  }

  const response = NextResponse.json({ success: true });

  response.cookies.set(ACCESS_COOKIE_NAME, await createAccessSession(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: ACCESS_COOKIE_MAX_AGE,
    path: "/",
  });

  return response;
}
