// SVG editável: fundo/fotos/formas em vetor (PDF do Chromium → SVG, sem os textos)
// + cada linha de texto como <text> centralizado, com a fonte embutida.
import fs from 'node:fs';
import { arquivoDaFonte } from './fonts.js';

/** Roda na página: lê os textos já renderizados e agrupa em linhas visuais. */
function extrairTextos() {
  const cv = document.createElement('canvas').getContext('2d');
  const hex = (c) => {
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (!m) return { fill: '#000000', alpha: 1 };
    const [r, g, b, a = 1] = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
    return { fill: '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase(), alpha: a };
  };
  const opacidade = (el) => { let o = 1; for (let e = el; e && e !== document.documentElement; e = e.parentElement) o *= Number(getComputedStyle(e).opacity); return o; };
  const transformar = (t, tt) => (tt === 'uppercase' ? t.toUpperCase() : tt === 'lowercase' ? t.toLowerCase() : t);
  const runs = [];
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (w.nextNode()) {
    const n = w.currentNode;
    if (!n.textContent.trim()) continue;
    const el = n.parentElement, cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || el.closest('script,style')) continue;
    const op = opacidade(el);
    if (op < 0.01) continue;
    const fam = cs.fontFamily.split(',')[0].replace(/["']/g, '').trim();
    const size = parseFloat(cs.fontSize), weight = Number(cs.fontWeight) || 400;
    cv.font = `${cs.fontStyle} ${weight} ${size}px "${fam}"`;
    const asc = cv.measureText('Hg').fontBoundingBoxAscent;
    const { fill, alpha } = hex(cs.color);
    const base = { fam, size, weight, italic: cs.fontStyle === 'italic', fill, alpha: alpha * op, ls: cs.letterSpacing === 'normal' ? 0 : parseFloat(cs.letterSpacing) || 0, tt: cs.textTransform };
    // divide o nó por linha visual (caso quebre) medindo caractere a caractere
    const txt = n.textContent, r = document.createRange();
    let atual = null;
    for (let i = 0; i < txt.length; i++) {
      r.setStart(n, i); r.setEnd(n, i + 1);
      const rc = [...r.getClientRects()].find((x) => x.width > 0 || x.height > 0);
      if (!rc) { if (atual) atual.txt += txt[i]; continue; }
      if (!atual || Math.abs(rc.top - atual.top) > size * 0.5) {
        if (atual) runs.push(atual);
        atual = { ...base, txt: '', left: rc.left, right: rc.right, top: rc.top, baseline: rc.top + asc };
      }
      atual.txt += txt[i];
      atual.right = Math.max(atual.right, rc.right);
    }
    if (atual) runs.push(atual);
  }
  runs.forEach((x) => { x.txt = transformar(x.txt.replace(/\s+/g, ' '), x.tt); delete x.tt; });
  // linhas: mesma linha de base e encostados na horizontal
  runs.sort((a, b) => a.baseline - b.baseline || a.left - b.left);
  const linhas = [];
  for (const r of runs) {
    const l = linhas.find((l) => Math.abs(l.baseline - r.baseline) < r.size * 0.35 && r.left - l.right < r.size * 0.9 && r.left > l.left - 1);
    if (l) { l.runs.push(r); l.right = Math.max(l.right, r.right); }
    else linhas.push({ baseline: r.baseline, left: r.left, right: r.right, runs: [r] });
  }
  return linhas.map((l) => {
    l.runs.sort((a, b) => a.left - b.left);
    l.runs[0].txt = l.runs[0].txt.replace(/^ /, '');
    l.runs.at(-1).txt = l.runs.at(-1).txt.replace(/ $/, '');
    return { x: (l.left + l.right) / 2, y: l.baseline, runs: l.runs.filter((r) => r.txt) };
  }).filter((l) => l.runs.length);
}

/** Esconde os glifos (mantém layout e fundos) para o PDF de base sair sem texto. */
function esconderTextos() {
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT), nos = [];
  while (w.nextNode()) if (w.currentNode.textContent.trim() && !w.currentNode.parentElement.closest('script,style')) nos.push(w.currentNode);
  for (const n of nos) { const s = document.createElement('span'); s.style.visibility = 'hidden'; n.replaceWith(s); s.append(n); }
}

const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const n2 = (v) => Math.round(v * 100) / 100;

/** Extrai os textos e esconde-os na página. Devolve { linhas, fontes:[{family, weight, arquivo}] }. */
export async function prepararTextosEditaveis(page, manifest) {
  const linhas = await page.evaluate(extrairTextos);
  await page.evaluate(esconderTextos);
  const usadas = new Map();
  for (const l of linhas) for (const r of l.runs) {
    const f = arquivoDaFonte(manifest, r.fam, r.weight);
    if (f) usadas.set(`${f.family}|${f.weight}`, { family: f.family, weight: f.weight, arquivo: f.arquivo });
  }
  return { linhas, fontes: [...usadas.values()] };
}

/** Insere os textos editáveis (e as fontes embutidas) no SVG de base. */
export function comporSvgEditavel(svgBase, { linhas, fontes }) {
  const mime = (f) => (f.endsWith('.woff2') ? 'font/woff2' : f.endsWith('.woff') ? 'font/woff' : f.endsWith('.otf') ? 'font/otf' : 'font/ttf');
  const faces = fontes.map((f) => `@font-face{font-family:"${f.family}";font-weight:${f.weight};src:url(data:${mime(f.arquivo)};base64,${fs.readFileSync(f.arquivo).toString('base64')})}`).join('\n');
  const textos = linhas.map((l) => {
    const spans = l.runs.map((r) => `<tspan font-family="${xml(r.fam)}" font-size="${n2(r.size)}" font-weight="${r.weight}"${r.italic ? ' font-style="italic"' : ''} fill="${r.fill}"${r.alpha < 0.999 ? ` fill-opacity="${n2(r.alpha)}"` : ''}${r.ls ? ` letter-spacing="${n2(r.ls)}"` : ''}>${xml(r.txt)}</tspan>`).join('');
    return `<text x="${n2(l.x)}" y="${n2(l.y)}" text-anchor="middle" xml:space="preserve">${spans}</text>`;
  }).join('\n');
  const bloco = `<style>\n${faces}\n</style>\n<g id="textos">\n${textos}\n</g>\n`;
  return svgBase.replace(/<\/svg>\s*$/, `${bloco}</svg>\n`);
}
