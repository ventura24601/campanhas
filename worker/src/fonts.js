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

/** Retorna [{family, url, weight}] para @font-face. extraidas: [{family, arquivo}] (caminhos absolutos). */
export function fontManifest(extraidas = []) {
  const out = [];
  for (const [family, slug] of Object.entries(BUNDLED)) {
    const dir = path.join(FS_DIR, slug, 'files');
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      const m = f.match(new RegExp(`^${slug}-latin-(\\d{3})-normal\\.woff2$`));
      if (m) out.push({ family, url: pathToFileURL(path.join(dir, f)).href, weight: Number(m[1]) });
    }
  }
  for (const f of extraidas) {
    out.push({ family: f.family, url: pathToFileURL(f.arquivo).href, weight: 400 });
  }
  return out;
}

export function familiasDisponiveis(extraidas = []) {
  return [...Object.keys(BUNDLED), ...extraidas.map((f) => f.family)];
}
