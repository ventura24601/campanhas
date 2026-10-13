/* Utilidades compartilhadas pelos templates (barra, display, vídeo).
   Recebe window.__SPEC, window.__BASE (url da pasta do job) e window.__FONTS. */
(function () {
  const S = window.__SPEC || {};
  const M = Object.assign({
    fundo: '#FFFFFF', texto: '#1F1F1F', texto_suave: '#3B3F4A', destaque: '#EC6895',
    destaque_texto: '#FFFFFF', fundo_claro: '#F2F2F2', fonte_titulo: 'Montserrat', fonte_texto: 'Montserrat',
    motivo: 'linhas', titulo_peso: 700,
  }, S.marca || {});
  const BASE = window.__BASE || '';

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  // **negrito** (cor do texto principal) e [[destaque]] (cor de destaque)
  function rich(s) {
    return esc(s).replace(/\[\[(.+?)\]\]/g, '<span class="ac">$1</span>').replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  }
  function arr(x) { return x == null ? [] : (Array.isArray(x) ? x : String(x).split('\n')); }
  function lines(x) { return arr(x).filter((l) => l !== '').map((l) => `<span class="ln">${rich(l)}</span>`).join(''); }
  function asset(id) {
    if (!id) return null;
    const a = S.assets && S.assets[id];
    if (!a) { (window.__WARN = window.__WARN || []).push(`asset "${id}" não existe em spec.assets`); return null; }
    return BASE + a.arquivo;
  }

  function injectBase() {
    const fonts = (window.__FONTS || []).map((f) => `@font-face{font-family:"${f.family}";src:url("${f.url}");font-weight:${f.weight};font-display:block}`).join('\n');
    const css = `${fonts}
:root{--bg:${M.fundo};--tx:${M.texto};--tx2:${M.texto_suave};--ac:${M.destaque};--actx:${M.destaque_texto};--light:${M.fundo_claro};
--ft:"${M.fonte_titulo}",serif;--fb:"${M.fonte_texto}",sans-serif;--tw:${M.titulo_peso}}
*{margin:0;padding:0;box-sizing:border-box}
html,body{background:var(--bg);overflow:hidden}
body{font-family:var(--fb);color:var(--tx2);position:relative;-webkit-font-smoothing:antialiased}
b{color:var(--tx);font-weight:700}
.ac{color:var(--ac);font-weight:700}
.ln{display:block;white-space:nowrap}
.ttl{font-family:var(--ft);color:var(--tx);font-weight:var(--tw)}
.ttl .ac{font-weight:inherit}
.c{text-align:center}
.fit{display:inline-block;width:max-content}
.pill{background:var(--ac);color:var(--actx);font-weight:700;border-radius:999px;white-space:nowrap;display:inline-flex;align-items:center;justify-content:center}
.pill b,.pill .ac{color:inherit}
`;
    const st = document.createElement('style'); st.textContent = css; document.head.prepend(st);
  }

  // corações concêntricos (motivo "coracoes")
  function heartPath(s) {
    const p = [];
    for (let i = 0; i <= 360; i += 4) {
      const t = i * Math.PI / 180;
      const x = 16 * Math.pow(Math.sin(t), 3);
      const y = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
      p.push(`${(x * s).toFixed(1)},${(y * s).toFixed(1)}`);
    }
    return 'M' + p.join(' L') + 'Z';
  }
  function hearts(cx, cy, n, s0, ds, o0, o1, sw) {
    let h = `<g class="rings" transform="translate(${cx},${cy})">`;
    for (let k = 0; k < n; k++) {
      const op = o0 + (o1 - o0) * k / Math.max(1, n - 1);
      h += `<path pathLength="1" d="${heartPath(s0 + k * ds)}" fill="none" stroke="var(--ac)" stroke-width="${sw || 1.8}" data-op="${op.toFixed(2)}" opacity="${op.toFixed(2)}"/>`;
    }
    return h + '</g>';
  }

  // Ajusta a fonte de cada [data-fit="maxW,maxH,min"] até caber. Marca data-overflow se não couber.
  function fitAll(root) {
    (root || document).querySelectorAll('[data-fit]').forEach((el) => {
      const [mw, mh, min] = el.dataset.fit.split(',').map(Number);
      let fs = parseFloat(getComputedStyle(el).fontSize);
      let g = 0;
      const over = () => el.offsetWidth > mw + 1 || (mh > 0 && el.offsetHeight > mh + 1);
      while (over() && fs > min && g++ < 300) { fs -= 1; el.style.fontSize = fs + 'px'; }
      if (over()) el.dataset.overflow = '1';
    });
  }

  // Checagens automáticas de qualidade: texto que não coube, fora do quadro, sobreposição texto x mídia.
  function qa(label, root, W, H) {
    const warn = [];
    const r0 = (root || document.body);
    r0.querySelectorAll('[data-overflow]').forEach((el) => warn.push(`${label}: texto não coube mesmo reduzido — "${el.textContent.trim().slice(0, 60)}"`));
    const texts = [...r0.querySelectorAll('[data-qa="texto"]')];
    const medias = [...r0.querySelectorAll('[data-qa="midia"]')];
    const rect = (e) => e.getBoundingClientRect();
    texts.forEach((t) => {
      const a = rect(t);
      if (a.width === 0) return;
      if (a.left < -1 || a.top < -1 || a.right > W + 1 || a.bottom > H + 1) warn.push(`${label}: texto sai do quadro — "${t.textContent.trim().slice(0, 50)}"`);
      medias.forEach((m) => {
        const b = rect(m);
        const ix = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const iy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (ix > 8 && iy > 8) warn.push(`${label}: texto sobrepõe imagem — "${t.textContent.trim().slice(0, 50)}"`);
      });
    });
    (window.__WARN || []).forEach((w) => warn.push(`${label}: ${w}`));
    return [...new Set(warn)];
  }

  async function loadFonts() {
    try { await Promise.all([...document.fonts].map((f) => f.load().catch(() => {}))); await document.fonts.ready; } catch (e) {}
  }
  window.T = { S, M, esc, rich, lines, arr, asset, injectBase, hearts, fitAll, qa, loadFonts };
})();
