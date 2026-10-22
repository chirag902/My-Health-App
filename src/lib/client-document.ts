// src/lib/client-document.ts  (browser only; import it from client components)
//
// Prepares an uploaded document ON THE USER'S DEVICE:
//   Digital PDF  -> read the text layer locally; ONLY the text is sent to the server.
//   Scanned PDF  -> render up to 3 pages to compressed JPEGs, send those for OCR.
//   Photo        -> auto-orient, downscale to 2000px, JPEG-compress, send for OCR.
// This removes the Vercel 4.5MB body limit for real-world files, cuts upload time from India
// to a US region, and removes OCR work from the server for most documents.

import type { PDFDocumentProxy } from "pdfjs-dist";

import { UserFacingError } from "@/lib/errors";
import { itemsToLines, type PdfTextItem } from "@/lib/pdf-lines";

import { MAX_UPLOAD_BYTES } from "@/lib/upload-limits";

// Re-exported for anyone already importing these from here; the canonical source is upload-limits.ts
// (which has no heavy dependencies, so a page can import just the numbers without pulling in pdfjs-dist).
export { MAX_INPUT_BYTES, MAX_UPLOAD_BYTES } from "@/lib/upload-limits";

const MAX_TEXT_CHARS = 60_000;
const MAX_PDF_PAGES = 10;
const MAX_SCAN_PAGES = 3;
const MIN_TEXT_CHARS_PER_PAGE = 40;
const MAX_IMAGE_SIDE = 2000;
const JPEG_QUALITIES = [0.85, 0.7, 0.55];

export type PreparedDocument =
  | { kind: "text"; text: string }
  | { kind: "files"; files: File[] };

/* ------------------------------------------------------------
   Canvas helpers
   ------------------------------------------------------------ */

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
}

async function canvasToJpegFile(
  canvas: HTMLCanvasElement,
  name: string,
  maxBytes: number
): Promise<File> {
  for (const quality of JPEG_QUALITIES) {
    const blob = await canvasToBlob(canvas, quality);
    const isLast = quality === JPEG_QUALITIES[JPEG_QUALITIES.length - 1];

    if (blob && (blob.size <= maxBytes || isLast)) {
      return new File([blob], name, { type: "image/jpeg" });
    }
  }

  throw new Error("Could not encode image.");
}

/* ------------------------------------------------------------
   Images
   ------------------------------------------------------------ */

async function compressImage(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });

  try {
    const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));

    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas unavailable.");

    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

    const name = file.name.replace(/\.\w+$/, "") + ".jpg";
    const compressed = await canvasToJpegFile(canvas, name, MAX_UPLOAD_BYTES - 300_000);

    // If the original is already small, keep it untouched.
    return compressed.size >= file.size && file.size <= MAX_UPLOAD_BYTES ? file : compressed;
  } finally {
    bitmap.close();
  }
}

/* ------------------------------------------------------------
   PDFs
   ------------------------------------------------------------ */

async function loadPdfJs() {
  const pdfjs = await import("pdfjs-dist");

  // public/pdf.worker.js is produced by scripts/copy-pdf-worker.mjs (runs on postinstall).
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.js";
  }

  return pdfjs;
}

async function rasterizePages(
  pdf: PDFDocumentProxy,
  pageCount: number,
  fileName: string
): Promise<File[]> {
  const perPageBudget = Math.floor((MAX_UPLOAD_BYTES - 300_000) / pageCount);
  const base = fileName.replace(/\.\w+$/, "");
  const files: File[] = [];

  for (let i = 1; i <= pageCount; i++) {
    const page = await pdf.getPage(i);

    try {
      const unit = page.getViewport({ scale: 1 });
      const scale = Math.min(3, MAX_IMAGE_SIDE / Math.max(unit.width, unit.height));
      const viewport = page.getViewport({ scale });

      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);

      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas unavailable.");

      // `canvas` is required by newer pdf.js versions, `canvasContext` by older ones.
      await page.render({ canvasContext: ctx, canvas, viewport } as Parameters<
        typeof page.render
      >[0]).promise;

      files.push(await canvasToJpegFile(canvas, `${base}-page-${i}.jpg`, perPageBudget));
    } finally {
      page.cleanup();
    }
  }

  return files;
}

async function preparePdf(file: File): Promise<PreparedDocument> {
  const pdfjs = await loadPdfJs();
  const data = new Uint8Array(await file.arrayBuffer());

  // Release resources through the LOADING TASK: PDFDocumentProxy.destroy() does not exist in
  // current pdfjs-dist (v5+), and calling it threw a TypeError on every PDF.
  const loadingTask = pdfjs.getDocument({ data });

  try {
    const pdf = await loadingTask.promise;
    const pageCount = Math.min(pdf.numPages, MAX_PDF_PAGES);
    const pages: string[] = [];

    for (let i = 1; i <= pageCount; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      pages.push(itemsToLines(content.items as PdfTextItem[]));
      page.cleanup();
    }

    const text = pages.join("\n\n").trim();

    if (text.length >= MIN_TEXT_CHARS_PER_PAGE * pageCount) {
      return { kind: "text", text: text.slice(0, MAX_TEXT_CHARS) };
    }

    // Scanned PDF: no selectable text -> send a few compressed page images for OCR.
    return {
      kind: "files",
      files: await rasterizePages(pdf, Math.min(pageCount, MAX_SCAN_PAGES), file.name),
    };
  } finally {
    await loadingTask.destroy().catch(() => undefined);
  }
}

/* ------------------------------------------------------------
   Public API
   ------------------------------------------------------------ */

export async function prepareDocument(file: File): Promise<PreparedDocument> {
  let prepared: PreparedDocument;

  try {
    prepared =
      file.type === "application/pdf"
        ? await preparePdf(file)
        : { kind: "files", files: [await compressImage(file)] };
  } catch {
    // Local processing failed (old browser, blocked worker, corrupt file...).
    // Fall back to uploading the raw file if it fits; the server can still read digital PDFs.
    if (file.size <= MAX_UPLOAD_BYTES) {
      return { kind: "files", files: [file] };
    }

    throw new UserFacingError(
      "This file could not be processed on your device and is too large to upload as-is. Please try a smaller file or a clear photo of the report."
    );
  }

  if (prepared.kind === "files") {
    const total = prepared.files.reduce((sum, f) => sum + f.size, 0);

    if (total > MAX_UPLOAD_BYTES) {
      throw new UserFacingError(
        "The document is still too large after compression. Please upload fewer pages or a lower-resolution photo."
      );
    }
  }

  return prepared;
}