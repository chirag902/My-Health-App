import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Requires Next 15+. Keeps these out of the server bundle; loaded from node_modules instead.
  serverExternalPackages: ["tesseract.js", "pdfjs-dist", "unpdf"],

  // tesseract loads its WASM + worker script dynamically, which Vercel's file tracer cannot see.
  // Force-include them, plus our bundled language data (tessdata/eng.traineddata).
  outputFileTracingIncludes: {
    "/api/analyze-document": [
      "./tessdata/**/*",
      "./node_modules/tesseract.js/**/*",
      "./node_modules/tesseract.js-core/**/*",
    ],
  },

  // pdfjs-dist optionally requires the native `canvas` package (Node only). Stub it in the browser bundle.
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.alias = { ...config.resolve.alias, canvas: false };
    }
    return config;
  },

  // TODO: remove these two once the codebase is clean. They hide real bugs.
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },

  images: {
    remotePatterns: [
      { protocol: "https", hostname: "placehold.co", port: "", pathname: "/**" },
    ],
  },
};

export default nextConfig;