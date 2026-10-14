// Armazenamento de jobs em disco + fila sequencial + pipeline (preparar → agente → render final).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { prepararReferencias, prepararLogo } from './prepare.js';
import { rodarAgente, MODEL } from './agent.js';
import { renderBar, renderDisplay, renderVideo, py } from './render.js';

export const DATA = path.resolve(process.env.DATA_DIR || './data');
const JOBS = path.join(DATA, 'jobs');
fs.mkdirSync(JOBS, { recursive: true });

export const jobDir = (id) => path.join(JOBS, id);
const jobFile = (id) => path.join(jobDir(id), 'job.json');

export function lerJob(id) {
  if (!/^[a-z0-9-]+$/i.test(id)) return null;
  try { return JSON.parse(fs.readFileSync(jobFile(id), 'utf8')); } catch { return null; }
}
function salvar(job) { job.atualizado_em = new Date().toISOString(); fs.writeFileSync(jobFile(job.id), JSON.stringify(job, null, 2)); return job; }
function atualizar(id, fn) { const j = lerJob(id); fn(j); return salvar(j); }
function log(id, msg) { atualizar(id, (j) => { j.etapa = msg; j.historico.push({ em: new Date().toISOString(), msg }); }); }

export function listarJobs() {
  return fs.readdirSync(JOBS).map(lerJob).filter(Boolean)
    .sort((a, b) => b.criado_em.localeCompare(a.criado_em))
    .map(({ id, criado_em, status, etapa, briefing, pecas, notas, versao, autor }) => ({ id, criado_em, status, etapa, modo: briefing.modo || 'criar', clinica: briefing.clinica, campanha: briefing.campanha, pecas, referencia: notas?.referencia, versao, autor }));
}

export function criarJob({ briefing, arquivos, logo = null, autor }) {
  const id = `${new Date().toISOString().slice(0, 10)}-${crypto.randomBytes(3).toString('hex')}`;
  const dir = jobDir(id);
  fs.mkdirSync(path.join(dir, 'entrada'), { recursive: true });
  const entradas = arquivos.map((a, i) => {
    const nome = a.originalname.replace(/[^\w.\- ]+/g, '_');
    const dst = path.join(dir, 'entrada', `${i + 1}_${nome}`);
    fs.renameSync(a.path, dst);
    return { nome: a.originalname, arquivo: dst };
  });
  let logoEntrada = null;
  if (logo) {
    const dst = path.join(dir, 'entrada', `logo_${logo.originalname.replace(/[^\w.\- ]+/g, '_')}`);
    fs.renameSync(logo.path, dst);
    logoEntrada = { nome: logo.originalname, arquivo: dst };
  }
  const job = { id, criado_em: new Date().toISOString(), autor: autor || null, status: 'na_fila', etapa: 'Na fila', briefing, entradas, logo: logoEntrada, pecas: null, spec: null, saidas: null, notas: null, versao: 0, revisoes: [], historico: [{ em: new Date().toISOString(), msg: 'Job criado' }], uso: { input_tokens: 0, output_tokens: 0 } };
  salvar(job);
  enfileirar(() => processar(id));
  return job;
}

export function revisarJob(id, comentario, autor) {
  const j = atualizar(id, (j) => { j.status = 'na_fila'; j.etapa = 'Revisão na fila'; j.revisoes.push({ em: new Date().toISOString(), comentario, autor: autor || null }); });
  enfileirar(() => processar(id, comentario));
  return j;
}
export function aprovarJob(id, autor) { return atualizar(id, (j) => { j.status = 'aprovado'; j.etapa = 'Aprovado'; j.aprovado_por = autor || null; j.historico.push({ em: new Date().toISOString(), msg: `Aprovado${autor ? ' por ' + autor : ''}` }); }); }

// ---------- fila ----------
let cadeia = Promise.resolve();
function enfileirar(fn) { cadeia = cadeia.then(fn).catch((e) => console.error(e)); }
export function retomarPendentes() {
  for (const j of fs.readdirSync(JOBS).map(lerJob).filter(Boolean)) {
    if (j.status === 'na_fila' || j.status === 'processando') { const c = j.status === 'processando' && j.revisoes.length ? j.revisoes.at(-1).comentario : null; enfileirar(() => processar(j.id, c)); }
  }
}

