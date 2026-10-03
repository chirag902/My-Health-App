// src/app/actions.ts

"use server";

import { z } from "zod";

import { mockDoctors } from "@/lib/data";
import { generateJsonAIResponse } from "@/lib/ai-client";
import { extractTextFromFile } from "@/lib/ocr";
import {
  parseLabTable,
  type LabMetric,
} from "@/lib/ocr/tableParser";
import { logger } from "@/lib/logger";

import type {
  AiDiagnosisInput,
  AiDiagnosisOutput,
  AnalyzeDocumentInput,
  AnalyzeDocumentOutput,
  DailyMotivationOutput,
} from "@/lib/types";

/* ============================================================
   TYPES
   ============================================================ */

type ActionSuccess<T> = {
  success: true;
  data: T;
};

type ActionError = {
  success: false;
  error: string;
};

type ActionResponse<T> =
  | ActionSuccess<T>
  | ActionError;

type DiagnosisActionData =
  | AiDiagnosisOutput
  | {
      followUpQuestion: string;
    };

/* ============================================================
   CONSTANTS
   ============================================================ */

const MEDICAL_DISCLAIMER =
  "This analysis is for informational purposes only and is not a medical diagnosis. Laboratory results should be interpreted by a qualified healthcare professional using the patient's symptoms, history, examination, and laboratory reference ranges.";

const MAX_DIAGNOSIS_HISTORY_MESSAGES = 20;
const MAX_DIAGNOSIS_MESSAGE_LENGTH = 2_000;

const MAX_DOCUMENT_DATA_URI_LENGTH = 25_000_000;

const MAX_DOCUMENT_PROMPT_CHARS = 14_000;
const MAX_AI_METRICS = 100;
const MAX_FIELD_LENGTH = 120;

const MIN_METRIC_CONFIDENCE = 0.3;

/* ============================================================
   INPUT SCHEMAS
   ============================================================ */

const diagnosisInputSchema = z.object({
  mode: z.enum(["quick", "detailed"]),

  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z
          .string()
          .trim()
          .min(1)
          .max(MAX_DIAGNOSIS_MESSAGE_LENGTH),
      })
    )
    .min(1)
    .max(MAX_DIAGNOSIS_HISTORY_MESSAGES),
});

const documentInputSchema = z.object({
  documentDataUri: z
    .string()
    .trim()
    .min(50, "Invalid document data.")
    .max(
      MAX_DOCUMENT_DATA_URI_LENGTH,
      "The document is too large."
    ),
});

/* ============================================================
   AI RESPONSE SCHEMAS
   ============================================================ */

   const diagnosisResultSchema = z.object({
    possibleConditions: z.array(z.string()),
    mentalHealthConditions: z.array(z.string()),
    relatedPhysicalIllnesses: z.array(z.string()),
    confidenceLevel: z.number().min(0).max(1),
  
    wellnessAdvice: z.object({
      lifestyle: z.array(z.string()),
      mindfulness: z.array(z.string()),
      diet: z.array(z.string()),
    }),
  });

const diagnosisAIResponseSchema = z.union([
  z.object({
    followUpQuestion: z
      .string()
      .trim()
      .min(1)
      .max(500),
  }),

  z.object({
    diagnosis: diagnosisResultSchema,
  }),
]);

const quickDiagnosisAIResponseSchema = z.object({
  diagnosis: diagnosisResultSchema,
});

const motivationAIResponseSchema = z.object({
  message: z
    .string()
    .trim()
    .min(1)
    .max(500),
});
const documentAIResponseSchema = z.object({
  summary: z
    .string()
    .trim()
    .min(1)
    .max(5_000),

  keyDataPoints: z.array(
    z.object({
      metric: z
        .string()
        .trim()
        .min(1)
        .max(MAX_FIELD_LENGTH),

      value: z
        .string()
        .trim()
        .min(1)
        .max(MAX_FIELD_LENGTH),

      unit: z
        .string()
        .trim()
        .min(1)
        .max(MAX_FIELD_LENGTH),

      referenceRange: z
        .string()
        .trim()
        .min(1)
        .max(MAX_FIELD_LENGTH),

      flag: z
        .string()
        .trim()
        .min(1)
        .max(50),

      confidence: z
        .number()
        .min(0)
        .max(1),
    })
  ),

  recommendations: z
    .array(
      z
        .string()
        .trim()
        .min(1)
        .max(500)
    )
    .max(20),
});

