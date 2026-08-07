import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingRoot: process.cwd(),
  // Releases are immutable in production, so image responses cannot use
  // Next.js' writable on-disk optimization cache.
  images: {
    // The protected digest-image route already serves bounded image bytes;
    // runtime optimization would require a writable release cache.
    unoptimized: true,
    maximumDiskCacheSize: 0,
  },
};

export default nextConfig;
