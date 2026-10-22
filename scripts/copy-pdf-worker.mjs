// scripts/copy-pdf-worker.mjs
//
// Copies the PDF.js worker into public/ using the exact filename and
// format expected by the installed pdfjs-dist package.
//
// Compatible with Node.js ES modules and the existing npm postinstall script.

import {
  copyFile,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, "..");
const PUBLIC_DIR = path.join(PROJECT_ROOT, "public");

const PACKAGE_NAME = "pdfjs-dist";
const WORKER_RELATIVE_PATH = path.join("build", "pdf.worker.mjs");
const DESTINATION_NAME = "pdf.worker.mjs";

function log(message) {
  console.log(`[pdf-worker] ${message}`);
}

function fail(message, error) {
  console.error(`[pdf-worker] ERROR: ${message}`);

  if (error instanceof Error) {
    console.error(error.message);
  }

  process.exitCode = 1;
}

async function findPackageRoot() {
  // Resolve the installed package rather than assuming a particular
  // node_modules layout. This supports npm, pnpm and nested installations
  // when package resolution exposes pdfjs-dist normally.
  let packageJsonPath;

  try {
    packageJsonPath = require.resolve(`${PACKAGE_NAME}/package.json`);
  } catch {
    // Some package export maps block direct access to package.json.
    // Resolve the public entry point instead.
    const entryPoint = require.resolve(PACKAGE_NAME);
    let current = path.dirname(entryPoint);

    while (true) {
      const candidate = path.join(current, "package.json");

      try {
        const contents = JSON.parse(await readFile(candidate, "utf8"));

        if (contents.name === PACKAGE_NAME) {
          packageJsonPath = candidate;
          break;
        }
      } catch {
        // Continue walking toward the filesystem root.
      }

      const parent = path.dirname(current);

      if (parent === current) {
        throw new Error(
          `Could not locate ${PACKAGE_NAME}/package.json from ${entryPoint}`,
        );
      }

      current = parent;
    }
  }

  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));

  if (packageJson.name !== PACKAGE_NAME) {
    throw new Error(
      `Unexpected package resolved: ${packageJson.name ?? "unknown"}`,
    );
  }

  return {
    root: path.dirname(packageJsonPath),
    version: packageJson.version ?? "unknown",
  };
}

async function assertUsableFile(filePath) {
  const fileStats = await stat(filePath);

  if (!fileStats.isFile() || fileStats.size === 0) {
    throw new Error(`Worker file is missing or empty: ${filePath}`);
  }

  return fileStats;
}

async function main() {
  log(`Project root: ${PROJECT_ROOT}`);

  const { root: packageRoot, version } = await findPackageRoot();

  const sourcePath = path.join(packageRoot, WORKER_RELATIVE_PATH);
  const destinationPath = path.join(PUBLIC_DIR, DESTINATION_NAME);
  const temporaryPath = `${destinationPath}.tmp`;

  log(`pdfjs-dist version: ${version}`);

  await assertUsableFile(sourcePath);
  await mkdir(PUBLIC_DIR, { recursive: true });

  try {
    // Copy to a temporary file first so a failed copy doesn't leave a
    // partially written worker at the final destination.
    await rm(temporaryPath, { force: true });
    await copyFile(sourcePath, temporaryPath);

    const copiedStats = await assertUsableFile(temporaryPath);

    // Rename into place after the copy has completed successfully.
    await rename(temporaryPath, destinationPath);

    log(
      `Worker installed: public/${DESTINATION_NAME} ` +
        `(${copiedStats.size} bytes, pdfjs-dist ${version})`,
    );
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }

  // Source maps are optional. They are not required to execute the worker.
  const sourceMapPath = `${sourcePath}.map`;
  const destinationMapPath = `${destinationPath}.map`;

  try {
    await assertUsableFile(sourceMapPath);
    await copyFile(sourceMapPath, destinationMapPath);
    log("Optional worker source map copied.");
  } catch {
    await rm(destinationMapPath, { force: true }).catch(() => {});
    log("No worker source map available; continuing without it.");
  }
}

try {
  await main();
} catch (error) {
  fail(
    "Failed to prepare the PDF.js worker. Check that pdfjs-dist is installed and its worker file exists.",
    error,
  );
}