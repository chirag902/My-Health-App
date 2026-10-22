// src/app/api/analyze-document/route.ts
//
// Next.js only allows a few named exports from a route file (HTTP methods and route config),
// so every bit of real logic lives in @/lib/analyze-document-handler where it can be tested.

import { createAnalyzeDocumentHandler } from "@/lib/analyze-document-handler";

export const runtime = "nodejs";

// The handler stops starting new work after 50s (TIME_BUDGET_MS) so it can still answer before this limit.
export const maxDuration = 60;

export const POST = createAnalyzeDocumentHandler();