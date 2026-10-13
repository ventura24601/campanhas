// CLI local: node src/cli.js render <spec.json> <pastaDoJob> <saida> [barra,display,video|preview]
import fs from 'node:fs';
import path from 'node:path';
import { renderBar, renderDisplay, renderVideo, renderPreview, closeBrowser } from './render.js';

const [, , cmd, specFile, jobDir, outDir, kindsArg] = process.argv;
if (cmd !== 'render') { console.log('uso: node src/cli.js render spec.json pastaJob saida [barra,display,video|preview]'); process.exit(1); }
const spec = JSON.parse(fs.readFileSync(specFile, 'utf8'));
const kinds = (kindsArg || 'barra,display,video').split(',');
fs.mkdirSync(outDir, { recursive: true });
const t0 = Date.now();
try {
  if (kinds.includes('preview')) {
    const r = await renderPreview(spec, path.resolve(jobDir), path.resolve(outDir, 'previa'), ['video', 'barra', 'display']);
    console.log(JSON.stringify(r, null, 2));
  } else {
    if (kinds.includes('barra')) console.log(JSON.stringify(await renderBar(spec, path.resolve(jobDir), path.resolve(outDir))));
    if (kinds.includes('display')) console.log(JSON.stringify(await renderDisplay(spec, path.resolve(jobDir), path.resolve(outDir))));
    if (kinds.includes('video')) console.log(JSON.stringify(await renderVideo(spec, path.resolve(jobDir), path.resolve(outDir, 'video.mp4'))));
  }
} finally { await closeBrowser(); }
console.log(`ok em ${((Date.now() - t0) / 1000).toFixed(1)}s`);
