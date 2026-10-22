// src/lib/site.ts
// Single source of truth for the app's public identity. Server-side use only
// (layout, page, robots): it reads server env vars that do not exist in the browser.

const FALLBACK_URL = "http://localhost:3000";

function resolveSiteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit) return explicit.replace(/\/$/, "");

  // Vercel injects the production domain automatically.
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (vercel) return `https://${vercel}`;

  return FALLBACK_URL;
}

export const siteConfig = {
  name: "MyHealthApp",
  description:
    "Check symptoms, make sense of your lab reports, journal and build healthy habits, all in one place. General information only, not medical advice.",
  url: resolveSiteUrl(),

  /**
   * Search engines are blocked by default (a health app should not be indexed by accident).
   * Set NEXT_PUBLIC_ALLOW_INDEXING=true in the Vercel production environment to open the landing page.
   */
  allowIndexing: process.env.NEXT_PUBLIC_ALLOW_INDEXING === "true",
} as const;