/* ============================================================
   GENERIC HELPERS
   ============================================================ */

function cleanText(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }

  return value
    .replace(/\s+/g, " ")
    .trim();
}

function limitText(
  value: unknown,
  maxLength = MAX_FIELD_LENGTH
): string {
  const cleaned = cleanText(value);

  if (cleaned.length <= maxLength) {
    return cleaned;
  }

  return cleaned
    .slice(0, maxLength)
    .trim();
}

function clampConfidence(value: unknown): number {
  if (
    typeof value !== "number" ||
    Number.isNaN(value)
  ) {
    return 0.5;
  }

  return Math.max(0, Math.min(1, value));
}

function cleanStringArray(
  value: unknown,
  maxItems = 10,
  maxLength = 300
): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter(
      (item): item is string =>
        typeof item === "string"
    )
    .map((item) =>
      cleanText(item).slice(0, maxLength)
    )
    .filter(Boolean)
    .slice(0, maxItems);
}

function normalizeMetricName(
  metric: string
): string {
  return cleanText(metric)
    .toLowerCase()
    .replace(/[^\w]+/g, "");
}

function metricQuality(
  metric: LabMetric
): number {
  let score = 0;

  if (cleanText(metric.value)) {
    score += 3;
  }

  if (
    cleanText(metric.unit) &&
    cleanText(metric.unit).toLowerCase() !==
      "not specified"
  ) {
    score += 2;
  }

  if (
    cleanText(metric.range) &&
    cleanText(metric.range).toLowerCase() !==
      "not specified"
  ) {
    score += 2;
  }

  if (
    cleanText(metric.flag) &&
    cleanText(metric.flag).toLowerCase() !==
      "n/a"
  ) {
    score += 1;
  }

  score += clampConfidence(metric.confidence);

  return score;
}

/* ============================================================
   DIAGNOSIS PROMPT
   ============================================================ */

