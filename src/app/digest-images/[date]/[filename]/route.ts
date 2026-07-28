import fs from "fs";
import { NextResponse } from "next/server";
import {
  ContentUnavailableError,
  getDigestImageFilePath,
} from "@/lib/data";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    date: string;
    filename: string;
  }>;
};

function isValidDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

export async function GET(_request: Request, { params }: RouteContext) {
  const { date, filename } = await params;
  const match = /^(group[1-5])\.(avif|png)$/.exec(filename);
  if (!isValidDate(date) || !match) {
    return new NextResponse(null, { status: 404 });
  }

  try {
    const filePath = getDigestImageFilePath(date, filename);
    const handle = await fs.promises.open(filePath, "r");
    try {
      const stat = await handle.stat();
      if (!stat.isFile()) return new NextResponse(null, { status: 404 });

      const bytes = await handle.readFile();
      return new NextResponse(new Uint8Array(bytes), {
        headers: {
          "Cache-Control": "private, no-store",
          "Content-Length": String(stat.size),
          "Content-Type": match[2] === "avif" ? "image/avif" : "image/png",
          "X-Content-Type-Options": "nosniff",
        },
      });
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (error instanceof ContentUnavailableError) {
      return NextResponse.json({ error: "content_unavailable" }, { status: 503 });
    }
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      return new NextResponse(null, { status: 404 });
    }
    throw error;
  }
}
