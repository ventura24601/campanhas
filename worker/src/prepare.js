// Prepara as referências enviadas: gera folhas de contato, páginas, imagens embutidas, fontes e paletas.
import fs from 'node:fs';
import path from 'node:path';
import { py, rasterizarSvg } from './render.js';

const VIDEO = /\.(mp4|mov|m4v|webm|avi|mkv)$/i;
const PDF = /\.pdf$/i;
const IMG = /\.(png|jpe?g|webp|gif|bmp|tiff?)$/i;

/**
 * Retorna { sources, blocos, fontes, audio }
 *  sources: id → { tipo, arquivo, preview, scale, w, h }   (o agente usa ids e coordenadas da PRÉVIA)
 *  blocos:  [{ tipo:'texto', texto } | { tipo:'imagem', arquivo }]  → conteúdo da 1ª mensagem do agente
 */
export async function prepararReferencias(jobDir, entradas) {
  const work = path.join(jobDir, 'ref');
  fs.mkdirSync(work, { recursive: true });
  fs.mkdirSync(path.join(jobDir, 'fonts'), { recursive: true });
  const sources = {}, blocos = [], fontes = [];
  let audio = null, nVid = 0, nImg = 0, nPdf = 0;

  for (const e of entradas) {
    const f = e.arquivo;
    if (VIDEO.test(f)) {
      nVid++;
      const id = `video${nVid}`;
      const r = await py('video', { file: f, dir: path.join(work, id) });
      sources[id] = { tipo: 'video', arquivo: f, duracao: r.duracao };
      if (r.audio && !audio) audio = f;
      blocos.push({ tipo: 'texto', texto: `## Referência ${id} — VÍDEO "${e.nome}"\nDuração ${r.duracao.toFixed(1)} s, ${r.audio ? 'com' : 'sem'} áudio. Abaixo a folha de contato (um quadro a cada ~${(r.duracao / Math.max(1, r.tempos.length)).toFixed(1)} s, com o tempo no rótulo). Use \`ver_quadro\` com o id "${id}" para abrir qualquer instante em resolução cheia antes de recortar.` });
      blocos.push({ tipo: 'imagem', arquivo: r.contato });
      const pal = await py('palette', { src: r.contato });
      blocos.push({ tipo: 'texto', texto: `Paleta geral do vídeo: ${pal.cores.map((c) => `${c.hex} (${c.pct}%)`).join(', ')}` });
    } else if (PDF.test(f)) {
      nPdf++;
      const r = await py('pdf', { file: f, dir: path.join(work, `pdf${nPdf}`) });
      blocos.push({ tipo: 'texto', texto: `## Referência PDF "${e.nome}" — ${r.paginas.length} página(s)` });
      for (const p of r.paginas) {
        const id = r.paginas.length > 1 || nPdf > 1 ? `pdf${nPdf}_${p.id}` : p.id;
        sources[id] = { tipo: 'pagina', arquivo: p.arquivo, preview: p.preview, scale: p.scale, w: p.w, h: p.h, pw: p.pw, ph: p.ph };
        blocos.push({ tipo: 'texto', texto: `### ${id} — prévia ${p.pw}x${p.ph} px (coordenadas de recorte nesta prévia)\nTexto extraído:\n${p.texto.trim().slice(0, 3000)}` });
        blocos.push({ tipo: 'imagem', arquivo: p.preview });
        const pal = await py('palette', { src: p.arquivo });
        blocos.push({ tipo: 'texto', texto: `Paleta de ${id}: ${pal.cores.map((c) => `${c.hex} (${c.pct}%)`).join(', ')}` });
      }
      if (r.imagens.length) {
        const items = [];
        for (const im of r.imagens) {
          const id = nPdf > 1 ? `pdf${nPdf}_${im.id}` : im.id;
          sources[id] = { tipo: 'imagem_pdf', arquivo: im.arquivo, preview: im.preview, scale: im.scale, w: im.w, h: im.h, pw: im.pw, ph: im.ph };
          items.push({ arquivo: im.preview, rotulo: `${id} (${im.w}x${im.h})` });
        }
        const sh = await py('sheet', { items, out: path.join(work, `pdf${nPdf}_imagens.jpg`), cols: Math.min(4, items.length), w: 360 });
        blocos.push({ tipo: 'texto', texto: `Imagens embutidas no PDF (resolução original — prefira estas para fotos). Para usar a imagem inteira, chame \`recortar\` sem \`caixa\`. Para recortar parte dela, as coordenadas são na prévia de cada uma (largura máx. 640 px).` });
        blocos.push({ tipo: 'imagem', arquivo: sh.arquivo });
      }
      for (const fo of r.fontes) {
        if (!fo.arquivo) continue;
        const fam = fo.nome.replace(/[^A-Za-z0-9 _-]/g, '');
        const dst = path.join(jobDir, 'fonts', `${fam.replace(/\s+/g, '_')}${path.extname(fo.arquivo)}`);
        fs.copyFileSync(fo.arquivo, dst);
        fontes.push({ familia: fam, arquivo: path.relative(jobDir, dst), glifos: fo.glifos });
      }
    } else if (IMG.test(f)) {
      nImg++;
      const id = `ref${nImg}`;
      const r = await py('image', { file: f, dir: path.join(work, id) });
      sources[id] = { tipo: 'imagem', arquivo: r.arquivo, preview: r.preview, scale: r.scale, w: r.w, h: r.h, pw: r.pw, ph: r.ph };
      blocos.push({ tipo: 'texto', texto: `## Referência ${id} — IMAGEM "${e.nome}" — prévia ${r.pw}x${r.ph} px (coordenadas de recorte nesta prévia)` });
      blocos.push({ tipo: 'imagem', arquivo: r.preview });
      const pal = await py('palette', { src: r.arquivo });
      blocos.push({ tipo: 'texto', texto: `Paleta de ${id}: ${pal.cores.map((c) => `${c.hex} (${c.pct}%)`).join(', ')}` });
    } else {
      blocos.push({ tipo: 'texto', texto: `Arquivo "${e.nome}" ignorado (formato não suportado).` });
    }
  }
  if (fontes.length) {
    blocos.push({ tipo: 'texto', texto: `## Fontes extraídas do PDF (use em "fontes_extras" + "marca.fonte_titulo")\n${fontes.map((f) => `- família "${f.familia}" → arquivo "${f.arquivo}" — caracteres disponíveis: ${f.glifos ? JSON.stringify(f.glifos) : 'completo/desconhecido'}`).join('\n')}` });
  }
  return { sources, blocos, fontes, audio };
}

