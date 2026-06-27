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

const SCRAPE_TIMEOUT_MS = 8000;
const MAX_EXTRACTED_CONTENT_CHARS = 2000;

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

function extractBodyText(html: string): string {
  const body = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? html;
  const withoutNoise = body
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ");

  return decodeHtmlEntities(withoutNoise)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_EXTRACTED_CONTENT_CHARS);
}

function extractMetadata(html: string): ScrapedPage {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const descMatch =
    html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)["'][^>]*>/i) ||
    html.match(/<meta[^>]*content=["']([^"']*)["'][^>]*name=["']description["'][^>]*>/i);

  return {
    fallbackTitle: titleMatch ? decodeHtmlEntities(titleMatch[1]).replace(/\s+/g, " ").trim() : "",
    fallbackDesc: descMatch ? decodeHtmlEntities(descMatch[1]).replace(/\s+/g, " ").trim() : "",
    bodyText: extractBodyText(html),
  };
}

async function scrapeUrl(url: string): Promise<ScrapedPage> {
  if (!/^https?:\/\//i.test(url)) return EMPTY_SCRAPED_PAGE;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SCRAPE_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
      },
      signal: controller.signal,
    });

    if (!response.ok) return EMPTY_SCRAPED_PAGE;

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("text/html")) return EMPTY_SCRAPED_PAGE;

    return extractMetadata(await response.text());
  } catch {
    return EMPTY_SCRAPED_PAGE;
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeResults(resultados: any[], ids: Set<number>): BatchResult[] {
  return (resultados || [])
    .map((item) => {
      const row = item as Record<string, unknown>;
      const id = Number(row.id);
      if (!ids.has(id)) return null;

      return {
        id,
        newTitle: asString(row.newTitle, 160),
        newDescription: asString(row.newDescription, 320),
        titleJustification: asString(row.titleJustification, 2000),
        descriptionJustification: asString(row.descriptionJustification, 2000),
      } satisfies BatchResult;
    })
    .filter((row): row is BatchResult => Boolean(row));
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
          const settledPages = await Promise.allSettled(safeBatch.map((row) => scrapeUrl(row.url)));
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
        } catch (err: any) {
          const status = err.status || 500;
          const message = err.message || "Erro interno no servidor de IA.";

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
