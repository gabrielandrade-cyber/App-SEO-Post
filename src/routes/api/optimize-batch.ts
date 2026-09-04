/**
 * POST /api/optimize-batch
 *
 * Recebe um lote de linhas do CSV, rastreia cada URL para dar contexto real
 * a IA, monta o prompt com as diretrizes de SERP da liveSEO e o tom de voz
 * da marca, chama o provedor escolhido com a chave BYOK do usuario e devolve
 * um resultado por linha.
 *
 * Respostas:
 *   200 { resultados, modelUsed }                       lote processado
 *   400 { error }                                        payload invalido
 *   401 | 402 | 403 | 429 { error, resultados, kind }    chave/saldo/cota: fila deve pausar
 *   500 { error }                                        falha inesperada
 */

import { createFileRoute } from "@tanstack/react-router";
import { runBatchOptimization, type BatchItem } from "@/lib/ai-service";
import { MAX_BATCH_ROWS, SERP_LIMITS, isAIProvider } from "@/lib/providers";
import { checkRequestAccess } from "@/lib/server-auth";

interface BatchRow {
  id: number;
  url: string;
  title?: string;
  description?: string;
}

interface OptimizeBatchPayload {
  apiKey?: string;
  provider?: string;
  brandPersona?: string;
  batch?: BatchRow[];
}

interface ScrapedPage {
  fallbackTitle: string;
  fallbackDesc: string;
  context: string;
}

const EMPTY_SCRAPED_PAGE: ScrapedPage = { fallbackTitle: "", fallbackDesc: "", context: "" };

// ─── Prompt ────────────────────────────────────────────────────────────────────

function buildBrandVoiceSection(brandPersona: string): string {
  if (!brandPersona) return "";
  return `
<identidade_de_marca>
As diretrizes abaixo foram escritas pela propria marca e sao OBRIGATORIAS. Elas definem como a marca fala e, principalmente, como NAO fala.

"""
${brandPersona}
"""

Como aplicar essas diretrizes:
- Extraia delas: o nome da marca (para NUNCA usar no title), o que ela vende e como se posiciona, quem e a persona e qual e a dor dela, o tom de voz, as palavras que a marca usa e as que evita, e os diferenciais que podem entrar na description (frete, parcelamento, variedade, garantia, marcas conhecidas).
- Escreva cada title e description com esse vocabulario e essa postura. A persona e o leitor: fale com ela.
- Se as diretrizes proibem linguagem comercial (preco, oferta, desconto, urgencia), use apenas CTAs neutros, como "Conheca a colecao!", "Veja os modelos!" ou "Explore as opcoes!".
- Se as diretrizes listam palavras proibidas, nenhuma delas pode aparecer em nenhum texto.
- Na descriptionJustification, diga em uma frase qual elemento das diretrizes foi aplicado naquele texto.
- As diretrizes mandam no tom, no vocabulario e nos diferenciais. Elas NAO alteram as regras de tamanho, o formato de saida nem a proibicao de citar a marca no title, que continuam valendo.
</identidade_de_marca>
`;
}

