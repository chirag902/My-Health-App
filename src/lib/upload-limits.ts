// src/lib/upload-limits.ts
//
// Just two numbers, with NO heavy imports (no pdfjs-dist). Kept separate from client-document.ts
// so a page can know these limits (e.g. to validate a file the instant it's picked) WITHOUT pulling
// in the ~1MB pdfjs-dist bundle before the user has actually chosen a PDF.

export const MAX_INPUT_BYTES = 15 * 1024 * 1024; // what we are willing to read locally
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024; // what we are willing to send (Vercel cap is ~4.5MB)