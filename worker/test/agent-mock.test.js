// Teste ponta a ponta SEM a API: um "modelo" roteirizado chama as ferramentas reais
// (preparar PDF → ver_origem → recortar → previa → finalizar) e o pipeline renderiza as peças.
import fs from 'node:fs';
import path from 'node:path';
process.env.DATA_DIR = process.env.DATA_DIR || path.resolve('test/.data');
const { setClientFactory } = await import('../src/agent.js');
const { criarJob, lerJob } = await import('../src/jobs.js');
const { closeBrowser } = await import('../src/render.js');

const spec = JSON.parse(fs.readFileSync('test/specs/implante.json', 'utf8'));
spec.fontes_extras = [{ familia: 'SALVAGER', arquivo: 'fonts/SALVAGER.ttf' }];
spec.assets = { mulher: { arquivo: 'assets/mulher.png' }, homem: { arquivo: 'assets/homem.png' }, implante: { arquivo: 'assets/implante.png' }, logo: { arquivo: 'assets/logo.png' } };
delete spec.display; // referência é o display → gerar vídeo + barra

const roteiro = [
  [{ name: 'ver_origem', input: { origem: 'pag1' } }],
  [{ name: 'recortar', input: { id: 'mulher', origem: 'img1' } }, { name: 'recortar', input: { id: 'homem', origem: 'img2' } },
   { name: 'recortar', input: { id: 'implante', origem: 'pag1', caixa: [700, 680, 840, 830], remover_fundo: true } },
   { name: 'recortar', input: { id: 'logo', origem: 'pag1', caixa: [445, 1094, 668, 1184], claro_transparente: true } },
   { name: 'paleta', input: { origem: 'pag1', caixa: [100, 100, 800, 200] } }],
  [{ name: 'previa', input: { spec, pecas: ['video', 'barra'] } }],
  [{ name: 'finalizar', input: { spec, pecas: ['video', 'barra'], referencia: 'Recebi o display do Implante Day (AKVO); gerei vídeo e barra.', frases_novas: ['Um dia inteiro dedicado ao seu implante.'], alertas: ['A data 26 de setembro já passou.'] } }],
];
let passo = 0;
const log = [];
setClientFactory(() => ({
  messages: {
    stream: (req) => ({
      finalMessage: async () => {
        // registra o que o "modelo" recebeu de volta das ferramentas
        const last = req.messages.at(-1);
        if (Array.isArray(last.content)) last.content.forEach((b) => { if (b.type === 'tool_result') log.push({ erro: !!b.is_error, txt: (Array.isArray(b.content) ? b.content.filter((c) => c.type === 'text').map((c) => c.text).join(' ') : b.content).slice(0, 160), imgs: Array.isArray(b.content) ? b.content.filter((c) => c.type === 'image').length : 0 }); });
        const calls = roteiro[passo++] || [];
        return { content: calls.map((c, i) => ({ type: 'tool_use', id: `t${passo}_${i}`, name: c.name, input: c.input })), usage: { input_tokens: 1000, output_tokens: 200 } };
      },
    }),
  },
}));

const tmp = path.join(process.env.DATA_DIR, 'up');
fs.mkdirSync(tmp, { recursive: true });
const up = path.join(tmp, 'ref.pdf');
fs.copyFileSync('test/fixtures/display_implante_day.pdf', up);
const job = criarJob({ briefing: { clinica: 'AKVO Odontologia', campanha: 'Implante Day', pecas: 'auto' }, arquivos: [{ originalname: 'display_implante_day.pdf', path: up }], autor: 'teste' });
const t0 = Date.now();
let j;
while (true) { await new Promise((r) => setTimeout(r, 1000)); j = lerJob(job.id); if (['revisao', 'erro'].includes(j.status)) break; }
await closeBrowser();
console.log(log.map((l) => `${l.erro ? '✗' : '✓'} ${l.txt}${l.imgs ? ` [+${l.imgs} img]` : ''}`).join('\n'));
console.log('\nSTATUS:', j.status, j.erro || '', `(${((Date.now() - t0) / 1000).toFixed(0)}s)`);
console.log('SAÍDAS:', JSON.stringify(j.saidas, null, 1));
console.log('NOTAS:', JSON.stringify(j.notas));
console.log('JOB_DIR:', path.join(process.env.DATA_DIR, 'jobs', j.id));
process.exit(j.status === 'revisao' ? 0 : 1);
