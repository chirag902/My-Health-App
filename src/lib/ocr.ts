import { createWorker, PSM } from "tesseract.js";

/**
 * OCR configuration for medical/laboratory documents.
 *
 * IMPORTANT:
 * - OCR extracts text.
 * - Table reconstruction is handled separately by tableParser.ts.
 * - We intentionally do not use tessedit_char_whitelist because it can
 *   remove useful characters from medical reports (e.g. :, <, >, +, °, etc.).
 */

const OCR_LANGUAGE = "eng";

/**
 * Maximum input size for OCR.
 *
 * This is a safety/performance guard rather than a hard requirement.
 * Very large images can make Tesseract extremely slow.
 */
const MAX_DATA_URI_LENGTH = 25_000_000;

/**
 * Extract text from a medical document using Tesseract OCR.
 *
 * Supported input:
 * - data:image/...;base64,...
 * - Blob/File-like URLs supported by Tesseract
 * - Other Tesseract-compatible image sources
 *
 * @param dataUri Document/image data
 * @returns Extracted OCR text
 */
export async function extractTextFromFile(
  dataUri: string
): Promise<string> {
  if (!dataUri || typeof dataUri !== "string") {
    throw new Error("Invalid document data.");
  }

  if (dataUri.length > MAX_DATA_URI_LENGTH) {
    throw new Error(
      "Document is too large for OCR processing. Please upload a smaller or compressed document."
    );
  }

  let worker: Awaited<ReturnType<typeof createWorker>> | null = null;

  try {
    console.log("🔎 Starting OCR...");

    /*
     * Create one worker for this request.
     *
     * We terminate it in finally so the Node process does not retain
     * unnecessary OCR resources after the request completes.
     */
    worker = await createWorker(OCR_LANGUAGE);

    /*
     * AUTO is safer for mixed medical documents because the document
     * may contain:
     * - headings
     * - tables
     * - paragraphs
     * - numbers
     * - reference ranges
     *
     * preserve_interword_spaces helps maintain spacing that the
     * table parser can later use when reconstructing rows.
     */
    await worker.setParameters({
      tessedit_pageseg_mode: PSM.AUTO,
      preserve_interword_spaces: "1",
    });

    const result = await worker.recognize(dataUri);

    const text = result.data.text || "";

    const cleanedText = cleanOCRText(text);

    console.log(
      `✅ OCR completed. Extracted ${cleanedText.length} characters.`
    );

    return cleanedText;
  } catch (error: unknown) {
    const message =
      error instanceof Error
        ? error.message
        : "Unknown OCR error";

    console.error("❌ OCR Error:", message);

    throw new Error(
      `Failed to extract text from document: ${message}`
    );
  } finally {
    /*
     * Always release the Tesseract worker.
     *
     * This is important for server-side Next.js because leaving workers
     * alive can consume memory and make repeated document uploads slower.
     */
    if (worker) {
      try {
        await worker.terminate();
      } catch (terminateError: unknown) {
        const message =
          terminateError instanceof Error
            ? terminateError.message
            : "Unknown worker termination error";

        console.error(
          "⚠️ Failed to terminate OCR worker:",
          message
        );
      }
    }
  }
}

/**
 * Cleans OCR output without aggressively modifying medical data.
 *
 * We deliberately avoid replacing characters such as:
 * - <
 * - >
 * - +
 * - -
 * - /
 * - %
 * - .
 *
 * because these can be clinically meaningful.
 */
function cleanOCRText(text: string): string {
  if (!text) {
    return "";
  }

  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")

    // Normalize tabs but preserve line structure.
    .replace(/\t+/g, "\t")

    // Remove excessive spaces while preserving meaningful spacing.
    .replace(/[ ]{3,}/g, "  ")

    // Prevent huge runs of blank lines.
    .replace(/\n{3,}/g, "\n\n")

    .trim();
}