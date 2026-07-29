import { NextRequest, NextResponse } from "next/server";
import { createTokenRankInstallCommands } from "@/lib/tokenRankInstall";
import {
  createTokenRankUser,
  TokenRankRegistrationError,
  TOKEN_RANK_COOKIE,
} from "@/lib/tokenRankStore";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as {
    name?: unknown;
    role?: unknown;
  } | null;
  const name = typeof body?.name === "string" ? body.name : "";
  const role = typeof body?.role === "string" ? body.role : "";

  try {
    const { user, token } = await createTokenRankUser({ name, role });

    const response = NextResponse.json({
      status: 0,
      user,
      token,
      ...createTokenRankInstallCommands(token),
    });

    response.cookies.set(TOKEN_RANK_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60 * 24 * 365,
      path: "/",
    });

    return response;
  } catch (error) {
    if (error instanceof TokenRankRegistrationError) {
      return NextResponse.json(
        { status: error.status, code: error.code, message: error.message },
        { status: error.status },
      );
    }
    throw error;
  }
}
