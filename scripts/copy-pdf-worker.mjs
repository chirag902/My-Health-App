// scripts/copy-pdf-worker.mjs
import fs from 'fs';
import path from 'path';
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

// This script copies the pdf.worker.js file from the pdfjs-dist package to the public directory.
// This is necessary because the worker needs to be publicly accessible for the PDF parsing to work on the client-side.

try {
  const pdfjsDistPath = path.dirname(require.resolve('pdfjs-dist/package.json'));
  const pdfWorkerPath = path.join(pdfjsDistPath, 'build', 'pdf.worker.mjs');
  const pdfWorkerMapPath = path.join(pdfjsDistPath, 'build', 'pdf.worker.mjs.map');
  const publicPath = path.join(process.cwd(), 'public');

  if (!fs.existsSync(publicPath)) {
    fs.mkdirSync(publicPath, { recursive: true });
  }

  const destPath = path.join(publicPath, 'pdf.worker.js');
  const destMapPath = path.join(publicPath, 'pdf.worker.js.map');

  if (fs.existsSync(pdfWorkerPath)) {
    fs.copyFileSync(pdfWorkerPath, destPath);
    console.log('✅ Copied pdf.worker.js to public directory.');
  } else {
    console.error('❌ pdf.worker.mjs not found in pdfjs-dist build directory.');
    process.exit(1);
  }
  
  if (fs.existsSync(pdfWorkerMapPath)) {
    fs.copyFileSync(pdfWorkerMapPath, destMapPath);
    console.log('✅ Copied pdf.worker.js.map to public directory.');
  } else {
     console.warn('Could not find pdf.worker.mjs.map. Skipping copy.');
  }

} catch (error) {
  console.error('🚨 Error copying PDF worker files:', error);
  // Attempt to resolve the path manually if require.resolve fails in some environments
  try {
    const backupPath = path.join(process.cwd(), 'node_modules', 'pdfjs-dist', 'build', 'pdf.worker.mjs');
    if(fs.existsSync(backupPath)) {
        const publicPath = path.join(process.cwd(), 'public');
         if (!fs.existsSync(publicPath)) {
            fs.mkdirSync(publicPath, { recursive: true });
        }
        fs.copyFileSync(backupPath, path.join(publicPath, 'pdf.worker.js'));
        console.log('✅ Copied pdf.worker.js using backup path.');
    } else {
       console.error('❌ Backup path for pdf.worker.mjs also failed.');
       process.exit(1);
    }
  } catch(backupError) {
     console.error('🚨 Backup copy method also failed:', backupError);
     process.exit(1);
  }
}
