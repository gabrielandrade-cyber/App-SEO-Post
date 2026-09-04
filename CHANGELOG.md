# Changelog

## 2026-09-04 (tarde): Liquid Glass v2, som de conclusao e ajustes de UI

### Liquid Glass v2

Reescrita do sistema visual a partir de tres referencias lidas no codigo-fonte: Apple
(Technology Overviews, HIG Materials, WWDC25 219), liquid-glass-studio (iyinchao, WebGL) e
@ybouane/liquidglass (WebGL). As duas ferramentas de referencia renderizam o vidro em shader; o
que elas e a Apple tem em comum foi traduzido para CSS:

- Refracao so na borda: filtros SVG `#lg-lens-card` e `#lg-lens-pill` com mapas de deslocamento
  em gradiente (neutro no centro, crescente no anel externo), aplicados na propria superficie
  antes do blur (`backdrop-filter: url() blur() ...`), para dobrar apenas o que esta atras do
  card e nunca os brilhos do proprio card. Substitui o `feTurbulence` com scale 55, que
  espalhava ruido pela superficie inteira. Chromium aplica a lente; outros navegadores ficam
  so com o blur. Sombras, fio interno e glare em intensidade baixa, para suavidade.
- Fresnel e fio interno: `box-shadow` inset de 1.5px com luz de cima (100% no topo, 40%
  embaixo) e brilho interno curto; glare direcional a -45 graus como stroke em gradiente
  recortado por `mask`, com o lado oposto atenuado.
- Tint parcial e frio, blur com `saturate` e `brightness` (variante Regular da Apple), mais opaco
  nos elementos grandes; sombra de contato + ambiente.
- Hierarquia da Apple: `GlassCard` ganhou variantes `control` (com lente: painel de provedor,
  dialogs, cards de destaque), `panel` (padrao) e `content` (vidro fino para a grade de dados).
- Botoes: stroke especular, hover clareia (+14%), press achata com mola curta, `focus-visible`.
- Acessibilidade: `prefers-reduced-transparency` (vidro fosco, sem lente), `prefers-contrast:
  more` (borda contrastante, sem realces), `prefers-reduced-motion` (sem molas nem orbes) e
  fallback `@supports not (backdrop-filter)`.

### Faixa de caracteres (title 50 a 58, description 150 a 160)

- A IA passa a informar a propria contagem (`titleChars`, `descriptionChars`) no JSON, o que
  melhora a precisao, e o reparo virou um laco de ate 3 rodadas com o delta exato por campo
  ("acrescente entre 3 e 11 caracteres"), com raciocinio mais alto nessas rodadas (GPT
  `reasoning_effort: medium`, Gemini `thinkingLevel: medium`). Uma reescrita so e aceita se nao
  piorar a distancia ate a faixa.
- Encaixe deterministico no fim (`src/lib/serp-fit.ts`, no espirito do `fit` da skill de SERP):
  troca so o CTA final para caber em 150 a 160 preservando o corpo, corta title por palavra. Nunca
  inventa texto: corpo curto demais fica para a IA, e a UI mostra o contador em vermelho.
- Botao "Ajustar N fora da faixa" na grade, que reprocessa apenas as linhas fora de faixa.
- Testes em `tests/serp-fit.test.ts` (entram no `npm test`).

### Som de conclusao

- `src/lib/sounds.ts`: arpejo curto ao concluir a fila ou um reprocessamento, tique ao otimizar
  uma linha, duas notas descendentes quando a fila pausa por chave, saldo ou cota. Sintetizado com
  Web Audio (sem arquivo), liberado no clique de iniciar, com botao de mudo persistido em
  `localStorage`.

### UI

- Card de tom de voz nao cresce mais com o texto (o `block` anulava o `line-clamp-2`); modal com
  altura maxima e rolagem interna.
- Area da chave reduzida a rotulo e campo; descricao do modelo, link e nota de criptografia
  sairam (o aviso amarelo so aparece se a cifra falhar).

## 2026-09-04: auditoria completa e refatoracao

Base: commit `0966fee`. Levantamento de 113 problemas confirmados no codigo (mais o bloqueador de
build), todos tratados nesta entrega.

### Bloqueador

- O app nao subia: `compatibility_date` de 2026-06-27 exigia um `workerd` mais novo do que o que
  os lockfiles pinavam. `wrangler` e `@cloudflare/vite-plugin` atualizados (4.129 / 1.54) e
  `wrangler` declarado como devDependency.

### Motor de IA

