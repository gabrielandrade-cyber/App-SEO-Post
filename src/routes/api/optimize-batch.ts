import { createFileRoute } from "@tanstack/react-router";
import { getAdapter, type BatchItem, type BatchResult } from "@/lib/ai-service";
import type { AIProvider } from "@/lib/store";

interface BatchRow {
  id: number;
  url: string;
  title?: string;
  description?: string;
}

interface OptimizeBatchPayload {
  apiKey?: string;
  provider?: AIProvider;
  brandPersona?: string;
  batch?: BatchRow[];
}

interface ScrapedPage {
  fallbackTitle: string;
  fallbackDesc: string;
  bodyText: string;
}

const EMPTY_SCRAPED_PAGE: ScrapedPage = {
  fallbackTitle: "",
  fallbackDesc: "",
  bodyText: "",
};

function buildSystemPrompt(brandPersona: string): string {
  const brandVoiceSection = brandPersona
    ? `\n<identidade_de_marca>\nAja sob as seguintes diretrizes de tom de voz da marca:\n${brandPersona}\nATENÇÃO: Incorpore este tom emocional e linguagem, mas SEMPRE respeitando a regra de NÃO incluir o nome da marca no título gerado.\n</identidade_de_marca>\n`
    : "";

  return `Você é um Especialista em SEO Sênior e Copywriter de alta conversão.

<tarefa>
Analise o contexto fornecido (URL, conteúdo rastreado e metadados antigos) e crie um Meta Title e uma Meta Description otimizados.
</tarefa>
${brandVoiceSection}
<regras_inviolaveis_title>
1. TAMANHO: O título DEVE ter entre 50 e 60 caracteres (incluindo espaços).
2. ESTRUTURA: [Nome do Produto] + [Tipo/Categoria] + [Diferencial Principal].
3. PROIBIDO: Não inclua nomes de lojas, marcas de e-commerce, SKUs, códigos de produto ou números de referência.
4. FOCO: Baseie-se nas características descritivas do produto identificadas no contexto.
</regras_inviolaveis_title>

<regras_inviolaveis_description>
1. TAMANHO CIRÚRGICO: A descrição DEVE ter entre 140 e 148 caracteres (máximo absoluto: 150).
2. ABERTURA: Inicie com verbo imperativo de ação (Conheça, Confira, Explore, etc.).
3. PROIBIDO: Não inclua nomes de lojas, códigos de produto ou SKUs.
4. CONSTRUÇÃO: Reforce as características reais do produto, destacando diferenciais.
5. FECHAMENTO: Termine com um CTA forte e direto.
</regras_inviolaveis_description>

<formato_saida>
O seu output final DEVE ser estritamente um array JSON chamado "resultados".
Para cada item no batch, retorne um objeto com a seguinte estrutura exata:

{
  "resultados": [
    {
      "id": (manter o ID original enviado),
      "newTitle": "O texto do título gerado aqui",
      "newDescription": "O texto da description gerada aqui",
      "titleJustification": "Justificativa de 1 frase explicando por que este título traz CTR",
      "descriptionJustification": "Justificativa de 1 frase explicando por que esta descrição traz CTR e reflete o tom da marca"
    }
  ]
}

Responda OBRIGATORIAMENTE em formato JSON válido.
</formato_saida>`;
}

const SCRAPE_TIMEOUT_MS = 3000;
const MAX_HTML_CHARS = 128_000;
const MAX_EXTRACTED_CONTENT_CHARS = 1000;
const SCRAPE_CHUNK_SIZE = 2;
const SCRAPE_USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
];

function asString(value: unknown, max = 5000): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function decodeHtmlEntities(text: string): string {
  const entities: Record<string, string> = {
    amp: "&",
    apos: "'",
    copy: "(c)",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
    reg: "(r)",
  };

  return text.replace(/&(#(\d+)|#x([\da-f]+)|[a-z]+);/gi, (match, entity, dec, hex) => {
    if (dec) return String.fromCharCode(Number(dec));
    if (hex) return String.fromCharCode(Number.parseInt(hex, 16));
    return entities[String(entity).toLowerCase()] ?? match;
  });
}

