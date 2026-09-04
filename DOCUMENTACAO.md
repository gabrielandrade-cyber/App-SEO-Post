# OPTMOS Hub - Documentacao do Projeto

Atualizada em 04/09/2026. O README.md traz o guia operacional (rodar, fazer deploy, formato do
CSV). Este documento descreve o produto e as decisoes de arquitetura.

## 1. Identidade e objetivo

O OPTMOS (antes SERP Optimizer) e um hub de ferramentas de SEO e performance web. A identidade
central e o **BYOK (Bring Your Own Key)**: nao ha assinatura nem chave embutida. O usuario conecta a
propria chave (free tier ou paga) do provedor que escolher, e o app funciona sem custo recorrente
para quem o hospeda.

Modulos:

1. **SERP Optimizer.** Processamento em lote de um CSV de URLs. O servidor rastreia cada pagina, a
   IA escreve meta title e meta description novos e justifica cada escolha. As regras seguem as
   diretrizes de SERP da liveSEO (title 50 a 58, description 150 a 160, contando espacos, sem marca
   no title, imperativo na abertura, CTA variado no fechamento) e o tom de voz que o usuario
   cadastra para a marca.
2. **Image Optimizer.** Conversao de JPG/PNG/WebP para WebP no navegador (Canvas API, transparencia
   preservada, maior lado limitado a 2048 px) e IA multimodal para gerar nome de arquivo e alt text.

## 2. Identidade visual (Liquid Glass)

Inspiracao no design da Apple (iOS): profundidade, desfoque e transicoes suaves. Dark-only.

- Fundo preto sob gradientes azuis e um degrade navy vertical, com duas orbes de luz (indigo e
  fucsia) que derivam lentamente. Respeita `prefers-reduced-motion`.
- Superficies em `GlassCard` (`src/components/ui/glass.tsx`): `rounded-3xl`, borda `white/7`,
  fundo `white/3`, `backdrop-blur-2xl` e brilho especular na borda superior. A variante `distort`
  aplica a distorcao real via filtro SVG `#glass-distortion`, usada nos cards de destaque.
- Botoes em `.liquid-glass-button`: vidro fino com brilho que desliza no hover.
- Acentos neon em indigo, fucsia, esmeralda e cyan. Cor por estado: cinza ocioso, indigo rodando,
  ambar atencao, esmeralda concluido, rosa erro.
- Cantos exagerados de proposito (`rounded-3xl`, `rounded-[32px]`).

## 3. Stack e arquitetura

- **Frontend:** React 19 + Vite 7, TanStack Router (roteamento por arquivo), Tailwind v4, shadcn/ui.
- **Servidor:** TanStack Start rodando em **Cloudflare Workers** (`wrangler.jsonc`, worker `optmos`).
  O endpoint `POST /api/optimize-batch` e a server function `optimizeVision` chamam as APIs de IA
  a partir do Worker, com a chave enviada pelo cliente e usada so em memoria.
- **Dados no navegador:** o CSV vai para o IndexedDB em blocos de 1000 linhas; a tabela e
  virtualizada e so a janela visivel fica em memoria. A fila persiste o indice corrente, entao da
  para fechar o navegador e retomar depois.
- **Chaves:** ficam no localStorage cifradas em AES-GCM 256, com a `CryptoKey` (nao exportavel)
  guardada num IndexedDB separado. Se a cifra nao estiver disponivel, as chaves ficam so na sessao;
  nunca sao gravadas em texto puro.
- **Hidratacao:** o estado inicial e identico no servidor e no cliente; o que esta salvo entra
  depois, num efeito. Isso elimina divergencia de hidratacao no SSR.

### Fluxo do SERP Optimizer

1. Importacao do CSV (cabecalho por nome ou mapeamento posicional) para o IndexedDB. A base
   anterior so e apagada quando a primeira linha valida do arquivo novo e encontrada.
2. A fila envia lotes (20 URLs no ChatGPT, 10 no Gemini, 5 na Groq, 3 na Cerebras) para
   `/api/optimize-batch`, com ate 3 requisicoes em paralelo no ChatGPT e 2 no Gemini. O
   progresso so avanca pelo prefixo contiguo de lotes concluidos, e retomar nunca reenvia
   linha ja otimizada.
3. O servidor valida a origem da chamada, bloqueia alvos internos (SSRF), rastreia cada URL
   (timeout 4 s, ate 200 KB de HTML, redirecionamentos revalidados) e extrai title, meta
   description, H1, H2, primeiros paragrafos e o corpo, num contexto de ate 2400 caracteres em que
   o corpo tem espaco garantido.
4. O prompt combina as diretrizes de SERP, o tom de voz da marca (bloco obrigatorio, com instrucao
   de extrair nome, posicionamento, persona, vocabulario e diferenciais) e o contexto rastreado,
   marcado como dado bruto que nunca deve ser tratado como instrucao.
5. O adapter chama o modelo em JSON estruturado, exige um resultado por id (segunda chance so para
   os que faltaram) e manda os textos fora da faixa de caracteres para uma rodada de reparo.
6. Toda linha volta com texto ou com `optimizationError`. Erros de chave, saldo ou cota
   interrompem o lote, devolvem o que ja foi feito e pausam a fila com a mensagem certa; o botao
   "Reprocessar erros" reenvia so as linhas que falharam.

## 4. Provedores

Fonte unica em `src/lib/providers.ts`. Modelos conferidos em 04/09/2026:

| Provedor | Texto                   | Visao                   | Observacao                                                             |
| -------- | ----------------------- | ----------------------- | ---------------------------------------------------------------------- |
| ChatGPT  | `gpt-5.6-luna`          | `gpt-5.6-luna`          | rapido e barato (US$ 0,20/M entrada), contexto 1M, precisa de creditos |
| Gemini   | `gemini-3.5-flash-lite` | `gemini-3.5-flash-lite` | modelo do Google para alto volume, contexto 1M                         |
| Groq     | `openai/gpt-oss-120b`   | `qwen/qwen3.8-27b`      | ultrarrapido, free tier generoso                                       |
| Cerebras | `gpt-oss-120b`          | sem visao               | ~3000 tokens/s, free tier apertado                                     |

Modelo descontinuado (404) cai para o proximo de `fallbackModels`; nenhum outro erro troca de
modelo, para nunca mascarar um 429 ou 401 com a mensagem de outro modelo.

## 5. Seguranca dos endpoints

O app nao tem login. Duas barreiras protegem o Worker publicado: chamadas so sao aceitas da
propria pagina (header `Sec-Fetch-Site`) e, se o secret `OPTMOS_ACCESS_TOKEN` existir, todo
request precisa do header `x-optmos-token` com o mesmo valor (campo "Token de acesso" no painel).
O rastreador recusa URLs de loopback, redes privadas, link-local e portas fora de 80/443.

## 6. Como rodar e publicar

Ver README.md. Resumo: `npm install`, `npm run dev` para desenvolver, `npm run deploy` para
publicar no Cloudflare com a conta logada no wrangler. O gerenciador padrao e o npm; o `bun.lock`
antigo foi removido por estar desatualizado em relacao ao `package-lock.json`.
