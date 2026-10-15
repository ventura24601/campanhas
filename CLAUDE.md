# Estúdio de Campanhas IcomTV — guia para o Claude Code

App Node (ESM) em `worker/`. Ponto de entrada: `worker/src/server.js`.

- `src/jobs.js` — armazenamento dos jobs em `DATA_DIR/jobs/<id>/` (job.json, entrada/, ref/, assets/, previas/, saidas/vN/) + fila sequencial + pipeline.
- `src/prepare.js` — transforma as referências em "origens" (ids + prévias) e no conteúdo da 1ª mensagem do agente.
- `src/agent.js` — loop de tool use com `@anthropic-ai/sdk`. Ferramentas: ver_quadro, ver_origem, recortar, paleta, previa, finalizar. `setClientFactory` injeta cliente simulado nos testes.
- `src/render.js` — Playwright (playwright-core 1.63.0) abre `templates/{l,display,video}.html` (l = o L inteiro: lateral + barra, blocos da barra em `templates/barra.js`) com `window.__SPEC`, espera `window.__ready`, usa `window.__qa()` para checagens. Vídeo: `window.render(t)` quadro a quadro → ffmpeg via pipe.
- `src/tools.py` — Python: ffmpeg/PyMuPDF/fontTools/rembg/Pillow. Sempre imprime JSON no stdout.
- `templates/common.js` — texto rico (`**negrito**`, `[[destaque]]`), corações, fitAll (reduz fonte até caber), QA.

Regras de produto que não podem quebrar:
- Todo texto das peças é **centralizado**.
- Coordenadas de recorte são sempre na **prévia** da origem (`scale` converte para o original).
- Ao mudar o formato do spec, atualize `skill/SPEC.md` (o agente lê esse arquivo) e os specs de teste em `test/specs/`.

Testes: `npm test` (pipeline completo sem API) e `node src/cli.js render <spec> <pastaJob> <saida> preview`.