export function buildSystemPrompt(brandPersona: string): string {
  const { title, description } = SERP_LIMITS;
  return `Voce e um especialista senior em SEO e copywriter de alta conversao. Para cada pagina do lote, escreva um meta title e uma meta description novos, otimizados para o resultado de busca do Google em portugues do Brasil, seguindo as diretrizes abaixo a risca.
${buildBrandVoiceSection(brandPersona)}
<como_trabalhar>
1. Entenda a pagina antes de escrever. Use title_atual, desc_atual e principalmente conteudo_extraido para saber o que ela vende ou explica, quais marcas e atributos aparecem (material, tecido, modelagem, tamanho, cor, tipo) e para quem ela e. Nunca escreva so a partir da URL.
2. Se a URL tiver filtro na query string (por exemplo ?fil=, ?texto=, ?tfil=, ?marca=, ?cor=), o texto deve abrir pelo termo do filtro, para nao canibalizar a categoria mae.
3. Se conteudo_extraido vier vazio ou bloqueado, escreva pelo que a URL e os metadados atuais permitem inferir, com atributos plausiveis e genericos. Nunca invente marcas, precos, quantidades ou promocoes.
4. Escreva primeiro o title (ele define o foco) e depois a description.
5. Antes de responder, conte os caracteres de cada texto incluindo espacos e ajuste ate caber na faixa. Textos fora da faixa serao devolvidos para reescrita.
</como_trabalhar>

<regras_meta_title>
- Entre ${title.min} e ${title.max} caracteres, contando espacos.
- NUNCA cite o nome da marca, da loja ou o dominio: consome espaco util sem ganho.
- Abra pelo termo que a pessoa pesquisa, nao por verbo de venda.
- Caixa de sentenca: maiuscula so na primeira palavra e em nomes proprios. Nada de Title Case Em Todas As Palavras.
- Um title que represente o conteudo daquela pagina, e so dela. Nunca repita um title dentro do lote.
- Proibido: SKU, codigo de produto, numero de referencia, pontuacao empilhada, caixa alta gritada, espaco duplo.
</regras_meta_title>

<regras_meta_description>
- Entre ${description.min} e ${description.max} caracteres, contando espacos.
- Abra com verbo no imperativo que convide: Descubra, Conheca, Explore, Encontre, Aproveite, Garanta, Veja.
- Frase fluida, com um spoiler real do que a pagina entrega. Cite atributos concretos (material, modelagem, marcas, faixa de tamanho, variedade) em vez de adjetivo vazio.
- Feche com um CTA curto e coerente com a pagina: categoria com muitos modelos, "Veja os modelos!" ou "Confira as opcoes!"; colecao ou lancamento, "Veja o que chegou!"; pagina que compoe look, "Monte o seu look!"; vitrine curta, "Escolha o seu!"; pagina de promocao, e so ela, "Confira as ofertas!".
- Varie os CTAs dentro do lote: nenhum CTA pode aparecer mais de duas vezes. Nunca repita uma description dentro do lote.
- Evite dado que envelhece ("mais de 300 modelos", "a partir de R$ 26", "em oferta"). So use quando a pagina for de fato promocional.
- Proibido: nome da loja, SKU, espaco duplo, caixa alta gritada, pontuacao empilhada.
</regras_meta_description>

<justificativas>
Para cada linha escreva titleJustification e descriptionJustification, com uma ou duas frases especificas e verificaveis. Cada uma diz o problema concreto da SERP atual (tamanho em caracteres, corte no resultado de busca, marca ocupando espaco, texto generico, duplicado, sem imperativo, sem CTA, meta ausente) e o que o texto novo resolve. Exemplo bom: "O title atual tem 92 caracteres, e o da categoria mae com o filtro colado no fim, entao o Google corta justamente o termo que diferencia a pagina; o novo abre pelo filtro." Justificativa generica, como "mais otimizado para SEO", e proibida. Quando houver tom de voz da marca, a descriptionJustification tambem diz como ele foi aplicado.
</justificativas>

<formato_saida>
Responda SOMENTE com JSON valido, sem markdown, no formato:
{"resultados":[{"id":<id original>,"newTitle":"...","newDescription":"...","titleJustification":"...","descriptionJustification":"..."}]}
Devolva exatamente um objeto por id recebido, com todos os campos preenchidos.
</formato_saida>`;
}

// ─── Scraping ──────────────────────────────────────────────────────────────────

