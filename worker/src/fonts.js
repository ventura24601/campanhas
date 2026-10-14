// Catálogo de fontes: famílias empacotadas (@fontsource) + fontes extraídas do material do cliente.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FS_DIR = path.join(ROOT, 'node_modules', '@fontsource');

export const BUNDLED = {
  'Montserrat': 'montserrat',
  'Urbanist': 'urbanist',
  'Poppins': 'poppins',
  'Playfair Display': 'playfair-display',
  'Marcellus': 'marcellus',
  'Cormorant Garamond': 'cormorant-garamond',
  'DM Serif Display': 'dm-serif-display',
};

/** Retorna [{family, url, weight, arquivo}] para @font-face. extraidas: [{family, arquivo}] (caminhos absolutos).
 *  Usa .woff (não .woff2): o .woff2 empacotado traz nomes internos errados ("MontserratThin-Bold"),
 *  e esses nomes vão para o PDF — o Illustrator não reconheceria a fonte instalada. */
export function fontManifest(extraidas = []) {
  const out = [];
  for (const [family, slug] of Object.entries(BUNDLED)) {
    const dir = path.join(FS_DIR, slug, 'files');
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      const m = f.match(new RegExp(`^${slug}-latin-(\\d{3})-normal\\.woff$`));
      if (m) out.push({ family, url: pathToFileURL(path.join(dir, f)).href, weight: Number(m[1]), arquivo: path.join(dir, f) });
    }
  }
  for (const f of extraidas) {
    out.push({ family: f.family, url: pathToFileURL(f.arquivo).href, weight: 400, arquivo: f.arquivo });
  }
  return out;
}

/** Arquivo da fonte mais próxima de (família, peso) no manifesto. */
export function arquivoDaFonte(manifest, family, weight) {
  const c = manifest.filter((f) => f.family.toLowerCase() === String(family).toLowerCase());
  if (!c.length) return null;
  return c.reduce((a, b) => (Math.abs(b.weight - weight) < Math.abs(a.weight - weight) ? b : a));
}

export function familiasDisponiveis(extraidas = []) {
  return [...Object.keys(BUNDLED), ...extraidas.map((f) => f.family)];
}
