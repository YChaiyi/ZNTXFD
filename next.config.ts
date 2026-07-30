import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingRoot: process.cwd(),
  // Releases are immutable in production. Keep image optimization available
  // without asking Next.js to create .next/cache/images inside a release.
  images: {
    maximumDiskCacheSize: 0,
  },
};

export default nextConfig;