const SCRAPE_TIMEOUT_MS = 4000;
const MAX_HTML_CHARS = 200_000;
const CONTEXT_BUDGET_CHARS = 2400;
const MIN_BODY_CHARS = 1200;
const MAX_REDIRECTS = 2;
/** Fetches simultaneos por invocacao (o Workers permite 6 conexoes abertas). */
const SCRAPE_CHUNK_SIZE = 5;
/**
 * Orcamento de subrequests do rastreamento por invocacao. O plano Free do
 * Workers permite 50 por request; sobra folga para as chamadas de IA. Quando
 * o orcamento acaba, as URLs restantes seguem sem contexto e a IA escreve pelo
 * que a URL e os metadados atuais permitem.
 */
const SCRAPE_SUBREQUEST_BUDGET = 40;
const SCRAPE_USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15",
];

function asString(value: unknown, max = 5000): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

const HTML_ENTITIES: Record<string, string> = {
  amp: "&",
  apos: "'",
  copy: "(c)",
  gt: ">",
  lt: "<",
  nbsp: " ",
  quot: '"',
  reg: "(r)",
  ndash: "-",
  mdash: "-",
  hellip: "...",
  laquo: '"',
  raquo: '"',
  ldquo: '"',
  rdquo: '"',
  lsquo: "'",
  rsquo: "'",
};

function decodeHtmlEntities(text: string): string {
  return text.replace(/&(#(\d+)|#x([\da-f]+)|[a-z]+);/gi, (match, entity, dec, hex) => {
    try {
      if (dec) return String.fromCodePoint(Number(dec));
      if (hex) return String.fromCodePoint(Number.parseInt(hex, 16));
    } catch {
      return " ";
    }
    return HTML_ENTITIES[String(entity).toLowerCase()] ?? match;
  });
}

