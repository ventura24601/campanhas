// Servidor do Estúdio de Campanhas IcomTV: interface web + API para a equipe.
import express from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DATA, criarJob, lerJob, listarJobs, revisarJob, aprovarJob, jobDir, retomarPendentes } from './jobs.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = express();
const PORT = Number(process.env.PORT || 8080);

if (!process.env.ANTHROPIC_API_KEY) console.warn('⚠️  ANTHROPIC_API_KEY não definida — o agente não vai rodar.');

// ---- acesso da equipe: usuário/senha (Basic Auth). EQUIPE="ana:senha1,cesar:senha2" ou APP_PASSWORD="senha" ----
const contas = new Map();
(process.env.EQUIPE || '').split(',').map((s) => s.trim()).filter(Boolean).forEach((p) => { const i = p.indexOf(':'); contas.set(p.slice(0, i), p.slice(i + 1)); });
if (process.env.APP_PASSWORD) contas.set('*', process.env.APP_PASSWORD);
const iguais = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
app.use((req, res, next) => {
  if (!contas.size || req.path === '/saude') return next();
  const h = req.headers.authorization || '';
  const [u, p] = Buffer.from(h.replace(/^Basic /, ''), 'base64').toString().split(':');
  const ok = (contas.has(u) && iguais(contas.get(u), p)) || (contas.has('*') && iguais(contas.get('*'), p));
  if (!ok) { res.set('WWW-Authenticate', 'Basic realm="Estudio IcomTV"'); return res.status(401).send('Acesso restrito'); }
  req.usuario = u || 'equipe';
  next();
});

app.use(express.json({ limit: '2mb' }));
app.get('/saude', (_req, res) => res.json({ ok: true }));
app.use(express.static(path.join(ROOT, 'public')));

const tmp = path.join(DATA, 'tmp');
fs.mkdirSync(tmp, { recursive: true });
const upload = multer({ dest: tmp, limits: { fileSize: 500 * 1024 * 1024, files: 7 } });

app.get('/api/jobs', (_req, res) => res.json(listarJobs()));
app.get('/api/jobs/:id', (req, res) => { const j = lerJob(req.params.id); if (!j) return res.status(404).json({ erro: 'não encontrado' }); res.json(j); });
app.post('/api/jobs', upload.fields([{ name: 'arquivos', maxCount: 6 }, { name: 'logo', maxCount: 1 }]), (req, res) => {
  const arquivos = req.files?.arquivos || [];
  const logo = req.files?.logo?.[0] || null;
  const descartar = () => [...arquivos, ...(logo ? [logo] : [])].forEach((f) => fs.rmSync(f.path, { force: true }));
  const b = req.body || {};
  const modo = b.modo === 'adaptar' ? 'adaptar' : 'criar';
  const hex = (v) => (/^#[0-9a-f]{6}$/i.test(String(v || '').trim()) ? String(v).trim().toUpperCase() : null);
  const erro = !arquivos.length ? (modo === 'adaptar' ? 'Envie o material pronto que será adaptado.' : 'Envie ao menos um arquivo de referência (vídeo, imagem ou PDF).')
    : modo === 'adaptar' && !logo ? 'Envie o logo da nova clínica.'
    : modo === 'adaptar' && !(b.clinica || '').trim() ? 'Informe o nome da nova clínica.'
    : null;
  if (erro) { descartar(); return res.status(400).json({ erro }); }
  const briefing = {
    modo,
    clinica: (b.clinica || '').trim(), campanha: (b.campanha || '').trim(), data: (b.data || '').trim(),
    oferta: (b.oferta || '').trim(), observacoes: (b.observacoes || '').trim(),
    pecas: (b.pecas || 'auto').trim(), usar_audio: b.usar_audio === 'true' || b.usar_audio === 'on',
  };
  if (modo === 'adaptar') {
    briefing.clinica_antiga = (b.clinica_antiga || '').trim();
    const cores = { principal: hex(b.cor_principal), destaque: hex(b.cor_destaque), fundo: hex(b.cor_fundo) };
    briefing.cores = b.cores === 'manual' && Object.values(cores).some(Boolean) ? { modo: 'manual', ...cores } : { modo: 'auto' };
  }
  res.json(criarJob({ briefing, arquivos, logo, autor: req.usuario }));
});
app.post('/api/jobs/:id/revisar', (req, res) => {
  const j = lerJob(req.params.id);
  if (!j) return res.status(404).json({ erro: 'não encontrado' });
  if (j.status === 'processando' || j.status === 'na_fila') return res.status(409).json({ erro: 'Job ainda em processamento.' });
  const c = (req.body?.comentario || '').trim();
  if (!c) return res.status(400).json({ erro: 'Escreva o comentário da revisão.' });
  res.json(revisarJob(j.id, c, req.usuario));
});
app.post('/api/jobs/:id/aprovar', (req, res) => { const j = lerJob(req.params.id); if (!j) return res.status(404).end(); res.json(aprovarJob(j.id, req.usuario)); });

// arquivos gerados (somente dentro da pasta do job)
app.get('/arquivos/:id/*caminho', (req, res) => {
  const j = lerJob(req.params.id);
  if (!j) return res.status(404).end();
  const base = jobDir(j.id);
  const rel = [].concat(req.params.caminho).join('/');
  const f = path.resolve(base, rel);
  if (!f.startsWith(base + path.sep) || !fs.existsSync(f)) return res.status(404).end();
  if (req.query.baixar) res.download(f, path.basename(f), { dotfiles: 'allow' }); else res.sendFile(f, { dotfiles: 'allow' });
});

app.listen(PORT, () => {
  console.log(`Estúdio de Campanhas IcomTV em http://localhost:${PORT}  (dados em ${DATA})`);
  retomarPendentes();
});
