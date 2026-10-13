// Renderização das peças a partir do spec: barra (PNG), display A5 (PDF+PNG), vídeo (stills e MP4).
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
import { fontManifest } from './fonts.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TPL = path.join(ROOT, 'templates');
const pexec = promisify(execFile);
// Python das ferramentas: PYTHON no .env, senão o .venv do projeto, senão python3 do sistema
const VENV_PY = path.join(ROOT, '.venv', 'bin', 'python');
const PYTHON = process.env.PYTHON || (fs.existsSync(VENV_PY) ? VENV_PY : 'python3');

export function chromiumPath() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  // navegadores do Playwright (imagem Docker oficial usa /ms-playwright)
  for (const base of [process.env.PLAYWRIGHT_BROWSERS_PATH, '/ms-playwright', '/opt/pw-browsers'].filter(Boolean)) {
    if (!fs.existsSync(base)) continue;
    for (const d of fs.readdirSync(base).filter((x) => /^chromium-\d+$/.test(x)).sort().reverse()) {
      for (const sub of fs.readdirSync(path.join(base, d))) {
        const p = path.join(base, d, sub, 'chrome');
        if (sub.startsWith('chrome-linux') && fs.existsSync(p)) return p;
      }
    }
  }
  for (const p of ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome']) if (fs.existsSync(p)) return p;
  return undefined;
}

let _browser;
async function browser() {
  if (!_browser) _browser = await chromium.launch({ executablePath: chromiumPath(), args: ['--allow-file-access-from-files', '--disable-web-security', '--font-render-hinting=none'] });
  return _browser;
}
export async function closeBrowser() { if (_browser) { await _browser.close(); _browser = null; } }

const SIZES = { video: [1920, 1080], bar: [1920, 216], display: [559, 794] };

async function open(kind, spec, jobDir, { scale = 1 } = {}) {
  const b = await browser();
  const [w, h] = SIZES[kind];
  const page = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: scale });
  const fonts = fontManifest((spec.fontes_extras || []).map((f) => ({ family: f.familia, arquivo: path.resolve(jobDir, f.arquivo) })));
  const base = pathToFileURL(jobDir).href + '/';
  await page.addInitScript(({ spec, base, fonts }) => { window.__SPEC = spec; window.__BASE = base; window.__FONTS = fonts; }, { spec, base, fonts });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(pathToFileURL(path.join(TPL, `${kind}.html`)).href);
  try { await page.waitForFunction(() => window.__ready === true, null, { timeout: 30000 }); }
  catch (e) { throw new Error(`template ${kind} não ficou pronto: ${errors.join(' | ') || e.message}`); }
  page.__errors = errors;
  return page;
}

async function qaOf(page) { return page.evaluate(() => (window.__qa ? window.__qa() : [])); }

// Página → PDF vetorial do Chromium → SVG (texto em curvas, fotos embutidas)
async function toSvg(page, outSvg, w, h, fisico = {}) {
  const tmpPdf = outSvg.replace(/\.svg$/, '.tmp.pdf');
  await page.emulateMedia({ media: 'screen' });
  await page.pdf({ path: tmpPdf, width: fisico.pdfW || `${w}px`, height: fisico.pdfH || `${h}px`, printBackground: true, pageRanges: '1' });
  await py('pdf2svg', { pdf: tmpPdf, out: outSvg, w, h, ...(fisico.largura ? { largura: fisico.largura, altura: fisico.altura } : {}) });
  fs.rmSync(tmpPdf, { force: true });
  return outSvg;
}

export async function renderBar(spec, jobDir, outDir, { hd = true, svg = false } = {}) {
  fs.mkdirSync(outDir, { recursive: true });
  const p1 = await open('bar', spec, jobDir);
  const qa = await qaOf(p1);
  const f1 = path.join(outDir, 'barra_1920x216.png');
  await p1.screenshot({ path: f1 });
  const out = { barra: f1, qa };
  if (svg) out.barra_svg = await toSvg(p1, path.join(outDir, 'barra_1920x216.svg'), 1920, 216);
  await p1.close();
  if (hd) {
    const p2 = await open('bar', spec, jobDir, { scale: 2 });
    out.barra_hd = path.join(outDir, 'barra_3840x432.png');
    await p2.screenshot({ path: out.barra_hd });
    await p2.close();
  }
  return out;
}

export async function renderDisplay(spec, jobDir, outDir, { pdf = true, svg = false } = {}) {
  fs.mkdirSync(outDir, { recursive: true });
  const p = await open('display', spec, jobDir, { scale: 1748 / 559 });
  const qa = await qaOf(p);
  const png = path.join(outDir, 'display_A5.png');
  await p.screenshot({ path: png });
  const out = { display_png: png, qa };
  if (pdf) {
    out.display_pdf = path.join(outDir, 'display_A5.pdf');
    await p.pdf({ path: out.display_pdf, width: '148mm', height: '210mm', printBackground: true, preferCSSPageSize: true });
  }
  if (svg) out.display_svg = await toSvg(p, path.join(outDir, 'display_A5.svg'), 559, 794, { pdfW: '148mm', pdfH: '210mm', largura: '148mm', altura: '210mm' });
  await p.close();
  return out;
}

