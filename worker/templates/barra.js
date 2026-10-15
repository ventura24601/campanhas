/* Blocos da barra inferior do L (texto · prêmio · pílula · cta), lado a lado e centralizados.
   T.montarBarra(row, blocos, larguraTotal, larguras?) — row é um flex container com altura 216. */
(function () {
  const { M, rich, lines, asset, logoParceiro, hearts } = window.T;
  const PESO = { texto: 1.05, premio: 1.15, imagem_texto: 1.15, pilula: 1.75, cta: 0.95 };
  const blk = (txt, size, maxW, maxH, min, css) => `<div class="blk" data-qa="texto" data-fit="${maxW},${maxH},${min}" style="font-size:${size}px;line-height:1.18;${css || ''}">${lines(txt)}</div>`;

  function montarBarra(row, blocos, total, larguras) {
    const soma = blocos.reduce((s, b) => s + (PESO[b.tipo] || 1), 0);
    const widths = larguras && larguras.length === blocos.length ? larguras : blocos.map((b) => Math.round(total * (PESO[b.tipo] || 1) / soma));
    const icon = asset(M.icone);
    blocos.forEach((b, i) => {
      const w = widths[i] || 600;
      if (i > 0) row.insertAdjacentHTML('beforeend', '<div class="sep"></div>');
      let h = '';
      const inner = w - 60;
      const logo = logoParceiro(b.logo);
      if (b.tipo === 'texto') {
        h = `<div class="stack">${b.titulo ? blk(b.titulo, 36, inner, 50, 22, 'color:var(--ac);font-weight:800') : ''}${blk(b.texto, b.tamanho || 25, inner, b.titulo ? 112 : 170, 17)}</div>`;
      } else if (b.tipo === 'premio' || b.tipo === 'imagem_texto') {
        const img = b.imagem ? `<div class="circ" data-qa="midia"><img src="${asset(b.imagem)}" style="object-position:${b.posicao || '50% 50%'}"></div>` : '';
        const tw = inner - (img ? 200 : 0);
        h = `${img}<div class="stack">${blk(b.titulo, 36, tw, 92, 20, 'color:var(--ac);font-weight:800')}${b.texto ? blk(b.texto, 23, tw, 60, 16) : ''}${logo ? `<img src="${asset(logo)}" style="max-height:${b.texto ? 40 : 56}px;max-width:${tw}px;margin-top:6px">` : ''}</div>`;
      } else if (b.tipo === 'pilula') {
        // pílula grande (ex.: data) com objeto opcional na ponta direita; tudo em "em" para escalar junto quando o texto reduz
        const img = b.imagem ? `<img src="${asset(b.imagem)}" style="position:absolute;height:${b.escala_imagem || 3.1}em;right:-1.25em;top:50%;transform:translateY(-50%)">` : '';
        h = `<div class="blk" data-qa="texto" data-fit="${inner},0,18" style="position:relative;font-size:${b.tamanho || 46}px;${img ? 'padding-right:1.1em' : ''}"><span class="pill" style="font-size:inherit;padding:.28em ${img ? 1.9 : 0.9}em .32em .9em">${rich(b.texto)}</span>${img}</div>`;
      } else if (b.tipo === 'cta') {
        const bg = (M.motivo === 'coracoes') ? `<svg class="bg" width="${w}" height="216">${hearts(w / 2, 96, 9, 12.5, 3.6, 0.15, 0.55)}</svg>` : '';
        const sel = b.selo ? `<div style="display:inline-flex;align-items:center;margin-top:8px">${icon ? `<img src="${icon}" style="height:48px;margin-right:-6px;position:relative;z-index:2">` : ''}<span class="pill" style="font-size:22px;padding:7px 22px 8px;${icon ? 'border-radius:0 8px 8px 0' : ''}">${rich(b.selo)}</span></div>` : '';
        const titulo = b.estilo === 'titulo'; // as duas linhas na fonte de título (ex.: "SAIBA MAIS / NA RECEPÇÃO")
        const l1 = titulo ? 'font-family:var(--ft);font-weight:var(--tw);color:var(--tx);line-height:1.05' : 'font-weight:400;color:var(--tx)';
        const l2 = titulo ? l1 : 'font-weight:800;color:var(--ac)';
        h = `${bg}<div class="stack" style="position:relative;gap:0">${blk(b.linha1 || 'Saiba mais', titulo ? 40 : 50, inner, 58, 22, l1)}${blk(b.linha2 || '[[na recepção]]', titulo ? 40 : 60, inner, 66, 22, l2)}${sel}</div>`;
      }
      row.insertAdjacentHTML('beforeend', `<div class="bk" style="width:${w}px;flex:none">${h}</div>`);
    });
  }

  window.T.montarBarra = montarBarra;
  window.T.cssBarra = `
.bk{position:relative;display:flex;align-items:center;justify-content:center;gap:26px;padding:0 26px;text-align:center;overflow:visible}
.sep{width:2px;align-self:center;height:132px;background:linear-gradient(transparent,var(--ac),transparent);opacity:.45;flex:none}
.stack{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px}
.blk{display:inline-block;width:max-content;text-align:center}
.circ{width:170px;height:170px;border-radius:50%;overflow:hidden;flex:none;box-shadow:0 0 0 6px var(--bg),0 0 0 8px var(--ac)}
.circ img{width:100%;height:100%;object-fit:cover}
svg.bg{position:absolute;left:0;top:0}`;
})();
