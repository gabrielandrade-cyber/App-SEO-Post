# OPTMOS

Hub de ferramentas de SEO com IA, no modelo **BYOK (Bring Your Own Key)**: o app nao tem chave
propria nem assinatura, o usuario cola a chave do provedor que preferir e ela e usada requisicao a
requisicao.

Dois modulos:

| Modulo          | Rota       | O que faz                                                                                                                                                                     |
| --------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SERP Optimizer  | `/`        | Importa um CSV de URLs, rastreia cada pagina e gera meta title e meta description novos, com justificativa, dentro das diretrizes de SERP da liveSEO e do tom de voz da marca |
| Image Optimizer | `/imagens` | Converte imagens para WebP no navegador e usa IA de visao para gerar nome de arquivo e alt text                                                                               |

## Stack

- TanStack Start + TanStack Router (SSR, roteamento por arquivo)
- React 19, Tailwind v4, shadcn/ui, lucide-react, framer-motion
- Vite 7 com `@cloudflare/vite-plugin`
- Cloudflare Workers (worker `optmos`, `wrangler.jsonc`)
- IndexedDB (`idb`) para o dataset do CSV e localStorage (cifrado com AES-GCM) para as chaves
- Gerenciador de pacotes: **npm** (`package-lock.json`)

## Rodar local

```bash
npm install
npm run dev
```

Abre em `http://localhost:8080`. Nao existe `.env`: por ser BYOK, a unica configuracao e a chave
colada na interface.

## Deploy (Cloudflare Workers)

```bash
npm run deploy
```

Faz `vite build` e `wrangler deploy` com a conta logada no wrangler (`npx wrangler login` na
primeira vez). `npm run deploy:dry` valida o pacote sem publicar. Nao ha deploy automatico: o
workflow `.github/workflows/ci.yml` so roda typecheck, lint, build e um dry-run em cada push.

### Token de acesso (opcional, recomendado)

O app nao tem login, entao os endpoints do Worker aceitariam chamadas de qualquer origem. Duas
protecoes estao ativas:

1. Chamadas so sao aceitas quando vem da propria pagina do app (header `Sec-Fetch-Site`).
2. Se o secret `OPTMOS_ACCESS_TOKEN` existir no Worker, toda chamada precisa mandar o mesmo valor
   no header `x-optmos-token`. O usuario cola o token em **Avancado > Token de acesso** no painel.

```bash
npx wrangler secret put OPTMOS_ACCESS_TOKEN
```

## Provedores e modelos

Definidos num unico lugar: [`src/lib/providers.ts`](src/lib/providers.ts).

| Provedor         | Modelo de texto         | Modelo de visao         | URLs por requisicao | Requisicoes em paralelo |
| ---------------- | ----------------------- | ----------------------- | ------------------- | ----------------------- |
| ChatGPT (OpenAI) | `gpt-5.6-luna`          | `gpt-5.6-luna`          | 20                  | 3                       |
| Gemini           | `gemini-3.5-flash-lite` | `gemini-3.5-flash-lite` | 10                  | 2                       |
| Groq             | `openai/gpt-oss-120b`   | `qwen/qwen3.8-27b`      | 5                   | 1                       |
| Cerebras         | `gpt-oss-120b`          | sem visao               | 3                   | 1                       |

Se o modelo principal responder "model not found" (descontinuado), o adapter cai para o proximo
de `fallbackModels`. Nenhum outro tipo de erro troca de modelo.

### Paralelismo e limites do Cloudflare

A fila mantem ate `concurrency` requisicoes em voo por provedor (`src/lib/batch-scheduler.ts`
faz o escalonamento; o progresso so avanca pelo prefixo contiguo de lotes concluidos, entao
pausar e retomar nunca pula linha). Cada requisicao e uma invocacao separada do Worker, e os
limites do Cloudflare Workers valem por invocacao:

| Limite por invocacao         | Plano Free | Plano Paid |
| ---------------------------- | ---------- | ---------- |
| CPU                          | 10 ms      | 30 s       |
| Subrequests (fetch de saida) | 50         | 1.000      |
| Conexoes simultaneas         | 6          | 6          |

O rastreamento faz ate 5 fetches simultaneos e tem orcamento de 40 subrequests por
invocacao; passando disso, as URLs restantes seguem sem contexto e a IA escreve pelo que a URL
e os metadados atuais permitem. Se o Worker estiver no plano Free e aparecer erro 1102 (CPU),
reduzir `batchSize` em `providers.ts`. Se o provedor devolver 429 com frequencia, reduzir
`concurrency`: o teto real e o rate limit (RPM e TPM) da conta, nao o Cloudflare.

## Formato do CSV

Com cabecalho, as colunas sao reconhecidas pelo nome (`URL`/`Address`/`Endereco`, `Title`/`Title
1`/`Titulo`, `Description`/`Meta Description 1`/`Descricao`); colunas extras sao ignoradas, entao o
export "Internal - All" do Screaming Frog funciona direto. Sem cabecalho, vale a posicao: URL,
title atual, description atual.

A exportacao ("Exportar para controle") segue o layout de upload da liveSEO: 7 colunas, sem
cabecalho, virgula, UTF-8 com BOM. Ordem: URL, novo title, nova description, justificativa do
title, justificativa da description, title atual, description atual.

## Regras de SERP aplicadas pela IA

- Title de 50 a 58 caracteres (contando espacos), sem nome da marca, caixa de sentenca, abrindo pelo
  termo pesquisado.
- Description de 150 a 160 caracteres, abrindo com verbo no imperativo e fechando com CTA; CTAs
  variados (nenhum mais de duas vezes por lote); atributos concretos; sem dado que envelhece.
- Justificativas especificas e verificaveis (problema concreto da SERP atual e o que a nova
  resolve).
- Textos fora da faixa passam por uma rodada de reparo automatica.
- O campo **Tom de voz da marca** e injetado como bloco obrigatorio do prompt; a IA extrai dele
  nome da marca, posicionamento, persona, vocabulario e diferenciais, e explica na justificativa
  como aplicou.

## Estrutura

```
src/
  lib/
    providers.ts       modelos, lotes e ritmo por provedor (fonte unica)
    ai-service.ts      adapters (OpenAI-compativel e Gemini) + orquestracao do lote
    server-auth.ts     guarda dos endpoints (mesma origem + token opcional)
    store.tsx          configuracoes, chaves cifradas, hidratacao segura para SSR
    db.ts              IndexedDB: linhas do CSV e estado da fila
    csv-parser.ts      importacao em streaming, cabecalho por nome ou posicao
    vision.ts          server function de visao
  hooks/use-batch-queue.ts   fila pausavel, retomavel e com reprocessamento de erros
  routes/api/optimize-batch.ts   scraping + prompt + chamada da IA
  components/serp-optimizer/     tela principal
  components/image-optimizer/    conversao WebP + IA de visao
  components/ui/glass.tsx        superficies do Liquid Glass
```

## Scripts

| Comando              | O que faz                                       |
| -------------------- | ----------------------------------------------- |
| `npm run dev`        | servidor de desenvolvimento (workerd local)     |
| `npm run typecheck`  | `tsc --noEmit`                                  |
| `npm run lint`       | eslint                                          |
| `npm test`           | testes do escalonador de lotes (esbuild + node) |
| `npm run build`      | build de producao                               |
| `npm run check`      | typecheck + lint + test + build                 |
| `npm run deploy`     | build + `wrangler deploy`                       |
| `npm run deploy:dry` | build + `wrangler deploy --dry-run`             |
