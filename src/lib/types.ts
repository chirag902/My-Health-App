// ============================================================
// Doctor
// ============================================================

export interface Doctor {
  id: string;
  name: string;
  avatar?: string | null;
  specialty: string;
  rating: number;
  reviews: number;
  location: string;
  bio: string;
  availableOnline?: boolean;
}

// ============================================================
// Motivation
// ============================================================

// ⚠️ VERIFY: engine.ts also exports DailyMotivationOutput. Keep one source of truth.
export interface DailyMotivationOutput {
  message: string;
}

// ============================================================
// Diagnosis
// ============================================================

export type DiagnosisMode = "quick" | "detailed";
export type DiagnosisMessageRole = "user" | "assistant";
export type Urgency = "emergency" | "urgent" | "soon" | "routine" | "self-care";

export interface AiDiagnosisMessage {
  role: DiagnosisMessageRole;
  content: string;
}

export interface HealthProfile {
  age?: string;
  sex?: "female" | "male" | "other" | "";
  conditions?: string;
  medications?: string;
  allergies?: string;
  pregnant?: boolean;
}

export interface AiDiagnosisInput {
  mode: DiagnosisMode;
  history: AiDiagnosisMessage[];
  profile?: HealthProfile;
  locale?: string;
}

export interface WellnessAdvice {
  lifestyle: string[];
  mindfulness: string[];
  diet: string[];
}

export interface DiagnosisSource {
  title: string;
  url: string;
}

export interface DiagnosisResult {
  possibleConditions: string[];
  mentalHealthConditions: string[];
  relatedPhysicalIllnesses: string[];
  /** Information quality 0-1. NOT a disease probability. */
  confidenceLevel: number;
  urgency: Urgency;
  urgencyReason: string;
  redFlags: string[];
  personalizedNotes: string[];
  wellnessAdvice: WellnessAdvice;
  whenToSeeDoctor: string;
  /** Always one of the specialties in the doctor directory, or undefined. */
  suggestedSpecialty?: string;
  questionsForDoctor: string[];
  /** Server-verified (HTTPS, trusted domain, reachable). */
  sources: DiagnosisSource[];
}

export interface AiDiagnosisOutput {
  diagnosis: DiagnosisResult;
}

export interface AiFollowUpOutput {
  followUpQuestion: string;
}

export type DiagnosisActionData = AiDiagnosisOutput | AiFollowUpOutput;

// ============================================================
// Document Analysis (unchanged)
// ============================================================

export interface AnalyzeDocumentInput {
  documentDataUri: string;
}

export interface AnalyzeDocumentKeyDataPoint {
  metric: string;
  value: string;
  unit: string;
  referenceRange: string;
  /** Compatibility field for existing OCR/parser/UI code. */
  range?: string;
  flag: string;
  confidence: number;
}

export interface AnalyzeDocumentOutput {
  summary: string;
  keyDataPoints: AnalyzeDocumentKeyDataPoint[];
  recommendations: string[];
}