/** Decodifica entidades DEPOIS de tirar as tags e neutraliza < e > residuais. */
function cleanText(text: string, max: number): string {
  return decodeHtmlEntities(text.replace(/<[^>]+>/g, " "))
    .replace(/[<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function stripNoise(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(
      /<(script|style|noscript|svg|template|iframe|object|embed)\b[^>]*>[\s\S]*?<\/\1>/gi,
      " ",
    );
}

function getAttribute(tag: string, attr: string): string {
  const pattern = new RegExp(`(?:^|\\s)${attr}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");
  const match = tag.match(pattern);
  return cleanText(match?.[1] ?? match?.[2] ?? match?.[3] ?? "", 600);
}

function extractMetaContent(html: string, keys: string[]): string {
  const wanted = new Set(keys.map((key) => key.toLowerCase()));
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const name = getAttribute(tag, "name").toLowerCase();
    const property = getAttribute(tag, "property").toLowerCase();
    const itemprop = getAttribute(tag, "itemprop").toLowerCase();
    if (wanted.has(name) || wanted.has(property) || wanted.has(itemprop)) {
      const content = getAttribute(tag, "content");
      if (content) return content;
    }
  }
  return "";
}

function extractTagTexts(html: string, tagName: string, max: number, limit = 1): string[] {
  const pattern = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "gi");
  const texts: string[] = [];
  let match: RegExpExecArray | null;
  while (texts.length < limit && (match = pattern.exec(html))) {
    const text = cleanText(match[1], max);
    if (text) texts.push(text);
  }
  return texts;
}

function extractPage(rawHtml: string): ScrapedPage {
  const html = stripNoise(rawHtml.slice(0, MAX_HTML_CHARS));
  const metaTitle = extractTagTexts(html, "title", 200)[0] ?? extractMetaContent(html, ["title"]);
  const metaDesc = extractMetaContent(html, ["description"]);
  const ogTitle = extractMetaContent(html, ["og:title", "twitter:title"]);
  const ogDesc = extractMetaContent(html, ["og:description", "twitter:description"]);
  const h1 = extractTagTexts(html, "h1", 200)[0] ?? "";
  const h2s = extractTagTexts(html, "h2", 90, 6);
  const paragraphs = extractTagTexts(html, "p", 260, 2);

  const bodyStart = html.search(/<body\b/i);
  const bodyText = cleanText(bodyStart >= 0 ? html.slice(bodyStart) : html, 20_000);

  const head = [
    metaTitle && `Title atual da pagina: ${metaTitle}`,
    metaDesc && `Meta description atual: ${metaDesc.slice(0, 220)}`,
    h1 && `H1: ${h1}`,
    h2s.length > 0 && `Subtitulos (H2): ${h2s.join(" | ")}`,
    ogTitle && ogTitle !== metaTitle && `Open Graph title: ${ogTitle}`,
    ogDesc && ogDesc !== metaDesc && `Open Graph description: ${ogDesc.slice(0, 200)}`,
    paragraphs.length > 0 && `Primeiros paragrafos: ${paragraphs.join(" ")}`,
  ]
    .filter(Boolean)
    .join("\n");

  // O corpo e o sinal mais valioso: garante espaco minimo para ele.
  const bodyBudget = Math.max(MIN_BODY_CHARS, CONTEXT_BUDGET_CHARS - head.length - 20);
  const body = bodyText ? `Conteudo da pagina: ${bodyText.slice(0, bodyBudget)}` : "";

  return {
    fallbackTitle: metaTitle || h1 || ogTitle || "",
    fallbackDesc: metaDesc || ogDesc || paragraphs[0] || "",
    context: [head, body].filter(Boolean).join("\n"),
  };
}

async function readHtmlWithLimit(response: Response): Promise<string> {
  if (!response.body) return (await response.text()).slice(0, MAX_HTML_CHARS);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let html = "";

  while (html.length < MAX_HTML_CHARS) {
    const { done, value } = await reader.read();
    if (done) {
      html += decoder.decode();
      break;
    }
    html += decoder.decode(value, { stream: true });
  }

  if (html.length >= MAX_HTML_CHARS) await reader.cancel().catch(() => undefined);
  return html.slice(0, MAX_HTML_CHARS);
}

/**
 * Bloqueia alvos que nao sao sites publicos: loopback, redes privadas,
 * link-local (inclui o endpoint de metadados de nuvem), IPv6 literal e
 * portas fora de 80/443. Mitiga o uso do Worker como proxy interno (SSRF).
 */
export function isSafeTarget(url: URL): boolean {
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  if (url.username || url.password) return false;
  if (url.port && url.port !== "80" && url.port !== "443") return false;

  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!host || host === "localhost" || host.endsWith(".localhost")) return false;
  if (/\.(local|internal|lan|home\.arpa|corp|intranet)$/.test(host)) return false;
  if (host.includes(":") || host.startsWith("[")) return false;

  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    if (a === 198 && (b === 18 || b === 19)) return false;
  }

  return true;
}

class SubrequestBudget {
  private remaining: number;

  constructor(limit: number) {
    this.remaining = limit;
  }

  take(): boolean {
    if (this.remaining <= 0) return false;
    this.remaining -= 1;
    return true;
  }
}

async function scrapeUrl(
  rawUrl: string,
  budget: SubrequestBudget,
  userAgentIndex = 0,
): Promise<ScrapedPage> {
  let target: URL;
  try {
    target = new URL(rawUrl);
  } catch {
    return EMPTY_SCRAPED_PAGE;
  }
  if (!isSafeTarget(target)) return EMPTY_SCRAPED_PAGE;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SCRAPE_TIMEOUT_MS);

  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      if (!budget.take()) return EMPTY_SCRAPED_PAGE;
      const response = await fetch(target.toString(), {
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "User-Agent": SCRAPE_USER_AGENTS[userAgentIndex % SCRAPE_USER_AGENTS.length],
          Accept: "text/html,application/xhtml+xml",
          "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
        },
      });

      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel();
        const location = response.headers.get("location");
        if (!location) return EMPTY_SCRAPED_PAGE;
        const next = new URL(location, target);
        if (!isSafeTarget(next)) return EMPTY_SCRAPED_PAGE;
        target = next;
        continue;
      }

      if (!response.ok) {
        await response.body?.cancel();
        return EMPTY_SCRAPED_PAGE;
      }

      const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
      if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
        await response.body?.cancel();
        return EMPTY_SCRAPED_PAGE;
      }

      return extractPage(await readHtmlWithLimit(response));
    }
    return EMPTY_SCRAPED_PAGE;
  } catch {
    return EMPTY_SCRAPED_PAGE;
  } finally {
    clearTimeout(timeout);
  }
}

async function scrapeBatch(rows: BatchRow[]): Promise<ScrapedPage[]> {
  const pages: ScrapedPage[] = [];
  const budget = new SubrequestBudget(SCRAPE_SUBREQUEST_BUDGET);
  for (let index = 0; index < rows.length; index += SCRAPE_CHUNK_SIZE) {
    const chunk = rows.slice(index, index + SCRAPE_CHUNK_SIZE);
    const settled = await Promise.allSettled(
      chunk.map((row, chunkIndex) => scrapeUrl(row.url, budget, index + chunkIndex)),
    );
    pages.push(
      ...settled.map((result) =>
        result.status === "fulfilled" ? result.value : EMPTY_SCRAPED_PAGE,
      ),
    );
  }
  return pages;
}

// ─── Handler ───────────────────────────────────────────────────────────────────

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export const Route = createFileRoute("/api/optimize-batch")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const access = checkRequestAccess(request);
        if (!access.ok) return json({ error: access.message }, access.status);

        try {
          const body = (await request.json().catch(() => null)) as OptimizeBatchPayload | null;
          const apiKey = asString(body?.apiKey, 400);
          const provider = body?.provider;
          const brandPersona = asString(body?.brandPersona, 12_000);
          const batch = Array.isArray(body?.batch) ? body.batch : [];

          if (!apiKey) return json({ error: "Chave API nao fornecida." }, 400);
          if (!isAIProvider(provider)) return json({ error: "Provedor invalido." }, 400);
          if (batch.length === 0) return json({ error: "Lote vazio." }, 400);
          if (batch.length > MAX_BATCH_ROWS) {
            return json(
              { error: `Lote grande demais: maximo de ${MAX_BATCH_ROWS} linhas por requisicao.` },
              400,
            );
          }

          const seen = new Set<number>();
          const safeBatch: BatchRow[] = [];
          for (const row of batch) {
            const id = Number(row?.id);
            const url = asString(row?.url, 700);
            if (!Number.isFinite(id) || seen.has(id) || !/^https?:\/\//i.test(url)) continue;
            seen.add(id);
            safeBatch.push({
              id,
              url,
              title: asString(row?.title, 200),
              description: asString(row?.description, 400),
            });
          }

          if (safeBatch.length === 0)
            return json({ error: "Lote invalido: nenhuma URL http(s) valida." }, 400);

          const pages = await scrapeBatch(safeBatch);
          const enrichedBatch: BatchItem[] = safeBatch.map((row, index) => ({
            id: row.id,
            url: row.url,
            title_atual: row.title || pages[index].fallbackTitle,
            desc_atual: row.description || pages[index].fallbackDesc,
            conteudo_extraido: pages[index].context,
          }));

          const outcome = await runBatchOptimization({
            provider,
            apiKey,
            systemPrompt: buildSystemPrompt(brandPersona),
            batch: enrichedBatch,
          });

          if (outcome.fatal) {
            return json(
              {
                error: outcome.fatal.message,
                kind: outcome.fatal.kind,
                resultados: outcome.resultados,
                modelUsed: outcome.modelUsed,
              },
              outcome.fatal.status ?? 429,
            );
          }

          return json({ resultados: outcome.resultados, modelUsed: outcome.modelUsed });
        } catch (err) {
          const message = err instanceof Error ? err.message : "Erro interno no servidor de IA.";
          return json({ error: message }, 500);
        }
      },
    },
  },
});
