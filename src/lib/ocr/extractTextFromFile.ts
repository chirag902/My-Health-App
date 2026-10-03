
"use server";

import Tesseract from "tesseract.js";

export async function extractTextFromFile(filePath: string): Promise<string> {
  try {
    const { data } = await Tesseract.recognize(filePath, "eng", {
      logger: () => {},
    });

    return data.text || "";
  } catch (err: any) {
    console.error("OCR Error:", err.message);
    throw new Error("Failed to extract text from document");
  }
}
