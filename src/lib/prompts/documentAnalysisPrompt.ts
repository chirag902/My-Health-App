// src/lib/prompts/documentAnalysisPrompt.ts

import type { LabMetric } from '@/lib/ocr/tableParser';

export function createDocumentAnalysisPrompt(
metrics: LabMetric[], cleanedOCRText?: string): string {
  const compactMetrics = metrics
    .slice(0, 100)
    .map((metric, index) => ({
      id: index + 1,
      metric: metric.metric,
      value: metric.value,
      unit: metric.unit,
      referenceRange: metric.range,
      flag: metric.flag,
      extractionConfidence:
        metric.confidence,
    }));

  return `
Analyze the following laboratory measurements.

IMPORTANT SAFETY RULES:

1. Use ONLY the supplied laboratory measurements.
2. NEVER invent a value.
3. NEVER invent a reference range.
4. NEVER invent a unit.
5. If unit is missing, return "Not specified".
6. If reference range is missing, return "Not specified".
7. NEVER omit a metric when a numeric result exists.
8. Do not interpret a column header as a laboratory result.
9. Do not duplicate metrics.
10. Preserve decimal values exactly.
11. Distinguish laboratory VALUE from REFERENCE RANGE.
12. Do not provide a medical diagnosis.
13. Recommendations must be general informational guidance.
14. Clearly recommend consultation with a qualified healthcare professional when appropriate.
15. If a result is abnormal, explain that the result should be interpreted in clinical context.
16. Do not claim that one abnormal laboratory value proves a disease.

The output MUST be valid JSON.

Return exactly this structure:

{
  "summary": "Professional concise summary of the overall laboratory findings.",
  "keyDataPoints": [
    {
      "metric": "Exact metric name",
      "value": "Exact result",
      "unit": "Unit or Not specified",
      "referenceRange": "Reference range or Not specified",
      "status": "Normal | Low | High | Abnormal | N/A",
      "confidence": 0.95,
      "interpretation": "Short cautious explanation."
    }
  ],
  "recommendations": [
    "General recommendation"
  ]
}

LABORATORY DATA:

${JSON.stringify(compactMetrics, null, 2)}
`.trim();
}