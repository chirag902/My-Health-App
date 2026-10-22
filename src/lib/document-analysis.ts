// src/lib/document-analysis.ts
//
// Shared server-side pipeline (used by the API route and the legacy server action):
//   text -> table parser (source of truth for values) -> ONE small Groq call (summary + advice only)
//
// Speed/quality change vs. the old version: the AI no longer re-emits every metric.
// Echoing up to 100 metrics cost thousands of output tokens, and strict per-field schemas
// made validation fail often (-> silent fallback). Values now come ONLY from the parser.

import { z } from "zod";

import { generateJsonAIResponse } from "@/lib/ai-client";
import { UserFacingError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { extractTextFromFile } from "@/lib/ocr";
import { parseLabTable, type LabMetric } from "@/lib/ocr/tableParser";
import {
  clampConfidence,
  cleanStringArray,
  cleanText,
  limitText,
  normalizeMetricName,
} from "@/lib/text-utils";
import type { ActionResponse } from "@/lib/action-types";
import type { AnalyzeDocumentOutput } from "@/lib/types";

export const MEDICAL_DISCLAIMER =
  "This analysis is for informational purposes only and is not a medical diagnosis. Laboratory results should be interpreted by a qualified healthcare professional using the patient's symptoms, history, examination, and laboratory reference ranges.";

const MAX_TEXT_CHARS = 60_000;
const MAX_AI_METRICS = 100;
const MAX_PROMPT_CHARS = 14_000;
const MIN_METRIC_CONFIDENCE = 0.3;
const NOT_SPECIFIED = "Not specified";

type KeyDataPoint = AnalyzeDocumentOutput["keyDataPoints"][number];

/* ------------------------------------------------------------
   AI response schema (tolerant on purpose)
   ------------------------------------------------------------ */

const aiResponseSchema = z.object({
  summary: z.string().default(""),
  recommendations: z.array(z.string()).default([]),
});

/* ------------------------------------------------------------
   Metric helpers
   ------------------------------------------------------------ */

function isAbnormal(metric: LabMetric): boolean {
  return /^(high|low|critical|abnormal|h|l)\b/i.test(cleanText(metric.flag));
}

function metricQuality(metric: LabMetric): number {
  let score = 0;
  if (cleanText(metric.value)) score += 3;
  if (cleanText(metric.unit) && cleanText(metric.unit).toLowerCase() !== "not specified") score += 2;
  if (cleanText(metric.range) && cleanText(metric.range).toLowerCase() !== "not specified") score += 2;
  if (cleanText(metric.flag) && cleanText(metric.flag).toLowerCase() !== "n/a") score += 1;
  return score + clampConfidence(metric.confidence);
}

function deduplicateMetrics(metrics: LabMetric[]): LabMetric[] {
  const map = new Map<string, LabMetric>();

  for (const metric of metrics) {
    const key = normalizeMetricName(metric.metric);
    if (!key) continue;

    const existing = map.get(key);
    if (!existing || metricQuality(metric) > metricQuality(existing)) {
      map.set(key, metric);
    }
  }

  return Array.from(map.values());
}

function toKeyDataPoint(metric: LabMetric): KeyDataPoint {
  const range = cleanText(metric.range) || NOT_SPECIFIED;

  return {
    metric: cleanText(metric.metric) || "Unknown metric",
    value: cleanText(metric.value) || NOT_SPECIFIED,
    unit: cleanText(metric.unit) || NOT_SPECIFIED,
    referenceRange: range,
    range, // kept for compatibility with the existing type
    flag: cleanText(metric.flag) || "N/A",
    confidence: clampConfidence(metric.confidence),
  } as KeyDataPoint;
}

function compactMetric(metric: LabMetric) {
  return {
    metric: limitText(metric.metric, 80),
    value: limitText(metric.value, 50),
    unit: limitText(metric.unit, 40),
    referenceRange: limitText(metric.range, 50),
    flag: limitText(metric.flag, 20),
  };
}

/* ------------------------------------------------------------
   Prompt
   ------------------------------------------------------------ */

function buildPrompt(metrics: LabMetric[]): string {
  // Abnormal values first, so truncation never drops what matters most.
  const ordered = [...metrics].sort(
    (a, b) => Number(isAbnormal(b)) - Number(isAbnormal(a))
  );

  let count = Math.min(ordered.length, MAX_AI_METRICS);

  for (;;) {
    const json = JSON.stringify(ordered.slice(0, count).map(compactMetric));

    const prompt = `
You are a cautious laboratory-report explanation assistant.

You are given ${count} of ${metrics.length} extracted laboratory metrics (abnormal ones first).
The table of values is displayed to the user separately, so do NOT repeat the table.

RULES:
1. Informational only. This is NOT a medical diagnosis. Never claim certainty.
2. Refer ONLY to the supplied metrics. Never invent values, units, reference ranges, age, sex, symptoms, diseases or history.
3. Use the supplied flags. Do not re-judge values yourself.
4. "summary": plain-language overview, at most 120 words. Mention the metrics that are flagged, if any.
5. "recommendations": at most 5 short, safe suggestions encouraging review by a qualified healthcare professional.
6. Return JSON only.

OUTPUT:
{"summary": "string", "recommendations": ["string"]}

LABORATORY METRICS:
${json}
`.trim();

    if (prompt.length <= MAX_PROMPT_CHARS || count <= 10) return prompt;
    count = Math.floor(count * 0.7);
  }
}

/* ------------------------------------------------------------
   Local fallback (no AI)
   ------------------------------------------------------------ */

function buildLocalSummary(metrics: LabMetric[]): string {
  if (metrics.length === 0) {
    return "The document was readable, but no structured laboratory metrics were detected.";
  }

  const abnormal = metrics.filter(isAbnormal).length;

  return `The document was read and ${metrics.length} laboratory metric(s) were extracted. ${abnormal} metric(s) were flagged based on the available reference information.`;
}

const LOCAL_RECOMMENDATIONS = [
  "Review these laboratory results with a qualified healthcare professional.",
  "Laboratory values should be interpreted together with symptoms, medical history, examination findings, and the laboratory's own reference ranges.",
];

function withDisclaimer(recommendations: string[]): string[] {
  const hasDisclaimer = recommendations.some((r) =>
    r.toLowerCase().includes("not a medical diagnosis")
  );

  return hasDisclaimer ? recommendations : [...recommendations, MEDICAL_DISCLAIMER];
}

/* ------------------------------------------------------------
   Public API
   ------------------------------------------------------------ */

function sanitizeText(raw: string): string {
  // Strip control characters (keep \n and \t), then bound size.
  return raw
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .slice(0, MAX_TEXT_CHARS)
    .trim();
}

export async function analyzeLabText(
  rawText: string
): Promise<ActionResponse<AnalyzeDocumentOutput>> {
  const text = sanitizeText(rawText);

  if (!text) {
    return {
      success: false,
      error: "The document contains no readable text. Please upload a clearer document.",
    };
  }

  /* 1. Parse ------------------------------------------------ */
  const parseStart = Date.now();
  let parsed: LabMetric[] = [];

  try {
    parsed = parseLabTable(text) || [];
  } catch (error: unknown) {
    logger.error("Laboratory table parser failed", {
      error: error instanceof Error ? error.name : "UnknownError",
    });
  }

  const deduped = deduplicateMetrics(parsed);
  const metrics =
    deduped.length > 10
      ? deduped.filter((m) => clampConfidence(m.confidence) >= MIN_METRIC_CONFIDENCE)
      : deduped;

  const valued = metrics.filter((m) => cleanText(m.value));
  const keyDataPoints = valued.map(toKeyDataPoint);

  logger.info("Lab table parsed", {
    ms: Date.now() - parseStart,
    metrics: valued.length,
  });

  if (valued.length === 0) {
    return {
      success: true,
      data: {
        summary: buildLocalSummary([]),
        keyDataPoints: [],
        recommendations: withDisclaimer(LOCAL_RECOMMENDATIONS),
      },
    };
  }

  /* 2. One small AI call ------------------------------------ */
  const aiStart = Date.now();

  const result = await generateJsonAIResponse(
    buildPrompt(valued),
    "document-analysis",
    aiResponseSchema
  );

  logger.info("AI interpretation finished", {
    ms: Date.now() - aiStart,
    ok: result.success,
  });

  if (!result.success) {
    logger.warn("Using local document-analysis fallback", { reason: result.error });

    return {
      success: true,
      data: {
        summary: buildLocalSummary(valued),
        keyDataPoints,
        recommendations: withDisclaimer(LOCAL_RECOMMENDATIONS),
      },
    };
  }

  const summary = limitText(result.data.summary, 5_000) || buildLocalSummary(valued);
  const aiRecommendations = cleanStringArray(result.data.recommendations, 8, 500);

  return {
    success: true,
    data: {
      summary,
      keyDataPoints,
      recommendations: withDisclaimer(
        aiRecommendations.length > 0 ? aiRecommendations : LOCAL_RECOMMENDATIONS
      ),
    },
  };
}

/** OCR (or PDF text-layer read) + analysis, from a base64 data URI. */
export async function analyzeDocumentDataUri(
  dataUri: string
): Promise<ActionResponse<AnalyzeDocumentOutput>> {
  let rawText: string;

  try {
    rawText = await extractTextFromFile(dataUri);
  } catch (error: unknown) {
    if (error instanceof UserFacingError) {
      return { success: false, error: error.message };
    }

    logger.error("Medical document OCR failed", {
      error: error instanceof Error ? error.name : "UnknownError",
    });

    return {
      success: false,
      error:
        "The document could not be read. Please upload a clearer PDF/image or a higher-resolution scan.",
    };
  }

  return analyzeLabText(rawText);
}