function createDiagnosisPrompt(
  input: AiDiagnosisInput
): string {
  const historyText = input.history
    .map(
      (message) =>
        `${message.role.toUpperCase()}: ${message.content.trim()}`
    )
    .join("\n");

  if (input.mode === "quick") {
    return `
You are a cautious health-information assistant performing a brief symptom assessment.
Your task is to identify a small number of plausible explanations for the symptoms provided, identify relevant physical-health possibilities, identify mental-health possibilities only when supported by the conversation, provide low-risk general wellness guidance, and identify when professional or urgent medical evaluation may be appropriate.
Think in terms of plausible possibilities and symptom patterns, not certainty.

MODE: QUICK

Your response must contain a "diagnosis" object.

Do NOT ask a follow-up question.

This is NOT a formal medical diagnosis.

SAFETY RULES:
QUICK MODE ASSESSMENT RULES

1. Base the assessment strictly on the symptoms, context, and answers provided in the conversation. Do not assume facts that were not stated.
2. Do not present any condition as confirmed, certain, or as a medical diagnosis. Use cautious language such as "could be associated with", "may be related to", or "one possibility is".
3. Never invent symptoms, duration, severity, medical history, medications, allergies, test results, diagnoses, or other patient information.
4. Use "possibleConditions" for the most plausible conditions or common explanations that could reasonably account for the supplied symptoms. Include multiple relevant possibilities when supported by the conversation.
5. Use "relatedPhysicalIllnesses" for relevant physical health conditions that could plausibly be associated with the reported symptoms. For common symptoms such as persistent headaches, do not automatically leave this array empty if there are reasonable possibilities supported by the symptom pattern.
6. Use "mentalHealthConditions" ONLY when the conversation provides reasonable evidence of a mental-health-related component, such as persistent anxiety, panic symptoms, significant stress, depressed mood, sleep disturbance associated with distress, or similar explicitly reported symptoms. Never infer a mental-health condition merely because a symptom could theoretically have psychological causes.
7. Empty arrays are appropriate only when there is genuinely insufficient evidence to provide a responsible possibility for that category. Do not make arrays empty simply because certainty is unavailable; this assessment is specifically about plausible possibilities, not confirmed diagnoses.
8. Prefer common, clinically plausible possibilities over rare diseases unless the conversation contains specific features that make a less-common condition relevant.
9. If a symptom is nonspecific, provide a small, focused set of reasonable possibilities rather than an exhaustive differential diagnosis. Avoid unnecessary or alarming rare conditions.
10. ConfidenceLevel must represent confidence in the quality and relevance of the assessment, NOT certainty that the user has a particular disease. Limited symptom information should result in moderate or low confidence.
11. Never recommend starting, stopping, increasing, decreasing, or changing prescription medication or other medical treatment.
12. Wellness advice must remain general, low-risk, and non-prescriptive. Suggestions may include hydration, regular meals, adequate sleep, appropriate rest, stress management, symptom tracking, and seeking professional evaluation when appropriate.
13. If the reported symptoms contain potential emergency warning signs, clearly recommend appropriate urgent or emergency medical evaluation. Do not attempt to reassure the user that an emergency condition is unlikely.
14. If important information is missing, use "followUpQuestion" to ask ONE concise, high-value question that would meaningfully improve the assessment.
15. Do not manufacture a follow-up question when the available information is already sufficient for a basic assessment.
16. Return valid JSON only. Do not include markdown, explanations outside the JSON, or additional fields.

REQUIRED JSON:

{
  "diagnosis": {
    "possibleConditions": [],
    "mentalHealthConditions": [],
    "relatedPhysicalIllnesses": [],
    "confidenceLevel": 0.0,
    "wellnessAdvice": {
      "lifestyle": [],
      "mindfulness": [],
      "diet": []
    }
  }
}

CONVERSATION:

${historyText}
`.trim();
  }

  return `
You are an AI health companion helping the user understand their symptoms.

MODE: DETAILED

You may ask ONE concise follow-up question when important information is genuinely missing.

If enough information is available, return a diagnosis object.

Do not ask unnecessary or repetitive questions.

This is NOT a formal medical diagnosis.

SAFETY RULES:

1. Base your response only on the supplied conversation.
2. Never claim certainty.
3. Never invent symptoms, medical history, medications, test results, or diagnoses.
4. Possible conditions must be presented only as possibilities.
5. "mentalHealthConditions" should remain empty unless the conversation provides reasonable evidence for a mental-health possibility.
6. "relatedPhysicalIllnesses" should contain only relevant possibilities supported by the information.
7. Arrays may be empty.
8. Never recommend starting, stopping, or changing prescription medication.
9. Wellness advice must be general and non-prescriptive.
10. If symptoms could indicate an emergency, advise appropriate urgent medical evaluation.
11. Keep confidence proportional to the information provided.
12. Return JSON only.

IF MORE INFORMATION IS NEEDED:

{
  "followUpQuestion": "One concise question."
}

IF ENOUGH INFORMATION IS AVAILABLE:

{
  "diagnosis": {
    "possibleConditions": [],
    "mentalHealthConditions": [],
    "relatedPhysicalIllnesses": [],
    "confidenceLevel": 0.0,
    "wellnessAdvice": {
      "lifestyle": [],
      "mindfulness": [],
      "diet": []
    }
  }
}

CONVERSATION:

${historyText}
`.trim();
}

/* ============================================================
   DIAGNOSIS NORMALIZATION
   ============================================================ */

function normalizeDiagnosis(
  diagnosis: z.infer<typeof diagnosisResultSchema>
): AiDiagnosisOutput {
  return {
    diagnosis: {
      possibleConditions:
        cleanStringArray(
          diagnosis.possibleConditions
        ),

      mentalHealthConditions:
        cleanStringArray(
          diagnosis.mentalHealthConditions
        ),

      relatedPhysicalIllnesses:
        cleanStringArray(
          diagnosis.relatedPhysicalIllnesses
        ),

      confidenceLevel:
        clampConfidence(
          diagnosis.confidenceLevel
        ),

      wellnessAdvice: {
        lifestyle:
          cleanStringArray(
            diagnosis.wellnessAdvice?.lifestyle,
            8,
            300
          ),

        mindfulness:
          cleanStringArray(
            diagnosis.wellnessAdvice?.mindfulness,
            8,
            300
          ),

        diet:
          cleanStringArray(
            diagnosis.wellnessAdvice?.diet,
            8,
            300
          ),
      },
    },
  };
}

/* ============================================================
   MOTIVATION
   ============================================================ */

export async function getMotivationAction(): Promise<
  ActionResponse<DailyMotivationOutput>