/** Stills do meio de cada cena (para prévia) + checagens. */
export async function renderVideoStills(spec, jobDir, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const p = await open('video', spec, jobDir);
  const qa = await qaOf(p);
  const scenes = await p.evaluate(() => window.__scenes);
  const stills = [];
  for (let i = 0; i < scenes.length; i++) {
    const s = scenes[i];
    const t = s.a + Math.min(4.2, (s.b - s.a) * 0.62);
    await p.evaluate((t) => window.render(t), t);
    const f = path.join(outDir, `cena${i + 1}.jpg`);
    await p.screenshot({ path: f, type: 'jpeg', quality: 85 });
    stills.push({ arquivo: f, rotulo: `cena ${i + 1} · ${s.tipo} · ${t.toFixed(1)}s` });
  }
  await p.close();
  return { stills, qa, cenas: scenes };
}

export async function renderVideo(spec, jobDir, outFile, { fps = 25, audio = null, onProgress } = {}) {
  const p = await open('video', spec, jobDir);
  const D = await p.evaluate(() => window.__duration);
  const N = Math.round(D * fps);
  const args = ['-v', 'error', '-y', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', '-'];
  if (audio) args.push('-i', audio); else args.push('-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo');
  args.push('-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-preset', 'medium', '-c:a', 'aac', '-shortest', '-movflags', '+faststart', outFile);
  const ff = spawn('ffmpeg', args, { stdio: ['pipe', 'inherit', 'inherit'] });
  const done = new Promise((res, rej) => ff.on('close', (c) => (c === 0 ? res() : rej(new Error('ffmpeg falhou: ' + c)))));
  for (let i = 0; i < N; i++) {
    await p.evaluate((t) => window.render(t), i / fps);
    const buf = await p.screenshot({ type: 'jpeg', quality: 92 });
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
    if (onProgress && i % 50 === 0) onProgress(i / N);
  }
  ff.stdin.end();
  await done;
  await p.close();
  return { video: outFile, duracao: D };
}

export async function py(cmd, args) {
  const { stdout } = await pexec(PYTHON, [path.join(ROOT, 'src', 'tools.py'), cmd, JSON.stringify(args)], { maxBuffer: 50 * 1024 * 1024 });
  return JSON.parse(stdout);
}

/** Prévia completa (barra + display + stills do vídeo) em uma folha, com lista de alertas. */
export async function renderPreview(spec, jobDir, outDir, kinds) {
  const items = [];
  let qa = [];
  if (kinds.includes('video')) {
    const v = await renderVideoStills(spec, jobDir, path.join(outDir, 'video'));
    qa = qa.concat(v.qa);
    const sh = await py('sheet', { items: v.stills, out: path.join(outDir, 'video_folha.jpg'), cols: 3, w: 640 });
    items.push({ tipo: 'video', arquivo: sh.arquivo });
  }
  if (kinds.includes('barra')) {
    const b = await renderBar(spec, jobDir, path.join(outDir, 'barra'), { hd: false });
    qa = qa.concat(b.qa);
    items.push({ tipo: 'barra', arquivo: b.barra });
  }
  if (kinds.includes('display')) {
    const d = await renderDisplay(spec, jobDir, path.join(outDir, 'display'), { pdf: false });
    qa = qa.concat(d.qa);
    const prev = await py('preview', { src: d.display_png, out: path.join(outDir, 'display_prev.jpg'), max: 900 });
    items.push({ tipo: 'display', arquivo: prev.preview });
  }
  return { items, qa: [...new Set(qa)] };
}

/** SVG → PNG transparente pelo Chromium (fiel a máscaras, gradientes e recortes), lado maior = max px. */
export async function rasterizarSvg(svgFile, outPng, max = 1600) {
  const b = await browser();
  const p = await b.newPage({ viewport: { width: 400, height: 400 } });
  await p.goto(pathToFileURL(svgFile).href);
  const { w, h } = await p.evaluate(() => {
    const s = document.documentElement, vb = s.viewBox && s.viewBox.baseVal;
    const bb = s.getBoundingClientRect();
    return { w: (vb && vb.width) || bb.width || 400, h: (vb && vb.height) || bb.height || 400 };
  });
  const z = max / Math.max(w, h);
  const W = Math.round(w * z), H = Math.round(h * z);
  await p.setViewportSize({ width: W, height: H });
  const dataUrl = 'data:image/svg+xml;base64,' + fs.readFileSync(svgFile).toString('base64');
  await p.goto('about:blank');
  await p.setContent(`<html style="margin:0;background:transparent"><body style="margin:0"><img src="${dataUrl}" style="width:${W}px;height:${H}px;display:block"></body></html>`);
  await p.waitForFunction(() => document.images[0]?.complete);
  await p.screenshot({ path: outPng, omitBackground: true });
  await p.close();
  return { arquivo: outPng, w: W, h: H };
}