function normalizeExtractedText(text: string, max = MAX_EXTRACTED_CONTENT_CHARS): string {
  return decodeHtmlEntities(text).replace(/\s+/g, " ").trim().slice(0, max);
}

function getAttribute(tag: string, attr: string): string {
  const pattern = new RegExp(`${attr}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");
  const match = tag.match(pattern);
  return normalizeExtractedText(match?.[1] ?? match?.[2] ?? match?.[3] ?? "", 1000);
}

function stripTags(html: string, max = MAX_EXTRACTED_CONTENT_CHARS): string {
  return normalizeExtractedText(html.replace(/<[^>]+>/g, " "), max);
}

function extractMetaContent(html: string, keys: string[]): string {
  const metaTags = html.match(/<meta\b[^>]*>/gi) ?? [];
  const normalizedKeys = new Set(keys.map((key) => key.toLowerCase()));

  for (const tag of metaTags) {
    const name = getAttribute(tag, "name").toLowerCase();
    const property = getAttribute(tag, "property").toLowerCase();
    const itemprop = getAttribute(tag, "itemprop").toLowerCase();

    if (normalizedKeys.has(name) || normalizedKeys.has(property) || normalizedKeys.has(itemprop)) {
      const content = getAttribute(tag, "content");
      if (content) return content;
    }
  }

  return "";
}

function extractTagText(html: string, tagName: string, max: number): string {
  const match = html.match(new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i"));
  return stripTags(match?.[1] ?? "", max);
}

function extractBodyText(html: string): ScrapedPage {
  const limitedHtml = html.slice(0, MAX_HTML_CHARS);
  const metaTitle =
    extractTagText(limitedHtml, "title", 160) || extractMetaContent(limitedHtml, ["title"]);
  const metaDesc = extractMetaContent(limitedHtml, ["description"]);
  const h1 = extractTagText(limitedHtml, "h1", 160);
  const firstParagraph = extractTagText(limitedHtml, "p", 320);
  const ogTitle = extractMetaContent(limitedHtml, ["og:title", "twitter:title"]);
  const ogDesc = extractMetaContent(limitedHtml, ["og:description", "twitter:description"]);
  const bodyStart = limitedHtml.search(/<body\b/i);
  const bodyHtml = bodyStart >= 0 ? limitedHtml.slice(bodyStart) : limitedHtml;
  const bodyText = normalizeExtractedText(
    bodyHtml
      .replace(/<(script|style|noscript|svg|template)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<[^>]+>/g, " "),
  );
  const context = [
    metaTitle && `Meta title: ${metaTitle}`,
    metaDesc && `Meta description: ${metaDesc}`,
    h1 && `H1: ${h1}`,
    firstParagraph && `Primeiro paragrafo: ${firstParagraph}`,
    ogTitle && `Open Graph title: ${ogTitle}`,
    ogDesc && `Open Graph description: ${ogDesc}`,
    bodyText && `Body: ${bodyText}`,
  ]
    .filter(Boolean)
    .join(" | ");

  return {
    fallbackTitle: metaTitle || h1 || ogTitle || bodyText.slice(0, 120),
    fallbackDesc: metaDesc || firstParagraph || ogDesc || bodyText.slice(0, 220),
    bodyText: normalizeExtractedText(context || bodyText),
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

  if (html.length >= MAX_HTML_CHARS) {
    await reader.cancel().catch(() => undefined);
  }

  return html.slice(0, MAX_HTML_CHARS);
}

async function scrapeUrl(url: string, userAgentIndex = 0): Promise<ScrapedPage> {
  if (!/^https?:\/\//i.test(url)) return EMPTY_SCRAPED_PAGE;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SCRAPE_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": SCRAPE_USER_AGENTS[userAgentIndex % SCRAPE_USER_AGENTS.length],
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      await response.body?.cancel();
      return EMPTY_SCRAPED_PAGE;
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("text/html")) {
      await response.body?.cancel();
      return EMPTY_SCRAPED_PAGE;
    }

    return extractBodyText(await readHtmlWithLimit(response));
  } catch {
    return EMPTY_SCRAPED_PAGE;
  } finally {
    clearTimeout(timeout);
  }
}

async function scrapeBatch(rows: BatchRow[]): Promise<PromiseSettledResult<ScrapedPage>[]> {
  const results: PromiseSettledResult<ScrapedPage>[] = [];

  for (let index = 0; index < rows.length; index += SCRAPE_CHUNK_SIZE) {
    const chunk = rows.slice(index, index + SCRAPE_CHUNK_SIZE);
    const chunkResults = await Promise.allSettled(
      chunk.map((row, chunkIndex) => scrapeUrl(row.url, index + chunkIndex)),
    );
    results.push(...chunkResults);
  }

  return results;
}

function normalizeResults(resultados: unknown[], ids: Set<number>): BatchResult[] {
  const normalized: BatchResult[] = [];

  for (const item of resultados || []) {
    const row = item as Record<string, unknown>;
    const id = Number(row.id);
    if (!ids.has(id)) continue;

    normalized.push({
      id,
      newTitle: asString(row.newTitle, 160) || undefined,
      newDescription: asString(row.newDescription, 320) || undefined,
      titleJustification: asString(row.titleJustification, 2000) || undefined,
      descriptionJustification: asString(row.descriptionJustification, 2000) || undefined,
      optimizationError: asString(row.optimizationError, 500) || undefined,
    });
  }

  return normalized;
}

export const Route = createFileRoute("/api/optimize-batch")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = (await request.json().catch(() => null)) as OptimizeBatchPayload | null;
          const apiKey = body?.apiKey?.trim();
          const provider = body?.provider || "openai";
          const brandPersona = asString(body?.brandPersona, 12000);
          const batch = Array.isArray(body?.batch) ? body.batch : [];

          if (!apiKey) {
            return Response.json({ error: "Chave API não fornecida." }, { status: 400 });
          }

          if (batch.length === 0) {
            return Response.json({ error: "Lote vazio." }, { status: 400 });
          }

          const safeBatch = batch
            .map((row) => ({
              id: Number(row.id),
              url: asString(row.url, 500),
              title: asString(row.title, 160),
              description: asString(row.description, 220),
            }))
            .filter((row) => Number.isFinite(row.id) && row.url.length > 0);

          if (safeBatch.length === 0) {
            return Response.json({ error: "Lote inválido." }, { status: 400 });
          }

          const ids = new Set(safeBatch.map((row) => row.id));
          const settledPages = await scrapeBatch(safeBatch);
          const systemPrompt = buildSystemPrompt(brandPersona);

          const enrichedBatch: BatchItem[] = settledPages.map((result, index) => {
            const scraped = result.status === "fulfilled" ? result.value : EMPTY_SCRAPED_PAGE;
            return {
              id: safeBatch[index].id,
              url: safeBatch[index].url,
              title_atual: safeBatch[index].title || scraped.fallbackTitle,
              desc_atual: safeBatch[index].description || scraped.fallbackDesc,
              conteudo_extraido: scraped.bodyText,
            };
          });

          const adapter = getAdapter(provider, apiKey);
          const rawResultados = await adapter.optimizeBatch({
            apiKey,
            provider,
            systemPrompt,
            batch: enrichedBatch,
          });

          const resultados = normalizeResults(rawResultados, ids);
          return Response.json({ resultados });
        } catch (err: unknown) {
          const status =
            err && typeof err === "object" && "status" in err
              ? Number((err as { status?: unknown }).status) || 500
              : 500;
          const message = err instanceof Error ? err.message : "Erro interno no servidor de IA.";

          // Tratar Rate Limits e Quota
          if (status === 429 || status === 402) {
            return Response.json({ error: message }, { status });
          }

          return Response.json({ error: message }, { status: 500 });
        }
      },
    },
  },
});
