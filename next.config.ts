
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "placehold.co",
        port: "",
        pathname: "/**",
      },
    ],
  },
  webpack: (config, { isServer }) => {
    // Exclude pdfjs-dist from server-side bundling
    if (isServer) {
      config.externals = [...config.externals, "pdfjs-dist", "tesseract.js"];
    }
    return config;
  },
};

export default nextConfig;