function briefingTexto(b) {
  if (b.modo === 'adaptar') {
    const c = b.cores || { modo: 'auto' };
    const cores = c.modo === 'manual'
      ? [c.principal && `- Cor principal (títulos, **negrito**): ${c.principal} → marca.texto`, c.destaque && `- Cor de destaque (pílulas, linhas, [[destaque]]): ${c.destaque} → marca.destaque`, c.fundo && `- Cor de fundo: ${c.fundo} → marca.fundo`].filter(Boolean).join('\n') + '\nUse exatamente estes hex. Derive as cores que faltarem (texto_suave, fundo_claro, destaque_texto) em harmonia com elas e com bom contraste.'
      : 'Automático: derive a paleta do LOGO DA NOVA CLÍNICA (use `paleta` na origem "logo_cliente"). Mantenha a mesma lógica de uso de cor da referência (onde era fundo claro continua fundo claro etc.) e garanta contraste legível.';
    return [
      `# BRIEFING — MODO ADAPTAR (trocar a marca de um material pronto)`,
      `Nova clínica: ${b.clinica}`,
      b.clinica_antiga ? `Clínica que aparece no material enviado (substituir): ${b.clinica_antiga}` : `Clínica que aparece no material enviado: identifique na referência e substitua.`,
      b.campanha ? `Campanha: ${b.campanha}` : null,
      `## Cores da nova marca\n${cores}`,
      b.observacoes ? `Observações da equipe: ${b.observacoes}` : null,
      `Peças pedidas: ${b.pecas && b.pecas !== 'auto' ? b.pecas : 'auto (as MESMAS peças do material enviado)'}`,
    ].filter(Boolean).join('\n');
  }
  const linhas = [
    `# BRIEFING — MODO CRIAR (gerar as peças que faltam)`,
    `Clínica: ${b.clinica || '(não informado — extraia da referência)'}`,
    `Campanha: ${b.campanha || '(não informado)'}`,
    b.data ? `Data da campanha/sorteio: ${b.data}` : null,
    b.oferta ? `Oferta / prêmio: ${b.oferta}` : null,
    b.observacoes ? `Observações da equipe: ${b.observacoes}` : null,
    `Peças pedidas: ${b.pecas && b.pecas !== 'auto' ? b.pecas : 'auto (gere as que faltam, conforme a tabela)'}`,
  ].filter(Boolean);
  return linhas.join('\n');
}

