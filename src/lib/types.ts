// ============================================================
// Doctor / Find a Doctor
// ============================================================

export interface Doctor {
  id: string;
  name: string;
  avatar: string;
  specialty: string;
  rating: number;
  reviews: number;
  location: string;
  bio: string;
}

// ============================================================
// AI - Daily Motivation
// ============================================================

export interface DailyMotivationOutput {
  message: string;
}

// ============================================================
// AI - Diagnosis
// ============================================================

export type DiagnosisMode = "quick" | "detailed";

export type DiagnosisMessageRole = "user" | "assistant";

export interface AiDiagnosisMessage {
  role: DiagnosisMessageRole;
  content: string;
}

export interface AiDiagnosisInput {
  mode: DiagnosisMode;
  history: AiDiagnosisMessage[];
}

export interface WellnessAdvice {
  lifestyle: string[];
  mindfulness: string[];
  diet: string[];
}

export interface DiagnosisResult {
  possibleConditions: string[];
  mentalHealthConditions: string[];
  relatedPhysicalIllnesses: string[];
  confidenceLevel: number;
  wellnessAdvice: WellnessAdvice;
}

export interface AiDiagnosisOutput {
  followUpQuestion?: string;
  diagnosis?: DiagnosisResult;
}

// ============================================================
// AI - Document Analysis
// ============================================================

export interface AnalyzeDocumentInput {
  documentDataUri: string;
}

export interface AnalyzeDocumentKeyDataPoint {
  metric: string;
  value: string;
  unit: string;
  referenceRange: string;

  /**
   * Optional compatibility field.
   * Keep this if any existing OCR/parser/UI code uses `range`.
   */
  range?: string;

  flag: string;
  confidence: number;
}

export interface AnalyzeDocumentOutput {
  summary: string;
  keyDataPoints: AnalyzeDocumentKeyDataPoint[];
  recommendations: string[];
}