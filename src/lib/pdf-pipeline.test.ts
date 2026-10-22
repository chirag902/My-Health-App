// src/lib/pdf-pipeline.test.ts
//
// End-to-end check of the digital-PDF path with a REAL PDF built in memory:
//   PDF bytes -> pdfjs text layer -> itemsToLines -> parseLabTable -> metrics
//
// Runs in Node using pdfjs-dist's "legacy" build. The browser build behaves the same for text.

import { describe, expect, it } from "vitest";

import { parseLabTable } from "@/lib/ocr/tableParser";
import { itemsToLines, type PdfTextItem } from "@/lib/pdf-lines";

/* ============================================================
   A MINIMAL, VALID PDF BUILDER (text only)
   ============================================================ */

interface Cell {
  text: string;
  x: number;
  y: number;
}

function buildPdf(cells: Cell[]): Uint8Array {
  const escape = (value: string) => value.replace(/[\\()]/g, (ch) => `\\${ch}`);

  const stream =
    "BT /F1 10 Tf\n" +
    cells.map((c) => `1 0 0 1 ${c.x} ${c.y} Tm (${escape(c.text)}) Tj\n`).join("") +
    "ET";

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];

  let body = "%PDF-1.4\n";
  const offsets: number[] = [];

  objects.forEach((object, index) => {
    offsets.push(body.length);
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });

  const xrefAt = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;

  return new TextEncoder().encode(body);
}

/** One table row = several cells on the same baseline. */
function row(y: number, ...cells: [string, number][]): Cell[] {
  return cells.map(([text, x]) => ({ text, x, y }));
}

const COL = { name: 50, result: 250, unit: 320, range: 400 };

const LAB_REPORT: Cell[] = [
  ...row(780, ["COMPLETE BLOOD COUNT (CBC)", 50]),
  ...row(750, ["Test Name", COL.name], ["Result", COL.result], ["Unit", COL.unit], ["Biological Reference Interval", COL.range]),
  ...row(725, ["Haemoglobin", COL.name], ["13.5", COL.result], ["gm/dL", COL.unit], ["13.0 - 17.0", COL.range]),
  ...row(705, ["Total Leucocyte Count", COL.name], ["7,200", COL.result], ["/cumm", COL.unit], ["4,000 - 11,000", COL.range]),
  ...row(685, ["Platelet Count", COL.name], ["2,50,000", COL.result], ["/cumm", COL.unit], ["1,50,000 - 4,10,000", COL.range]),
  ...row(665, ["Glucose Fasting", COL.name], ["126", COL.result], ["mg/dL", COL.unit], ["70 - 100", COL.range]),
  ...row(645, ["Cholesterol/HDL Ratio", COL.name], ["4.7", COL.result], ["0 - 5", COL.range]),
  ...row(620, ["Note: Fasting glucose above 126 mg/dL on two occasions is suggestive of diabetes.", 50]),
];

/* ============================================================
   pdfjs HELPERS
   ============================================================ */

async function loadDocument(bytes: Uint8Array) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = pdfjs.getDocument({ data: bytes, verbosity: 0 });
  const pdf = await loadingTask.promise;

  return { pdf, loadingTask };
}

async function extractText(bytes: Uint8Array): Promise<string> {
  const { pdf, loadingTask } = await loadDocument(bytes);

  try {
    const page = await pdf.getPage(1);
    const content = await page.getTextContent();

    return itemsToLines(content.items as PdfTextItem[]);
  } finally {
    await loadingTask.destroy();
  }
}

/* ============================================================
   TESTS
   ============================================================ */

describe("digital PDF pipeline (real PDF, real pdfjs)", () => {
  it("rebuilds table rows from the text layer, one visual row per line, columns in order", async () => {
    const text = await extractText(buildPdf(LAB_REPORT));
    const lines = text.split("\n");

    expect(lines).toContain("Haemoglobin  13.5  gm/dL  13.0 - 17.0");
    expect(lines).toContain("Platelet Count  2,50,000  /cumm  1,50,000 - 4,10,000");

    // top of the page first
    expect(lines[0]).toBe("COMPLETE BLOOD COUNT (CBC)");
  });

  it("turns a real lab PDF into correct structured metrics", async () => {
    const metrics = parseLabTable(await extractText(buildPdf(LAB_REPORT)));

    expect(metrics.map((m) => m.metric)).toEqual([
      "Haemoglobin",
      "Total Leucocyte Count",
      "Platelet Count",
      "Fasting Blood Sugar",
    ]);

    expect(metrics[0]).toMatchObject({ value: "13.5", unit: "g/dL", referenceRange: "13.0 - 17.0", flag: "Normal" });
    expect(metrics[1]).toMatchObject({ value: "7200", unit: "cells/cumm", flag: "Normal" });
    expect(metrics[2]).toMatchObject({ value: "250000", referenceRange: "150000 - 410000", flag: "Normal" });
    expect(metrics[3]).toMatchObject({ value: "126", unit: "mg/dL", flag: "High" });
  });

  it("does not extract the ratio row or the interpretation note from the PDF", async () => {
    const metrics = parseLabTable(await extractText(buildPdf(LAB_REPORT)));

    expect(metrics.some((m) => m.value === "4.7")).toBe(false); // Cholesterol/HDL Ratio
    expect(metrics.filter((m) => m.metric === "Fasting Blood Sugar")).toHaveLength(1); // only the real row, not the note
  });

  it("gives a page with no text layer (a scan) almost no text, so it is routed to image OCR", async () => {
    const blankPage = buildPdf([]);
    const text = await extractText(blankPage);

    expect(text.trim().length).toBeLessThan(40); // MIN_TEXT_CHARS_PER_PAGE in client-document.ts
  });

  it("releases the document through the loading task (PDFDocumentProxy.destroy does not exist in pdfjs 5+)", async () => {
    const { loadingTask } = await loadDocument(buildPdf(LAB_REPORT));

    expect(typeof loadingTask.destroy).toBe("function");
    await expect(loadingTask.destroy()).resolves.toBeUndefined();
  });
});