- Modelos atualizados: ChatGPT `gpt-5.6-luna`, Gemini `gemini-3.5-flash-lite` (texto e visao),
  Groq `openai/gpt-oss-120b` e `qwen/qwen3.8-27b` (visao), Cerebras `gpt-oss-120b`. Os modelos
  antigos de visao (`gemini-2.0-flash`, `llama-3.2-11b-vision-preview`) estavam descontinuados.
- Fonte unica de provedores em `src/lib/providers.ts`.
- Lotes maiores: 20 URLs por requisicao no ChatGPT, 10 no Gemini (antes era 1 por requisicao nos
  provedores de free tier).
- Requisicoes em paralelo por provedor (3 no ChatGPT, 2 no Gemini) com commit do progresso em
  ordem (`src/lib/batch-scheduler.ts`, coberto por `npm test`). Rastreamento com 5 fetches
  simultaneos e orcamento de 40 subrequests por invocacao, dentro dos limites do Workers.
- Saida em JSON estruturado (json_schema estrito na OpenAI, responseSchema no Gemini).
- Um resultado por id garantido; segunda chance para ids faltantes; reparo automatico de textos
  fora da faixa de caracteres.
- 429/402/401/403 interrompem o lote, devolvem o parcial e pausam a fila com mensagem especifica;
  cascata de modelos so em 404 (modelo descontinuado); retries em uma unica camada com deadline.
- Chave do Gemini em header (`x-goog-api-key`), nao mais na query string.

### Prompt

- Diretrizes de SERP da liveSEO injetadas: title 50 a 58 e description 150 a 160 (contando
  espacos), sem marca no title, caixa de sentenca, imperativo na abertura, CTA variado, sem dado
  que envelhece, justificativas especificas.
- Bloco de tom de voz da marca obrigatorio, com instrucao de extrair nome, posicionamento,
  persona, vocabulario e diferenciais e de explicar na justificativa como foi aplicado.
- Conteudo rastreado marcado como dado bruto (mitigacao de prompt injection).

### Rastreamento

- Contexto de 2400 caracteres com espaco garantido para o corpo da pagina; H2s e paragrafos
  extras; limpeza de script/style antes de qualquer extracao; entidades numericas fora do BMP;
  atributos casados com ancora.
- Protecao contra SSRF: bloqueio de loopback, redes privadas, link-local, IPv6 literal e portas
  fora de 80/443, com redirecionamentos revalidados.

### Fila e dados

- Pausa aborta a requisicao em voo e a espera entre lotes; retomar espera o loop anterior sair.
- Estado "running" preso de sessao anterior vira "paused" ao recarregar.
- Reprocessamento so das linhas com erro; contador de erros persistido.
- Rodar de novo apos concluir pede confirmacao (protege edicoes manuais).
- Importacao de CSV em modo chunk (pause/resume funcionam em arquivo grande), cabecalho
  reconhecido por nome (Screaming Frog, Search Console), erros de parsing reportados, base anterior
  so apagada depois da primeira linha valida, progresso desde a primeira linha.
- `setQueueState` atomico; conexao do IndexedDB reaberta apos falha.
- Exportacao em streaming, com BOM UTF-8, CRLF e protecao contra injecao de formula.

### Configuracoes e seguranca

- Estado inicial identico no servidor e no cliente (fim do erro de hidratacao); persistencia fora
  do reducer; chave digitada durante a hidratacao nao e sobrescrita.
- Chaves nunca gravadas em texto puro; keyring aberto uma vez; status de seguranca visivel na UI.
- Provedor de visao separado do provedor de texto.
- Endpoints protegidos por checagem de origem e token opcional (`OPTMOS_ACCESS_TOKEN`).
- Logs de observabilidade do Worker ligados.

### Image Optimizer

- Transparencia preservada; redimensionamento para 2048 px; compressao reutiliza o WebP ja
  convertido; limite alinhado ao provedor (4 MB), nao mais ao da Vercel.
- ZIP so com WebP validos e nomes unicos; object URLs liberadas; nomes gerados normalizados; alt
  text limitado a 125 caracteres; ChatGPT disponivel como IA de visao.

### Shell e visual

- `lang="pt-BR"`, meta tags do Lovable removidas, title e description por rota.
- Header sticky corrigido (sem `overflow-hidden` no wrapper), `h1` unico por pagina, 404 e erro em
  portugues no visual do app.
- Liquid Glass reforcado: `GlassCard` compartilhado com brilho especular, distorcao real nos cards
  de destaque, orbes de luz animadas no wallpaper, linha em processamento com pulso.

### Documentacao e repositorio

- README.md novo, DOCUMENTACAO.md reescrita, DEVOPS_SUMMARY.md e bun.lock removidos (npm e o
  gerenciador), scripts `typecheck`, `check`, `deploy` e `deploy:dry`, CI de validacao sem deploy.
