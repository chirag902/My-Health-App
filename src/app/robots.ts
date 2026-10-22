import type { MetadataRoute } from "next";

import { siteConfig } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  if (!siteConfig.allowIndexing) {
    return { rules: { userAgent: "*", disallow: "/" } };
  }

  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/api/"] },
  };
}