// src/lib/ocr.ts  (replaces your current lib/ocr.ts; DELETE lib/ocr/extractTextFromFile.ts)
//
// Strategy:
//   PDF   -> read the embedded text layer (milliseconds). No OCR needed for digital reports.
//   Image -> auto-rotate, downscale, grayscale, then OCR with a REUSED worker.
//
// Setup once:
//   npm i unpdf
//   mkdir tessdata
//   curl -L -o tessdata/eng.traineddata \
//     https://github.com/tesseract-ocr/tessdata_fast/raw/main/eng.traineddata

import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { createWorker, PSM, type Worker } from "tesseract.js";

import { UserFacingError } from "@/lib/errors";
import { itemsToLines, type PdfTextItem } from "@/lib/pdf-lines";

const MAX_DATA_URI_LENGTH = 25_000_000;
const MAX_IMAGE_SIDE = 2000; // px. 12MP phone photo -> ~2MP = several times faster OCR
const OCR_TIMEOUT_MS = 45_000;
const MAX_PDF_PAGES = 10;
const MIN_TEXT_CHARS_PER_PAGE = 40; // below this we assume the PDF is a scan

/* ------------------------------------------------------------
   Reusable Tesseract worker (survives across warm invocations)
   ------------------------------------------------------------ */

let workerPromise: Promise<Worker> | null = null;

function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const worker = await createWorker("eng", 1, {
        // Language data shipped inside the deployment: no CDN download.
        langPath: path.join(process.cwd(), "tessdata"),
        gzip: false,
        // Vercel's only writable location. os.tmpdir() also works on Windows dev.
        cachePath: os.tmpdir(),
      });

      await worker.setParameters({
        tessedit_pageseg_mode: PSM.AUTO,
        preserve_interword_spaces: "1",
      });

      return worker;
    })().catch((error) => {
      workerPromise = null; // allow retry on next request
      throw error;
    });
  }

  return workerPromise;
}

async function resetWorker(): Promise<void> {
  const current = workerPromise;
  workerPromise = null;

  if (current) {
    try {
      const worker = await current;
      await worker.terminate();
    } catch {
      /* ignore */
    }
  }
}

/* ------------------------------------------------------------
   Helpers
   ------------------------------------------------------------ */

function parseDataUri(dataUri: string): { mime: string; buffer: Buffer } {
  const comma = dataUri.indexOf(",");

  if (!dataUri.startsWith("data:") || comma === -1) {
    throw new UserFacingError("Invalid document data.");
  }

  const mime = dataUri.slice(5, comma).split(";")[0].toLowerCase();
  const buffer = Buffer.from(dataUri.slice(comma + 1), "base64");

  if (buffer.length === 0) {
    throw new UserFacingError("Invalid document data.");
  }

  return { mime, buffer };
}

async function extractPdfText(buffer: Buffer): Promise<string> {
  const { getDocumentProxy } = await import("unpdf");

  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const pageCount = Math.min(pdf.numPages, MAX_PDF_PAGES);
  const pages: string[] = [];

  for (let i = 1; i <= pageCount; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    pages.push(
      itemsToLines(content.items as PdfTextItem[])
    );
  }

  const text = pages.join("\n\n").trim();

  if (text.length < MIN_TEXT_CHARS_PER_PAGE * pageCount) {
    throw new UserFacingError(
      "This PDF looks like a scan (no selectable text). Please upload a clear photo or screenshot (JPG/PNG) of the report instead."
    );
    // NEXT STEP if you want scanned PDFs: rasterize pages with unpdf's
    // renderPageAsImage + @napi-rs/canvas, then feed them to recognizeImage().
  }

  return text;
}

async function preprocessImage(buffer: Buffer): Promise<Buffer> {
  return sharp(buffer)
    .rotate() // honour EXIF orientation (phone photos!)
    .resize({
      width: MAX_IMAGE_SIDE,
      height: MAX_IMAGE_SIDE,
      fit: "inside",
      withoutEnlargement: true,
    })
    .grayscale()
    .normalize()
    .png()
    .toBuffer();
}

async function recognizeImage(image: Buffer): Promise<string> {
  const worker = await getWorker();

  let timer: NodeJS.Timeout | undefined;

  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new UserFacingError("OCR timed out. Try a smaller or clearer image.")),
      OCR_TIMEOUT_MS
    );
  });

  try {
    const { data } = await Promise.race([worker.recognize(image), timeout]);
    return data.text || "";
  } catch (error) {
    await resetWorker(); // a stuck worker must not poison later requests
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/* ------------------------------------------------------------
   Public API (same signature as before)
   ------------------------------------------------------------ */

export async function extractTextFromFile(dataUri: string): Promise<string> {
  if (!dataUri || typeof dataUri !== "string") {
    throw new UserFacingError("Invalid document data.");
  }

  if (dataUri.length > MAX_DATA_URI_LENGTH) {
    throw new UserFacingError("Document is too large. Please upload a smaller file.");
  }

  const started = Date.now();
  const { mime, buffer } = parseDataUri(dataUri);

  let text: string;

  if (mime === "application/pdf") {
    text = await extractPdfText(buffer);
  } else if (mime.startsWith("image/")) {
    let prepared: Buffer;
    try {
      prepared = await preprocessImage(buffer);
    } catch {
      throw new UserFacingError(
        "This image could not be read. Please upload a clear JPG, PNG or WebP."
      );
    }
    text = await recognizeImage(prepared);
  } else {
    throw new UserFacingError("Unsupported document type.");
  }

  console.log(
    `[ocr] ${mime} -> ${text.length} chars in ${Date.now() - started}ms`
  );

  return cleanOCRText(text);
}

function cleanOCRText(text: string): string {
  if (!text) return "";

  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\t+/g, "\t")
    .replace(/[ ]{3,}/g, "  ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}