> {
  const prompt = `
Return one short positive daily motivational message.

Rules:

1. Maximum two sentences.
2. No medical advice.
3. No diagnosis.
4. No Markdown.
5. Return JSON only.

JSON:

{
  "message": "short motivational message"
}
`.trim();

  return generateJsonAIResponse(
    prompt,
    "motivation",
    motivationAIResponseSchema
  );
}

/* ============================================================
   DIAGNOSIS
   ============================================================ */

export async function getDiagnosisAction(
  input: AiDiagnosisInput
): Promise<
  ActionResponse<DiagnosisActionData>
> {
  const parsed =
    diagnosisInputSchema.safeParse(input);

  if (!parsed.success) {
    logger.warn("Invalid diagnosis input", {
      issueCount: parsed.error.issues.length,
    });

    return {
      success: false,
      error: "Invalid diagnosis input.",
    };
  }

  const sanitizedInput = {
    mode: parsed.data.mode,
    history: parsed.data.history.map(
      (message) => ({
        role: message.role,
        content: message.content.trim(),
      })
    ),
  };

  const userMessages =
    sanitizedInput.history.filter(
      (message) => message.role === "user"
    );

  const lastUserMessage =
    userMessages.at(-1);

  if (!lastUserMessage) {
    return {
      success: false,
      error: "Please describe your symptoms.",
    };
  }

  const userText =
    lastUserMessage.content.trim();

  /*
   * Avoid wasting an AI call on meaningless input.
   */
  if (userText.length < 3) {
    if (sanitizedInput.mode === "detailed") {
      return {
        success: true,
        data: {
          followUpQuestion:
            "Could you describe what you are experiencing in a little more detail?",
        },
      };
    }

    return {
      success: true,
      data: {
        diagnosis: {
          possibleConditions: [],
          mentalHealthConditions: [],
          relatedPhysicalIllnesses: [],
          confidenceLevel: 0.05,
          wellnessAdvice: {
            lifestyle: [
              "Please provide a little more information about the symptom for a more useful preliminary assessment.",
            ],
            mindfulness: [],
            diet: [],
          },
        },
      },
    };
  }

  const prompt =
    createDiagnosisPrompt(
      sanitizedInput
    );

  if (sanitizedInput.mode === "quick") {
    const result =
      await generateJsonAIResponse(
        prompt,
        "diagnosis",
        quickDiagnosisAIResponseSchema
      );

    if (!result.success) {
      return result;
    }

    return {
      success: true,
      data: normalizeDiagnosis(
        result.data.diagnosis
      ),
    };
  }

  const result =
    await generateJsonAIResponse(
      prompt,
      "diagnosis",
      diagnosisAIResponseSchema
    );

  if (!result.success) {
    return result;
  }

  if ("followUpQuestion" in result.data) {
    return {
      success: true,
      data: {
        followUpQuestion:
          result.data.followUpQuestion.trim(),
      },
    };
  }

  return {
    success: true,
    data: normalizeDiagnosis(
      result.data.diagnosis
    ),
  };
}

/* ============================================================
   DOCTORS
   ============================================================ */

export async function getDoctorsAction(): Promise<
  ActionResponse<typeof mockDoctors>
> {
  try {
    return {
      success: true,
      data: mockDoctors,
    };
  } catch (error: unknown) {
    logger.error("Doctor directory action failed", {
      error:
        error instanceof Error
          ? error.message
          : String(error),
    });

    return {
      success: false,
      error: "Failed to load the doctor directory.",
    };
  }
}

/* ============================================================
   METRIC DEDUPLICATION
   ============================================================ */

function deduplicateMetrics(
  metrics: LabMetric[]
): LabMetric[] {
  const map = new Map<
    string,
    LabMetric
  >();

  for (const metric of metrics) {
    const key = normalizeMetricName(
      metric.metric
    );

    if (!key) {
      continue;
    }

    const existing = map.get(key);

    if (!existing) {
      map.set(key, metric);
      continue;
    }

    if (
      metricQuality(metric) >
      metricQuality(existing)
    ) {
      map.set(key, metric);
    }
  }

  return Array.from(map.values());
}

/* ============================================================
   METRIC MATCHING
   ============================================================ */

