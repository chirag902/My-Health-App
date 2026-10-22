// src/lib/prepare-upload.ts  (browser only)
//
// Shrinks phone photos BEFORE upload: a 5-8MB photo becomes ~300-600KB.
// Fixes three things at once: Vercel's 4.5MB body limit, slow uploads from
// India to a US region, and OCR time on the server.
//
// Usage in health-records.tsx, after your type check and before building FormData:
//
//   const uploadFile = await prepareUpload(file);
//   if (uploadFile.size > MAX_UPLOAD_BYTES) { ...toast "too large"... return; }
//   formData.append("document", uploadFile);
//
// Also change MAX_FILE_SIZE in the component from 10MB to 4MB for PDFs.

const MAX_SIDE = 2000;
const JPEG_QUALITY = 0.85;

export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

export async function prepareUpload(file: File): Promise<File> {
  if (!file.type.startsWith("image/")) {
    return file; // PDFs go as-is
  }

  try {
    const bitmap = await createImageBitmap(file, {
      imageOrientation: "from-image",
    });

    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close();
      return file;
    }

    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY)
    );

    if (!blob || blob.size >= file.size) {
      return file; // compression didn't help; keep original
    }

    return new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", {
      type: "image/jpeg",
    });
  } catch {
    return file; // never block the upload because compression failed
  }
}