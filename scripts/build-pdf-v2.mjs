import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const outDir = path.join(repoRoot, 'dist');
const workerEntry = path.join(repoRoot, 'src/workers/pdfRender.worker.mjs');
const workerOutfile = path.join(outDir, 'pdfRender.worker.js');

async function main() {
  await mkdir(outDir, { recursive: true });

  await build({
    entryPoints: [workerEntry],
    outfile: workerOutfile,
    bundle: true,
    minify: true,
    sourcemap: false,
    format: 'iife',
    platform: 'browser',
    target: ['chrome114'],
    loader: {
      '.otf': 'dataurl'
    },
    legalComments: 'none',
    logLevel: 'info'
  });

  console.log(`[build:pdf-v2] Worker bundle generated at: ${path.relative(repoRoot, workerOutfile)}`);
}

main().catch((error) => {
  console.error('[build:pdf-v2] Build failed:', error);
  process.exit(1);
});
