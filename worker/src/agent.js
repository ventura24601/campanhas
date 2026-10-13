// Agente Diretor de Arte: loop de ferramentas com a API do Claude.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import { py, renderPreview } from './render.js';
import { familiasDisponiveis } from './fonts.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SISTEMA = fs.readFileSync(path.join(ROOT, 'skill', 'SISTEMA.md'), 'utf8');
const SPEC_DOC = fs.readFileSync(path.join(ROOT, 'skill', 'SPEC.md'), 'utf8');
export const MODEL = process.env.CLAUDE_MODEL || 'claude-opus-5-5';
const MAX_TURNS = Number(process.env.AGENT_MAX_TURNS || 30);
let clientFactory = () => new Anthropic();
/** Para testes: injeta um cliente simulado. */
export function setClientFactory(f) { clientFactory = f; }

const TOOLS = [
  {
    name: 'ver_quadro',
    description: 'Abre um instante de um vídeo de referência em resolução cheia e devolve a prévia. Registra a origem "quadro_<video>_<t>" para recorte (coordenadas na prévia devolvida).',
    input_schema: { type: 'object', properties: { video: { type: 'string', description: 'id do vídeo, ex. "video1"' }, t: { type: 'number', description: 'segundos' } }, required: ['video', 't'] },
  },
  {
    name: 'ver_origem',
    description: 'Mostra a prévia de uma origem já registrada (página, imagem embutida, quadro, imagem) com suas dimensões de prévia, para escolher coordenadas de recorte.',
    input_schema: { type: 'object', properties: { origem: { type: 'string' } }, required: ['origem'] },
  },
  {
    name: 'recortar',
    description: 'Cria um asset (PNG) a partir de uma origem. "caixa" = [x0,y0,x1,y1] em pixels da PRÉVIA da origem; sem caixa usa a imagem inteira. Devolve a prévia do recorte sobre fundo xadrez para você conferir. O asset fica em "assets/<id>.png" — referencie pelo id em spec.assets.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'id curto do asset, ex. "mulher", "logo", "implante"' },
        origem: { type: 'string' },
        caixa: { type: 'array', items: { type: 'number' }, minItems: 4, maxItems: 4 },
        remover_fundo: { type: 'boolean', description: 'IA de remoção de fundo (pessoas, objetos 3D)' },
        claro_transparente: { type: 'boolean', description: 'torna transparente o fundo branco/claro (ícones, logos)' },
      },
      required: ['id', 'origem'],
    },
  },
  {
    name: 'paleta',
    description: 'Cores predominantes (hex e %) de uma origem, opcionalmente só dentro de uma caixa [x0,y0,x1,y1] em pixels da prévia.',
    input_schema: { type: 'object', properties: { origem: { type: 'string' }, caixa: { type: 'array', items: { type: 'number' } } }, required: ['origem'] },
  },
  {
    name: 'previa',
    description: 'Renderiza as peças a partir do spec e devolve imagens (vídeo: um quadro de cada cena; barra; display) + alertas automáticos (texto que não coube, fora do quadro, sobre imagem, asset inexistente). Use quantas vezes precisar.',
    input_schema: { type: 'object', properties: { spec: { type: 'object' }, pecas: { type: 'array', items: { type: 'string', enum: ['barra', 'display', 'video'] } } }, required: ['spec', 'pecas'] },
  },
  {
    name: 'finalizar',
    description: 'Entrega final. Só chame depois de uma prévia sem problemas.',
    input_schema: {
      type: 'object',
      properties: {
        spec: { type: 'object' },
        pecas: { type: 'array', items: { type: 'string', enum: ['barra', 'display', 'video'] } },
        referencia: { type: 'string', description: 'uma linha: o que foi recebido e o que foi gerado' },
        frases_novas: { type: 'array', items: { type: 'string' } },
        alertas: { type: 'array', items: { type: 'string' } },
      },
      required: ['spec', 'pecas', 'referencia', 'frases_novas', 'alertas'],
    },
  },
];

