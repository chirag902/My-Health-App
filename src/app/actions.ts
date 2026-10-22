"use server";

import { headers } from "next/headers";
import { z } from "zod";

import { generateJsonAIResponse } from "@/lib/ai-client";
import { analyzeDocumentDataUri } from "@/lib/document-analysis";
import { detectCrisis, hasProfile, sanitizeProfile } from "@/lib/diagnosis-ui";
import { logger } from "@/lib/logger";
import { assessSymptoms } from "@/lib/diagnosis-core";

import { checkMotivationRateLimit } from "@/lib/motivation/rate-limit";
import { DOCTOR_SPECIALTIES, MOCK_DOCTORS } from "@/lib/mock-doctors";
import { getClientIp, rateLimit } from "@/lib/rate-limit";
import { clampConfidence, cleanStringArray, containsDosage } from "@/lib/text-utils";
import {
  motivationAIResponseSchema,
  pickFallback,
  isTooSimilar,
  buildPrompt,
  MOTIVATION_THEMES,
  type DailyMotivationOutput,
  type ThemeId,
} from "@/lib/motivation/engine";
import type { ActionResponse } from "@/lib/action-types";
import type {
  AiDiagnosisInput,
  AnalyzeDocumentInput,
  AnalyzeDocumentOutput,
  DiagnosisActionData,
  DiagnosisResult,
  DiagnosisSource,
  Doctor,
  HealthProfile,
} from "@/lib/types";

/* ============================================================
   CONSTANTS
   ============================================================ */

const MAX_HISTORY = 20;
const MAX_USER_CHARS = 2_000;
const MAX_ASSISTANT_CHARS = 6_000; // assistant turns carry serialized diagnoses
 // after this, a diagnosis is forced
const MAX_DOCUMENT_DATA_URI_LENGTH = 25_000_000;
 // must stay below maxDuration (60)



// ⚠️ VERIFY these against official sources before launch.
const TELE_MANAS = "14416";
const EMERGENCY = "112";





/* ============================================================
   INPUT SCHEMAS
   ============================================================ */

const diagnosisInputSchema = z
  .object({
    mode: z.enum(["quick", "detailed"]),
    history: z
      .array(
        z.object({
          role: z.enum(["user", "assistant"]),
          content: z.string().trim().min(1).max(MAX_ASSISTANT_CHARS),
        })
      )
      .min(1)
      .max(MAX_HISTORY),
    profile: z.unknown().optional(), // sanitized by sanitizeProfile()
    locale: z.string().max(10).optional(),
    recentHistory: z.array(z.string().max(160)).max(3).optional(),
  })
  .refine((v) => v.history.at(-1)?.role === "user", {
    message: "Last message must come from the user.",
  });

const documentInputSchema = z.object({
  documentDataUri: z
    .string()
    .trim()
    .min(50, "Invalid document data.")
    .max(MAX_DOCUMENT_DATA_URI_LENGTH, "The document is too large."),
});

const motivationInputSchema = z.object({
  theme: z.string().max(40),
  recentMessages: z.array(z.string()).max(50),
});

/* ============================================================
   DIAGNOSIS
   ============================================================ */

   export async function getDiagnosisAction(
    input: AiDiagnosisInput
  ): Promise<ActionResponse<DiagnosisActionData>> {
    const parsed = diagnosisInputSchema.safeParse(input);
    if (!parsed.success) {
      logger.warn("Invalid diagnosis input", { issueCount: parsed.error.issues.length });
      return { success: false, error: "Invalid request. Please refresh and try again." };
    }
  
    const { mode } = parsed.data;
    const history = parsed.data.history.map((m) => ({
      role: m.role,
      content: m.role === "user" ? m.content.slice(0, MAX_USER_CHARS) : m.content,
    }));
  
    const ip = getClientIp(await headers());
    const [h, d] = await Promise.all([
      rateLimit("dx:h", 20, 3_600).check(ip),
      rateLimit("dx:d", 80, 86_400).check(ip),
    ]);
    if (!h.allowed || !d.allowed) {
      return {
        success: false,
        error: "Too many requests. Please try again later.",
        code: "rate_limited",
        retryAfterSeconds: Math.max(h.allowed ? 0 : h.retryAfterSeconds, d.allowed ? 0 : d.retryAfterSeconds),
      };
    }
  
    const result = await assessSymptoms({
      mode, history,
      profile: parsed.data.profile,
      locale: parsed.data.locale,
      recentHistory: parsed.data.recentHistory,
    });
  
    if (!result.success) return result;
  
    logger.warn("diagnosis ok", { mode, ...result.meta });
    return { success: true, data: result.data };
  }

/* ============================================================
   MOTIVATION
   ============================================================ */

type MotivationData = DailyMotivationOutput & { theme: ThemeId; source: "ai" | "fallback" };

export async function getMotivationAction(input: {
  theme: ThemeId;
  recentMessages: string[];
}): Promise<ActionResponse<MotivationData>> {
  const parsed = motivationInputSchema.safeParse(input);
  if (!parsed.success || !MOTIVATION_THEMES.some((t) => t.id === parsed.data.theme)) {
    return { success: false, error: "Invalid request." };
  }

  const theme = parsed.data.theme as ThemeId;
  const recent = parsed.data.recentMessages.slice(0, 10).map((m) => m.slice(0, 160));
  const fallback = (): ActionResponse<MotivationData> => ({
    success: true,
    data: { message: pickFallback(theme, recent), theme, source: "fallback" },
  });

  const rl = await rateLimit("motivation", 30, 86_400).check(getClientIp(await headers()));
  if (!rl.allowed) return fallback();

  try {
    let result = await generateJsonAIResponse(buildPrompt(theme, recent), "motivation", motivationAIResponseSchema);

    if (result.success && result.data && isTooSimilar(result.data.message, recent)) {
      const retry =
        buildPrompt(theme, [result.data.message, ...recent]) +
        "\n\nThe previous attempt was too similar to recent messages. Produce something clearly different in structure.";
      result = await generateJsonAIResponse(retry, "motivation", motivationAIResponseSchema);
    }

    if (result.success && result.data && !isTooSimilar(result.data.message, recent)) {
      return { success: true, data: { ...result.data, theme, source: "ai" } };
    }
    return fallback();
  } catch (e) {
    logger.warn("getMotivationAction failed", { reason: e instanceof Error ? e.message : "unknown" });
    return fallback();
  }
}

/* ============================================================
   DOCTORS
   ============================================================ */

export async function getDoctorsAction(): Promise<ActionResponse<Doctor[]>> {
  // TODO: replace with Firestore query. Signature stays stable.
  return { success: true, data: MOCK_DOCTORS };
}

/* ============================================================
   DOCUMENT ANALYSIS
   ============================================================ */

export async function analyzeDocumentAction(
  input: AnalyzeDocumentInput
): Promise<ActionResponse<AnalyzeDocumentOutput>> {
  const parsed = documentInputSchema.safeParse(input);
  if (!parsed.success) {
    logger.warn("Invalid document-analysis input", { issueCount: parsed.error.issues.length });
    return { success: false, error: "Invalid document. Please upload a valid medical document." };
  }
  return analyzeDocumentDataUri(parsed.data.documentDataUri);
}
  