async function processar(id, comentario = null) {
  const dir = jobDir(id);
  try {
    atualizar(id, (j) => { j.status = 'processando'; });
    let job = lerJob(id);
    let ctx;
    const ctxFile = path.join(dir, 'contexto.json');
    if (fs.existsSync(ctxFile)) ctx = JSON.parse(fs.readFileSync(ctxFile, 'utf8'));
    else {
      log(id, 'Analisando referências');
      const prep = await prepararReferencias(dir, job.entradas);
      const logoBlocos = job.logo ? await prepararLogo(dir, job.logo, prep.sources) : [];
      ctx = { ...prep, blocosIniciais: [{ tipo: 'texto', texto: briefingTexto(job.briefing) }, ...prep.blocos, ...logoBlocos] };
      fs.writeFileSync(ctxFile, JSON.stringify(ctx, null, 1));
    }
    let blocos = ctx.blocosIniciais;
    if (comentario && job.spec) {
      const prev = [];
      const s = job.saidas || {};
      if (s.previa_video) prev.push({ tipo: 'imagem', arquivo: path.join(dir, s.previa_video) });
      if (s.barra) prev.push({ tipo: 'imagem', arquivo: path.join(dir, s.barra) });
      if (s.display_png) prev.push({ tipo: 'imagem', arquivo: path.join(dir, s.display_prev || s.display_png) });
      blocos = [...blocos, { tipo: 'texto', texto: `# REVISÃO\nVersão atual entregue (peças: ${job.pecas.join(', ')}). Spec atual:\n\`\`\`json\n${JSON.stringify(job.spec)}\n\`\`\`\nImagens da versão atual a seguir. COMENTÁRIO DA EQUIPE: "${comentario}"\nAltere somente o que foi pedido, gere prévia e finalize.` }, ...prev];
    }
    log(id, comentario ? 'Agente aplicando a revisão' : 'Agente criando as peças');
    const ag = { jobDir: dir, sources: ctx.sources, fontes: ctx.fontes, log: (m) => log(id, m) };
    const r = await rodarAgente(ag, blocos);
    fs.writeFileSync(ctxFile, JSON.stringify(ctx, null, 1)); // sources ganham quadros novos

    // render final
    const versao = (job.versao || 0) + 1;
    const outRel = path.join('saidas', `v${versao}`);
    const out = path.join(dir, outRel);
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, 'spec.json'), JSON.stringify(r.spec, null, 2));
    const saidas = {};
    const alertasRender = [];
    const fontesUsadas = [];
    const nome = `${(r.spec.clinica || job.briefing.clinica || 'CLINICA')}_${(r.spec.campanha || job.briefing.campanha || 'CAMPANHA')}`.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').toUpperCase();
    if (r.pecas.includes('barra')) {
      log(id, 'Renderizando a barra');
      const b = await renderBar(r.spec, dir, out, { svg: true });
      const fs_ = path.join(out, `${nome}_BARRA_1920x216.svg`), fpd = path.join(out, `${nome}_BARRA_1920x216.pdf`), f1 = path.join(out, `${nome}_BARRA_1920x216.png`), f2 = path.join(out, `${nome}_BARRA_3840x432.png`);
      fs.renameSync(b.barra_svg, fs_); fs.renameSync(b.barra_pdf, fpd); fs.renameSync(b.barra, f1); fs.renameSync(b.barra_hd, f2);
      saidas.barra_svg = path.relative(dir, fs_); saidas.barra_pdf = path.relative(dir, fpd); saidas.barra = path.relative(dir, f1); saidas.barra_hd = path.relative(dir, f2);
      fontesUsadas.push(...(b.fontes || []));
      alertasRender.push(...b.qa);
    }
    if (r.pecas.includes('display')) {
      log(id, 'Renderizando o display A5');
      const d = await renderDisplay(r.spec, dir, out, { svg: true });
      const fsv = path.join(out, `${nome}_DISPLAY_A5.svg`), fp = path.join(out, `${nome}_DISPLAY_A5.pdf`), fg = path.join(out, `${nome}_DISPLAY_A5.png`);
      fs.renameSync(d.display_svg, fsv); fs.renameSync(d.display_pdf, fp); fs.renameSync(d.display_png, fg);
      saidas.display_svg = path.relative(dir, fsv);
      fontesUsadas.push(...(d.fontes || []));
      const pv = await py('preview', { src: fg, out: path.join(out, 'display_prev.jpg'), max: 1100 });
      saidas.display_pdf = path.relative(dir, fp); saidas.display_png = path.relative(dir, fg); saidas.display_prev = path.relative(dir, pv.preview);
      alertasRender.push(...d.qa);
    }
    if (r.pecas.includes('video')) {
      log(id, 'Renderizando o vídeo (≈1–2 min)');
      const fv = path.join(out, `${nome}_VIDEO_40s.mp4`);
      const audio = job.briefing.usar_audio && ctx.audio ? ctx.audio : null;
      await renderVideo(r.spec, dir, fv, { audio, onProgress: (p) => atualizar(id, (j) => { j.etapa = `Renderizando o vídeo ${Math.round(p * 100)}%`; }) });
      saidas.video = path.relative(dir, fv);
      if (ctx_has(ag)) { const last = ag.ultimaPrevia; const vf = last?.itens?.find((i) => i.tipo === 'video'); if (vf) { const dst = path.join(out, 'video_cenas.jpg'); fs.copyFileSync(vf.arquivo, dst); saidas.previa_video = path.relative(dir, dst); } }
    }
    if (fontesUsadas.length) {
      const fz = path.join(out, `${nome}_FONTES.zip`);
      await py('fontes_zip', { fontes: [...new Map(fontesUsadas.map((f) => [`${f.family}|${f.weight}`, f])).values()], out: fz });
      saidas.fontes_zip = path.relative(dir, fz);
    }
    atualizar(id, (j) => {
      j.status = 'revisao'; j.etapa = 'Pronto para revisão'; j.versao = versao; j.spec = r.spec; j.pecas = r.pecas; j.saidas = saidas;
      j.notas = { referencia: r.referencia, frases_novas: r.frases_novas || [], alertas: [...(r.alertas || []), ...alertasRender.map((a) => `Checagem automática: ${a}`)] };
      j.uso.input_tokens += r.uso.input_tokens; j.uso.output_tokens += r.uso.output_tokens; j.uso.modelo = MODEL;
      j.historico.push({ em: new Date().toISOString(), msg: `Versão ${versao} pronta (${r.uso.turnos} passos do agente)` });
    });
  } catch (e) {
    console.error(e);
    atualizar(id, (j) => { j.status = 'erro'; j.etapa = 'Erro'; j.erro = String(e.message || e); j.historico.push({ em: new Date().toISOString(), msg: `Erro: ${e.message || e}` }); });
  }
}
function ctx_has(ag) { return ag && ag.ultimaPrevia; }
