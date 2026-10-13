# SPEC — formato do JSON das peças

Marcação de texto (em qualquer campo de texto):
- `**palavra**` → negrito na cor `texto`
- `[[palavra]]` → negrito na cor `destaque`
- Campos de várias linhas aceitam **array de strings** (uma string = uma linha). Quebre as linhas você mesmo.

```jsonc
{
  "clinica": "Nome da clínica",
  "campanha": "Nome da campanha",
  "marca": {
    "fundo": "#F3EDE7",          // cor de fundo das peças
    "texto": "#141B32",          // títulos e **negrito**
    "texto_suave": "#3B3F4A",    // texto normal
    "destaque": "#809AC6",       // pílulas, linhas, [[destaque]]
    "destaque_texto": "#FFFFFF", // texto sobre a cor de destaque
    "fundo_claro": "#E7DED4",    // numeral gigante, disco atrás de objetos (tom levemente mais escuro/claro que o fundo)
    "fonte_titulo": "SALVAGER",  // família (empacotada ou extraída)
    "fonte_texto": "Montserrat",
    "titulo_peso": 400,          // 400 para fontes display finas; 700 para sans
    "motivo": "linhas",          // "linhas" | "coracoes" | "nenhum"
    "icone": "coracao",          // opcional: id de asset de ícone (ex.: coração no balão) usado em selos e mídias
    "logo": "logo"               // id do asset do logo da CLÍNICA — aparece SOMENTE no display
  },
  "fontes_extras": [ { "familia": "SALVAGER", "arquivo": "fonts/SALVAGER.ttf" } ], // só fontes extraídas do PDF
  "assets": { "mulher": { "arquivo": "assets/mulher.png" } },  // preenchido com os recortes que você fez

  "barra": {
    "blocos": [
      { "tipo": "texto", "titulo": "E participar é simples.", "texto": ["linha 1", "linha 2", "linha 3"] },
      { "tipo": "premio", "imagem": "cafe", "posicao": "50% 40%", "titulo": ["Concorra a um café da", "manhã + acompanhante."], "texto": "opcional", "logo": "tijuca" }, // logo de PARCEIRO, nunca o da clínica
      { "tipo": "cta", "linha1": "Saiba mais", "linha2": "[[na recepção]]", "selo": "O sorteio será no dia 31/10." }
    ]
  },

  "display": {
    "kicker": "CAMPANHA",                         // opcional
    "titulo": ["Um tempo para", "[[cuidar de você.]]"],
    "subtitulo": "frase curta",
    "fotos": ["mulher", "homem"],                 // 1 ou 2 ids; ou "recorte": "id" (pessoa sem fundo)
    "posicoes": ["45% 30%", "50% 15%"],           // object-position de cada foto (enquadrar rostos)
    "chamada": "Seu **novo sorriso** pode **começar agora**!",
    "pilula": "DIA 26 DE SETEMBRO", "pilula_imagem": "implante",  // imagem opcional na ponta da pílula
    "beneficios": [["Descontos", "exclusivos"], ["Condições de", "parcelamento"]],
    "frase": "frase de apoio",
    "cta": ["SAIBA MAIS", "NA RECEPÇÃO"], "logo": "logo", "selo": "opcional"  // logo: opcional, padrão = marca.logo
  },

  "video": {
    "duracao": 40,
    "cenas": [ /* 6 cenas, nesta ordem típica */
      { "tipo": "abertura", "kicker": "CAMPANHA", "titulo": ["IMPLANTE", "DAY"], "subtitulo": "…", "selo": "opcional",
        "tamanho_titulo": 170, "lado": "esquerda",          // lado do TEXTO
        "midia": { "tipo": "fotos2", "imagens": ["a", "b"], "posicoes": ["45% 30%", "50% 15%"] } },
      { "tipo": "midia_texto", "lado": "esquerda",           // lado da MÍDIA
        "midia": { "tipo": "foto", "imagem": "a", "posicao": "42% 40%", "largura": 760, "altura": 860, "icone": true },
        "titulo": ["Seu **novo sorriso**", "pode **começar**", "**agora**!"], "tamanho_titulo": 80,
        "texto": ["linha", "linha"], "icone_texto": false },
      { "tipo": "data", "kicker": "MARQUE NA AGENDA", "pilula": "DIA 26 DE SETEMBRO", "numero": "26", "imagem": "implante",
        "texto": "Seu **novo sorriso** pode **começar agora**!" },
      { "tipo": "beneficios", "midia": { "tipo": "foto", "imagem": "b" }, "kicker": "SOMENTE NO IMPLANTE DAY",
        "itens": [["Descontos", "exclusivos"], ["Condições de", "parcelamento"]], "texto": ["…", "…"] },
      { "tipo": "texto", "kicker": "…", "titulo": ["…"], "texto": ["…"] },   // cena só de texto (coringa)
      { "tipo": "cta", "titulo": ["SAIBA MAIS", "NA RECEPÇÃO"], "selo": "Implante Day · 26 de setembro", "duracao": 5.8 }
    ]
  }
}
```

Tipos de `midia`:
- `foto` — retângulo arredondado (`raio`, `largura`, `altura`, `posicao`)
- `fotos2` — duas fotos lado a lado (`imagens`, `posicoes`, `altas: true` para duas fotos verticais iguais, `proporcao: [0.63,0.37]`)
- `foto_circulo` — foto em círculo (`logo` opcional no canto: só logo de parceiro)
- `objeto` — imagem sem fundo flutuando sobre disco (ex.: implante, produto)
- `recorte` — pessoa sem fundo, apoiada na base do quadro (só na `abertura` ou `midia_texto`)
- `icone: true` em qualquer mídia → ícone da marca no canto superior direito

**Logo da clínica**: só no display (`marca.logo` / `display.logo`). Na barra e no vídeo, o campo `logo` aceita apenas logos de parceiros; se apontar para o logo da clínica, o template remove e gera um alerta.

Durações: cenas sem `duracao` dividem igualmente o restante de `video.duracao`. A última cena tem fade para preto no último segundo.