/**
 * Logo da nova clínica (modo adaptar). Mantém o vetor quando possível:
 *  SVG → assets/logo_cliente.svg · PDF → 1ª página convertida em SVG · imagem → assets/logo_cliente.png
 * Registra a origem "logo_cliente" (para recorte/paleta) e devolve os blocos que o agente vê.
 */
export async function prepararLogo(jobDir, entrada, sources) {
  const f = entrada.arquivo, ext = path.extname(f).toLowerCase();
  const work = path.join(jobDir, 'ref', 'logo');
  fs.mkdirSync(work, { recursive: true });
  fs.mkdirSync(path.join(jobDir, 'assets'), { recursive: true });
  let asset, png;
  if (ext === '.svg') {
    asset = 'assets/logo_cliente.svg';
    fs.copyFileSync(f, path.join(jobDir, asset));
    png = (await rasterizarSvg(path.join(jobDir, asset), path.join(work, 'logo.png'))).arquivo;
  } else if (ext === '.pdf') {
    const pg = (await py('pdf', { file: f, dir: work })).paginas[0];
    asset = 'assets/logo_cliente.svg';
    await py('pdf2svg', { pdf: f, out: path.join(jobDir, asset), w: pg.w, h: pg.h });
    png = (await rasterizarSvg(path.join(jobDir, asset), path.join(work, 'logo.png'))).arquivo;
  } else if (IMG.test(f)) {
    asset = 'assets/logo_cliente.png';
    png = (await py('image', { file: f, dir: work })).arquivo;
    fs.copyFileSync(png, path.join(jobDir, asset));
  } else {
    throw new Error(`Formato de logo não suportado: ${entrada.nome}. Use SVG, PDF, PNG ou JPG.`);
  }
  const r = await py('image', { file: png, dir: path.join(work, 'origem') });
  sources.logo_cliente = { tipo: 'imagem', arquivo: r.arquivo, preview: r.preview, scale: r.scale, w: r.w, h: r.h, pw: r.pw, ph: r.ph };
  const pal = await py('palette', { src: r.arquivo });
  const vetor = asset.endsWith('.svg');
  return [
    { tipo: 'texto', texto: `## LOGO DA NOVA CLÍNICA — "${entrada.nome}"${vetor ? ' (vetorial)' : ''}\nAsset pronto: "logo_cliente" → "${asset}". Coloque em spec.assets: "logo_cliente": {"arquivo":"${asset}"} e use em TODOS os lugares onde a referência tinha logo.${vetor ? ' É vetorial: não recorte, use como está.' : ' Se tiver fundo branco/sólido, gere uma versão transparente com `recortar` (id "logo_cliente", origem "logo_cliente", claro_transparente: true).'} Origem "logo_cliente" disponível para \`paleta\` (prévia ${r.pw}x${r.ph} px).` },
    { tipo: 'imagem', arquivo: r.preview },
    { tipo: 'texto', texto: `Paleta do logo: ${pal.cores.map((c) => `${c.hex} (${c.pct}%)`).join(', ')}` },
  ];
}