function imgBlock(file) {
  const ext = path.extname(file).toLowerCase();
  const media_type = ext === '.png' ? 'image/png' : 'image/jpeg';
  return { type: 'image', source: { type: 'base64', media_type, data: fs.readFileSync(file).toString('base64') } };
}
function toContent(blocos) {
  return blocos.map((b) => (b.tipo === 'imagem' ? imgBlock(b.arquivo) : { type: 'text', text: b.texto }));
}

// remove imagens antigas do histórico para controlar custo (mantém a 1ª mensagem e as últimas N mensagens)
function prune(messages, keepLast = 6) {
  messages.forEach((m, i) => {
    if (i === 0 || i >= messages.length - keepLast || !Array.isArray(m.content)) return;
    m.content.forEach((b) => {
      if (b.type === 'tool_result' && Array.isArray(b.content)) {
        b.content = b.content.map((c) => (c.type === 'image' ? { type: 'text', text: '[imagem antiga removida]' } : c));
      }
    });
  });
}

export function sistemaCompleto(hoje) {
  return `${SISTEMA}\n\n---\n# ANEXO — SPEC\n${SPEC_DOC}\n\n---\nFontes empacotadas disponíveis: ${familiasDisponiveis().join(', ')} (além das extraídas do PDF, se houver).\nData de hoje: ${hoje}.`;
}

/**
 * ctx: { jobDir, sources, fontes, log(msg), client? }
 * entrada: blocos iniciais (array) — retorna { spec, pecas, referencia, frases_novas, alertas, uso }
 */