function findBestMetricMatch(
  aiMetricName: string,
  metrics: LabMetric[]
): LabMetric | undefined {
  const target =
    normalizeMetricName(aiMetricName);

  if (!target) {
    return undefined;
  }

  const exact = metrics.find(
    (metric) =>
      normalizeMetricName(metric.metric) ===
      target
  );

  if (exact) {
    return exact;
  }

  return metrics.find((metric) => {
    const source =
      normalizeMetricName(metric.metric);

    return (
      source.includes(target) ||
      target.includes(source)
    );
  });
}

/* ============================================================
   DOCUMENT RESULT NORMALIZATION
   ============================================================ */

type NormalizedKeyDataPoint = {
  metric: string;
  value: string;
  unit: string;
  referenceRange: string;
  flag: string;
  confidence: number;
};

function normalizeDocumentResult(
  aiResult: z.infer<
    typeof documentAIResponseSchema
  >,
  metrics: LabMetric[]
): {
  summary: string;
  keyDataPoints: NormalizedKeyDataPoint[];
  recommendations: string[];
} {
  const normalizedPoints: NormalizedKeyDataPoint[] =
    [];

  /*
   * Parser/OCR values are the source of truth.
   * AI provides interpretation, not replacement laboratory values.
   */
  for (const aiPoint of aiResult.keyDataPoints) {
    const metricName =
      cleanText(aiPoint.metric);

    if (!metricName) {
      continue;
    }

    const match =
      findBestMetricMatch(
        metricName,
        metrics
      );

    /*
     * Never accept a laboratory value created
     * by the AI if the parser did not find it.
     */
    if (!match) {
      continue;
    }

    normalizedPoints.push({
      metric:
        cleanText(match.metric) ||
        metricName,

      value:
        cleanText(match.value) ||
        "Not specified",

      unit:
        cleanText(match.unit) ||
        "Not specified",

      referenceRange:
        cleanText(match.range) ||
        "Not specified",

      flag:
        cleanText(match.flag) ||
        "N/A",

      confidence:
        clampConfidence(match.confidence),
    });
  }

  /*
   * Preserve parser metrics that the AI omitted.
   */
  const alreadyIncluded =
    new Set(
      normalizedPoints.map((point) =>
        normalizeMetricName(
          point.metric
        )
      )
    );

  for (const metric of metrics) {
    const key =
      normalizeMetricName(
        metric.metric
      );

    if (
      !key ||
      alreadyIncluded.has(key)
    ) {
      continue;
    }

    if (!cleanText(metric.value)) {
      continue;
    }

    normalizedPoints.push({
      metric:
        cleanText(metric.metric) ||
        "Unknown metric",

      value:
        cleanText(metric.value) ||
        "Not specified",

      unit:
        cleanText(metric.unit) ||
        "Not specified",

      referenceRange:
        cleanText(metric.range) ||
        "Not specified",

      flag:
        cleanText(metric.flag) ||
        "N/A",

      confidence:
        clampConfidence(
          metric.confidence
        ),
    });

    alreadyIncluded.add(key);
  }

  return {
    summary:
      cleanText(aiResult.summary) ||
      "The document was analyzed using the extracted laboratory values.",

    keyDataPoints:
      normalizedPoints,

    recommendations:
      aiResult.recommendations
        .map(cleanText)
        .filter(Boolean),
  };
}

/* ============================================================
   LOCAL DOCUMENT FALLBACK
   ============================================================ */

function createLocalDocumentFallback(
  metrics: LabMetric[],
  reason?: string
): AnalyzeDocumentOutput {
  const keyDataPoints =
    metrics
      .filter(
        (metric) =>
          Boolean(cleanText(metric.value))
      )
      .map((metric) => ({
        metric:
          cleanText(metric.metric) ||
          "Unknown metric",

        value:
          cleanText(metric.value) ||
          "Not specified",

        unit:
          cleanText(metric.unit) ||
          "Not specified",

        referenceRange:
          cleanText(metric.range) ||
          "Not specified",

        flag:
          cleanText(metric.flag) ||
          "N/A",

        confidence:
          clampConfidence(
            metric.confidence
          ),

        range:
          cleanText(metric.range) ||
          "Not specified",
      }));

  const abnormalCount =
    metrics.filter(
      (metric) =>
        cleanText(metric.flag)
          .toLowerCase() === "high" ||
        cleanText(metric.flag)
          .toLowerCase() === "low"
    ).length;

  const summary =
    metrics.length === 0
      ? "The document was readable, but no structured laboratory metrics were detected."
      : `The document was successfully read and ${metrics.length} laboratory metric(s) were extracted. ${
          abnormalCount
        } metric(s) were flagged based on the available parsed reference information.`;

  const recommendations = [
    "Review these laboratory results with a qualified healthcare professional.",
    "Laboratory values should be interpreted together with symptoms, medical history, examination findings, and the laboratory's own reference ranges.",
    MEDICAL_DISCLAIMER,
  ];

  if (reason) {
    logger.warn(
      "Using local document-analysis fallback",
      {
        reason,
      }
    );
  }

  return {
    summary,
    keyDataPoints,
    recommendations,
  };
}

