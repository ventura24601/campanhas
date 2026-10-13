# Estúdio de Campanhas IcomTV

Sistema interno onde a equipe envia **uma peça de referência** (vídeo, imagem ou PDF) e um **agente com a API do Claude** cria as outras peças da campanha, sempre com texto centralizado e a identidade visual da referência:

| Peça | Saída |
|---|---|
| Barra em L | **SVG** 1920×216 (vetor, texto em curvas) + PNG 1920×216 e HD 3840×432 |
| Vídeo | MP4 1920×1080, 25 fps, ~40 s (6 cenas animadas) |
| Display de mesa | **SVG** A5 (148×210 mm) + PDF vetorial para impressão + PNG 300 dpi |

Dois modos na tela "Nova campanha":
- **Criar as peças que faltam** — envia uma peça da campanha; o agente cria as outras.
- **Adaptar para outra clínica** — envia um material pronto + o logo da nova clínica (SVG/PDF mantém o vetor; PNG/JPG também servem) + o nome; o agente entrega as mesmas peças trocando logo, cores (extraídas do logo ou definidas na tela) e nome da clínica.

Os SVGs saem do PDF vetorial do Chromium convertido pelo PyMuPDF (`tools.py pdf2svg`): o texto vira curvas, então abrem iguais em qualquer programa, sem precisar das fontes.

Fluxo: **Nova campanha → agente analisa, recorta imagens, gera prévias e se corrige → render final → revisão da equipe (aprovar ou "refazer com ajuste")**.

## Como funciona

```
navegador (equipe) ──► worker/src/server.js  (Express, login da equipe, fila)
                          │
                          ├─ prepare.js   folha de contato do vídeo, páginas/imagens/fontes do PDF, paletas
                          ├─ agent.js     loop de ferramentas com a API do Claude
                          │                 ver_quadro · ver_origem · recortar (remoção de fundo) · paleta · previa · finalizar
                          │                 instruções: worker/skill/SISTEMA.md + SPEC.md
                          └─ render.js    templates HTML (worker/templates) → Chromium → PNG / PDF / MP4 (ffmpeg)
```

O agente **não desenha pixel a pixel**: ele preenche um *spec* JSON (cores, fontes, textos, cenas, recortes) e os templates garantem o padrão visual. Os alertas automáticos (texto que não coube, fora do quadro, sobre imagem) voltam para o agente a cada prévia.

## Rodar localmente (ou no Claude Code)

Requisitos: Node 22+, Python 3.10+, ffmpeg, Chromium.

```bash
cd worker
npm install
pip install -r requirements.txt          # Pillow, PyMuPDF, fontTools, rembg, onnxruntime
npx playwright-core install chromium     # se não tiver Chromium (ou defina CHROMIUM_PATH)
cp .env.example .env                     # coloque sua ANTHROPIC_API_KEY e as senhas da equipe
npm start                                # http://localhost:8080
```

Testes sem gastar API:
```bash
npm test                                                                  # pipeline completo com um "modelo" roteirizado (PDF do Implante Day → vídeo + barra)
node src/cli.js render test/specs/outubro.json test/assets/outubro saida preview   # renderiza um spec pronto
```

## Subir para a equipe (Google Cloud Run)

O `worker/Dockerfile` usa a imagem oficial do Playwright. Os jobs ficam em um bucket montado em `/data`.

```bash
cd worker
PROJECT=seu-projeto REGION=southamerica-east1 BUCKET=icomtv-estudio-campanhas
gcloud storage buckets create gs://$BUCKET --location=$REGION
printf '%s' 'sk-ant-...' | gcloud secrets create anthropic-key --data-file=-
printf '%s' 'danilo:senha1,designer:senha2' | gcloud secrets create estudio-equipe --data-file=-

gcloud run deploy estudio-campanhas --source . --region $REGION \
  --memory 4Gi --cpu 2 --timeout 3600 --no-cpu-throttling \
  --min-instances 1 --max-instances 1 \
  --set-env-vars CLAUDE_MODEL=claude-opus-5-5 \
  --set-secrets ANTHROPIC_API_KEY=anthropic-key:latest,EQUIPE=estudio-equipe:latest \
  --add-volume name=dados,type=cloud-storage,bucket=$BUCKET \
  --add-volume-mount volume=dados,mount-path=/data \
  --allow-unauthenticated   # o acesso é controlado pelo login da equipe (EQUIPE)
```

- `max-instances 1`: a fila é em memória (um job por vez, os demais aguardam). Para várias renderizações simultâneas, troque a fila por Cloud Tasks.
- `min-instances 1` + `--no-cpu-throttling`: o processamento continua em segundo plano depois que a página responde. Para economizar, uma VM pequena (e2-standard-2) com Docker também atende.

## Custos e modelo
Cada job mostra os tokens usados na tela. `CLAUDE_MODEL=claude-opus-5-5` dá o melhor olhar de design; teste `claude-sonnet-5-5` para reduzir custo. O histórico de imagens antigas é podado automaticamente e o prompt de sistema usa cache.

## Personalizar
- **Regras do agente**: `worker/skill/SISTEMA.md` (tom, regras de conteúdo e design, fluxo).
- **Formato das peças**: `worker/skill/SPEC.md` + `worker/templates/*.html`.
- **Fontes**: famílias empacotadas em `worker/src/fonts.js`; fontes embutidas em PDFs são extraídas automaticamente.