export async function rodarAgente(ctx, blocosIniciais) {
  const client = ctx.client || clientFactory();
  const hoje = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const system = [{ type: 'text', text: sistemaCompleto(hoje), cache_control: { type: 'ephemeral' } }];
  const messages = [{ role: 'user', content: toContent(blocosIniciais) }];
  const uso = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, turnos: 0 };
  let nPrev = 0, ultimaPreviaOk = false;
  fs.mkdirSync(path.join(ctx.jobDir, 'assets'), { recursive: true });

  const impl = {
    async ver_quadro({ video, t }) {
      const s = ctx.sources[video];
      if (!s || s.tipo !== 'video') throw new Error(`vídeo "${video}" não existe`);
      const tt = Math.max(0, Math.min(Number(t), (s.duracao || 1) - 0.05));
      const id = `quadro_${video}_${tt.toFixed(1)}`;
      const out = path.join(ctx.jobDir, 'ref', `${id}.png`);
      const r = await py('frame', { file: s.arquivo, t: tt, out });
      ctx.sources[id] = { tipo: 'quadro', arquivo: r.arquivo, preview: r.preview, scale: r.scale, w: r.w, h: r.h, pw: r.pw, ph: r.ph };
      ctx.log?.(`Analisando quadro de ${tt.toFixed(1)} s`);
      return [{ type: 'text', text: `origem "${id}" — prévia ${r.pw}x${r.ph} px (original ${r.w}x${r.h})` }, imgBlock(r.preview)];
    },
    async ver_origem({ origem }) {
      const s = ctx.sources[origem];
      if (!s || !s.preview) throw new Error(`origem "${origem}" não existe ou não é recortável. Disponíveis: ${Object.keys(ctx.sources).join(', ')}`);
      return [{ type: 'text', text: `origem "${origem}" — prévia ${s.pw}x${s.ph} px` }, imgBlock(s.preview)];
    },
    async recortar({ id, origem, caixa, remover_fundo, claro_transparente }) {
      const s = ctx.sources[origem];
      if (!s || !s.arquivo || s.tipo === 'video') throw new Error(`origem "${origem}" inválida para recorte. Use ver_quadro para vídeos. Disponíveis: ${Object.keys(ctx.sources).join(', ')}`);
      const safe = String(id).replace(/[^a-zA-Z0-9_-]/g, '_');
      const out = path.join(ctx.jobDir, 'assets', `${safe}.png`);
      ctx.log?.(`Recortando "${safe}"${remover_fundo ? ' (removendo fundo)' : ''}`);
      const r = await py('crop', { src: s.arquivo, out, scale: s.scale || 1, caixa, remover_fundo: !!remover_fundo, claro_transparente: !!claro_transparente });
      return [{ type: 'text', text: `asset "${safe}" salvo em "assets/${safe}.png" (${r.w}x${r.h}). Use em spec.assets: "${safe}": {"arquivo":"assets/${safe}.png"}. Confira a prévia:` }, imgBlock(r.preview)];
    },
    async paleta({ origem, caixa }) {
      const s = ctx.sources[origem];
      if (!s || !s.arquivo || s.tipo === 'video') throw new Error(`origem "${origem}" inválida`);
      const r = await py('palette', { src: s.arquivo, scale: s.scale || 1, caixa });
      return [{ type: 'text', text: r.cores.map((c) => `${c.hex} ${c.pct}%`).join(' · ') }];
    },
    async previa({ spec, pecas }) {
      nPrev++;
      ctx.log?.(`Gerando prévia ${nPrev}`);
      spec.fontes_extras = spec.fontes_extras || [];
      const dir = path.join(ctx.jobDir, 'previas', `v${nPrev}`);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'spec.json'), JSON.stringify(spec, null, 2));
      const r = await renderPreview(spec, ctx.jobDir, dir, pecas);
      ultimaPreviaOk = r.qa.length === 0;
      const out = [{ type: 'text', text: r.qa.length ? `ALERTAS AUTOMÁTICOS:\n- ${r.qa.join('\n- ')}` : 'Sem alertas automáticos. Confira visualmente as imagens.' }];
      for (const it of r.items) {
        const pv = await py('preview', { src: it.arquivo, out: it.arquivo.replace(/\.(png|jpg)$/, '_ag.jpg'), max: 1568 });
        out.push({ type: 'text', text: `▼ ${it.tipo}` }, imgBlock(pv.preview));
      }
      ctx.ultimaPrevia = { dir, itens: r.items };
      return out;
    },
  };

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    prune(messages);
    const resp = await client.messages.stream({ model: MODEL, max_tokens: 16000, system, tools: TOOLS, messages }).finalMessage();
    uso.turnos++;
    uso.input_tokens += resp.usage?.input_tokens || 0;
    uso.output_tokens += resp.usage?.output_tokens || 0;
    uso.cache_read_input_tokens += resp.usage?.cache_read_input_tokens || 0;
    messages.push({ role: 'assistant', content: resp.content });
    const calls = resp.content.filter((b) => b.type === 'tool_use');
    if (!calls.length) {
      messages.push({ role: 'user', content: [{ type: 'text', text: 'Continue com as ferramentas. Termine chamando "finalizar".' }] });
      continue;
    }
    const results = [];
    for (const c of calls) {
      if (c.name === 'finalizar') {
        if (nPrev === 0) {
          results.push({ type: 'tool_result', tool_use_id: c.id, is_error: true, content: 'Gere ao menos uma "previa" do spec final antes de finalizar.' });
          continue;
        }
        fs.writeFileSync(path.join(ctx.jobDir, 'conversa.json'), JSON.stringify(messages.map((m) => ({ role: m.role, content: Array.isArray(m.content) ? m.content.map((b) => (b.type === 'image' ? '[img]' : b)) : m.content })), null, 1));
        return { ...c.input, uso, previa_ok: ultimaPreviaOk };
      }
      try {
        const content = await impl[c.name](c.input);
        results.push({ type: 'tool_result', tool_use_id: c.id, content });
      } catch (e) {
        results.push({ type: 'tool_result', tool_use_id: c.id, is_error: true, content: `Erro: ${e.message}` });
      }
    }
    messages.push({ role: 'user', content: results });
  }
  throw new Error(`O agente não finalizou em ${MAX_TURNS} turnos.`);
}