/* ============================================================
   COMPACT DOCUMENT PROMPT
   ============================================================ */

function compactMetric(
  metric: LabMetric
) {
  return {
    metric: limitText(metric.metric),
    value: limitText(metric.value),
    unit: limitText(metric.unit),
    referenceRange: limitText(
      metric.range
    ),
    flag: limitText(metric.flag, 30),
    confidence: Number(
      clampConfidence(
        metric.confidence
      ).toFixed(2)
    ),
  };
}

function createCompactDocumentPrompt(
  metrics: LabMetric[]
): string {
  const compactMetrics =
    metrics
      .slice(0, MAX_AI_METRICS)
      .map(compactMetric);

  let metricsJson =
    JSON.stringify(
      compactMetrics
    );

  let prompt = `
You are a cautious medical laboratory report analysis assistant.

Analyze ONLY the supplied laboratory metrics.

IMPORTANT SAFETY RULES:

1. This is informational analysis, NOT a medical diagnosis.
2. Never invent laboratory values.
3. Never invent units.
4. Never invent reference ranges.
5. Never invent patient age, sex, symptoms, diseases, or medical history.
6. Preserve supplied values exactly.
7. If information is "Not specified", keep it "Not specified".
8. Do not create additional laboratory metrics.
9. Use the supplied flag when available.
10. Do not claim certainty.
11. Recommendations must encourage appropriate professional review.
12. Return JSON only.

OUTPUT:

{
  "summary": "concise interpretation",
  "keyDataPoints": [
    {
      "metric": "exact supplied metric",
      "value": "exact supplied value",
      "unit": "exact supplied unit",
      "referenceRange": "exact supplied range",
      "flag": "supplied flag",
      "confidence": 0.0
    }
  ],
  "recommendations": [
    "safe recommendation"
  ]
}

LABORATORY METRICS:

${metricsJson}
`.trim();

  /*
   * Secondary compaction if the prompt becomes too large.
   */
  if (
    prompt.length >
    MAX_DOCUMENT_PROMPT_CHARS
  ) {
    const reducedMetrics =
      metrics
        .slice(
          0,
          Math.min(
            60,
            MAX_AI_METRICS
          )
        )
        .map((metric) => ({
          metric: limitText(
            metric.metric,
            80
          ),
          value: limitText(
            metric.value,
            50
          ),
          unit: limitText(
            metric.unit,
            40
          ),
          referenceRange:
            limitText(
              metric.range,
              50
            ),
          flag: limitText(
            metric.flag,
            20
          ),
          confidence: Number(
            clampConfidence(
              metric.confidence
            ).toFixed(2)
          ),
        }));

    metricsJson =
      JSON.stringify(
        reducedMetrics
      );

    prompt = `
Analyze ONLY these supplied laboratory results.

Rules:
- Return JSON only.
- Never invent values.
- Never invent units.
- Never invent reference ranges.
- Do not diagnose.
- Preserve supplied values exactly.
- Keep "Not specified" when information is missing.
- Give concise professional recommendations.

JSON:

{
  "summary": "string",
  "keyDataPoints": [
    {
      "metric": "string",
      "value": "string",
      "unit": "string",
      "referenceRange": "string",
      "flag": "string",
      "confidence": 0.0
    }
  ],
  "recommendations": ["string"]
}

LAB DATA:

${metricsJson}
`.trim();
  }

  return prompt;
}

/* ============================================================
   DOCUMENT ANALYSIS
   ============================================================ */

export async function analyzeDocumentAction(
  input: AnalyzeDocumentInput
): Promise<
  ActionResponse<AnalyzeDocumentOutput>
