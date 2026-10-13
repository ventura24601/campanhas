// Modo ADAPTAR sem a API: material pronto (display AKVO) + logo SVG da nova clínica → display adaptado em SVG.
import fs from 'node:fs';
import path from 'node:path';
process.env.DATA_DIR = process.env.DATA_DIR || path.resolve('test/.data');
const { setClientFactory } = await import('../src/agent.js');
const { criarJob, lerJob } = await import('../src/jobs.js');
const { closeBrowser } = await import('../src/render.js');

const spec = JSON.parse(fs.readFileSync('test/specs/implante.json', 'utf8'));
spec.clinica = 'Sorriso Odontologia';
spec.marca = { ...spec.marca, fundo: '#F1F7F6', texto: '#123B3A', destaque: '#0F6E6A', fundo_claro: '#DCEBE9' };
spec.fontes_extras = [{ familia: 'SALVAGER', arquivo: 'fonts/SALVAGER.ttf' }];
spec.assets = { mulher: { arquivo: 'assets/mulher.png' }, homem: { arquivo: 'assets/homem.png' }, implante: { arquivo: 'assets/implante.png' }, logo_cliente: { arquivo: 'assets/logo_cliente.svg' } };
spec.display.logo = 'logo_cliente';
const pecas = ['display'];

let primeira = null;
const roteiro = [
  [{ name: 'paleta', input: { origem: 'logo_cliente' } }, { name: 'recortar', input: { id: 'mulher', origem: 'img1' } }, { name: 'recortar', input: { id: 'homem', origem: 'img2' } },
   { name: 'recortar', input: { id: 'implante', origem: 'pag1', caixa: [700, 680, 840, 830], remover_fundo: true } }],
  [{ name: 'previa', input: { spec, pecas } }],
  [{ name: 'finalizar', input: { spec, pecas, referencia: 'Display AKVO adaptado para Sorriso Odontologia.', frases_novas: [], alertas: [] } }],
];
let passo = 0;
setClientFactory(() => ({ messages: { stream: (req) => ({ finalMessage: async () => {
  if (!primeira) primeira = req.messages[0].content;
  const calls = roteiro[passo++] || [];
  return { content: calls.map((c, i) => ({ type: 'tool_use', id: `t${passo}_${i}`, name: c.name, input: c.input })), usage: { input_tokens: 1000, output_tokens: 200 } };
} }) } }));

const tmp = path.join(process.env.DATA_DIR, 'up');
fs.mkdirSync(tmp, { recursive: true });
fs.copyFileSync('test/fixtures/display_implante_day.pdf', path.join(tmp, 'ref.pdf'));
fs.copyFileSync('test/fixtures/logo_sorriso.svg', path.join(tmp, 'logo.svg'));
const job = criarJob({
  briefing: { modo: 'adaptar', clinica: 'Sorriso Odontologia', clinica_antiga: 'AKVO Odontologia', pecas: 'auto', cores: { modo: 'auto' } },
  arquivos: [{ originalname: 'display_implante_day.pdf', path: path.join(tmp, 'ref.pdf') }],
  logo: { originalname: 'logo_sorriso.svg', path: path.join(tmp, 'logo.svg') }, autor: 'teste',
});
let j;
while (true) { await new Promise((r) => setTimeout(r, 1000)); j = lerJob(job.id); if (['revisao', 'erro'].includes(j.status)) break; }
await closeBrowser();
const dir = path.join(process.env.DATA_DIR, 'jobs', j.id);
const textos = primeira.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
const checks = {
  'status revisao': j.status === 'revisao',
  'briefing no modo ADAPTAR': textos.includes('MODO ADAPTAR') && textos.includes('Sorriso Odontologia'),
  'logo vetorial preparado': textos.includes('LOGO DA NOVA CLÍNICA') && fs.existsSync(path.join(dir, 'assets/logo_cliente.svg')),
  'display em SVG': !!j.saidas?.display_svg && fs.readFileSync(path.join(dir, j.saidas.display_svg), 'utf8').startsWith('<svg'),
  'SVG em 148mm': !!j.saidas?.display_svg && /width="148mm" height="210mm"/.test(fs.readFileSync(path.join(dir, j.saidas.display_svg), 'utf8').slice(0, 600)),
};
for (const [k, v] of Object.entries(checks)) console.log(`${v ? '✓' : '✗'} ${k}`);
console.log('STATUS:', j.status, j.erro || '', '\nSAÍDAS:', JSON.stringify(j.saidas, null, 1), '\nJOB_DIR:', dir);
process.exit(Object.values(checks).every(Boolean) ? 0 : 1);