> {
  const parsed =
    documentInputSchema.safeParse(input);

  if (!parsed.success) {
    logger.warn(
      "Invalid document-analysis input",
      {
        issueCount:
          parsed.error.issues.length,
      }
    );

    return {
      success: false,
      error:
        "Invalid document. Please upload a valid medical document.",
    };
  }

  const documentDataUri =
    parsed.data.documentDataUri;

  /* ----------------------------------------------------------
     OCR
     ---------------------------------------------------------- */

  let rawText = "";

  try {
    rawText =
      await extractTextFromFile(
        documentDataUri
      );
  } catch (error: unknown) {
    logger.error(
      "Medical document OCR failed",
      {
        error:
          error instanceof Error
            ? error.message
            : String(error),
      }
    );

    return {
      success: false,
      error:
        "The document could not be read. Please upload a clearer PDF/image or a higher-resolution scan.",
    };
  }

  if (!rawText.trim()) {
    return {
      success: false,
      error:
        "The document contains no readable text. Please upload a clearer document.",
    };
  }

  /* ----------------------------------------------------------
     LIMIT OCR DATA BEFORE PROCESSING
     ---------------------------------------------------------- */

  /*
   * The parser gets a bounded input to avoid pathological
   * OCR output consuming excessive memory/CPU.
   */
  const boundedOCRText =
    rawText.slice(0, 60_000);

  /* ----------------------------------------------------------
     TABLE RECONSTRUCTION
     ---------------------------------------------------------- */

  let parsedMetrics: LabMetric[] = [];

  try {
    parsedMetrics =
      parseLabTable(
        boundedOCRText
      ) || [];
  } catch (error: unknown) {
    /*
     * Parser failure should not destroy the entire document flow.
     *
     * The current compact AI pipeline relies on structured metrics,
     * so if none can be reconstructed we return a local fallback.
     */
    logger.error(
      "Laboratory table parser failed",
      {
        error:
          error instanceof Error
            ? error.message
            : String(error),
      }
    );

    return {
      success: true,
      data:
        createLocalDocumentFallback(
          [],
          "The laboratory table could not be reconstructed."
        ),
    };
  }

  const metrics =
    deduplicateMetrics(
      parsedMetrics
    );

  /*
   * Remove extremely low-confidence parser results
   * only when there are enough stronger metrics.
   */
  const reliableMetrics =
    metrics.length > 10
      ? metrics.filter(
          (metric) =>
            clampConfidence(
              metric.confidence
            ) >=
            MIN_METRIC_CONFIDENCE
        )
      : metrics;

  if (reliableMetrics.length === 0) {
    return {
      success: true,
      data:
        createLocalDocumentFallback(
          [],
          "No reliable structured laboratory metrics were detected."
        ),
    };
  }

  /* ----------------------------------------------------------
     SINGLE COMPACT AI REQUEST
     ---------------------------------------------------------- */

  const prompt =
    createCompactDocumentPrompt(
      reliableMetrics
    );

  const result =
    await generateJsonAIResponse(
      prompt,
      "document-analysis",
      documentAIResponseSchema
    );

  /*
   * AI failure does NOT require a second AI call.
   *
   * We already have OCR/parser data, so return that safely.
   */
  if (!result.success) {
    return {
      success: true,
      data:
        createLocalDocumentFallback(
          reliableMetrics,
          result.error
        ),
    };
  }

  /* ----------------------------------------------------------
     MERGE AI INTERPRETATION + PARSER VALUES
     ---------------------------------------------------------- */

  const normalized =
    normalizeDocumentResult(
      result.data,
      reliableMetrics
    );

  const recommendations = [
    ...normalized.recommendations,
  ];

  if (
    !recommendations.some(
      (item) =>
        item
          .toLowerCase()
          .includes(
            "not a medical diagnosis"
          )
    )
  ) {
    recommendations.push(
      MEDICAL_DISCLAIMER
    );
  }

  const finalOutput: AnalyzeDocumentOutput =
    {
      summary:
        normalized.summary,

      keyDataPoints:
        normalized.keyDataPoints.map(
          (point) => ({
            metric: point.metric,
            value: point.value,
            unit: point.unit,
            referenceRange:
              point.referenceRange,
            flag: point.flag,
            confidence:
              point.confidence,

            /*
             * Kept for compatibility with
             * your existing AnalyzeDocumentKeyDataPoint type.
             */
            range:
              point.referenceRange,
          })
        ),

      recommendations,
    };

  return {
    success: true,
    data: finalOutput,
  };
}