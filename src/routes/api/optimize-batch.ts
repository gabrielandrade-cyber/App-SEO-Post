import { createFileRoute } from "@tanstack/react-router";
import OpenAI from "openai";

interface BatchRow {
  id: number;
  url: string;
  title?: string;
  description?: string;
}

interface OptimizeBatchPayload {
  apiKey?: string;
  provider?: string;
  userPrompt?: string;
  batch?: BatchRow[];
}

interface BatchResult {
  id: number;
  newTitle: string;
  newDescription: string;
  titleJustification: string;
  descriptionJustification: string;
}

const SYSTEM_PROMPT = `Você é um Especialista Sênior em SEO. Aplique RIGOROSAMENTE as regras fornecidas pelo usuário para a lista de páginas abaixo.
Para cada página, você receberá a URL, os metadados atuais e um 'conteudo_extraido' (raspado da página). Baseie sua reescrita nesse conteúdo real.
OBRIGATÓRIO responder num JSON contendo um array chamado 'resultados'.
Cada objeto do array deve ter as chaves exatas:

'id' (número original)

'newTitle' (título otimizado, respeitando o limite de caracteres)

'newDescription' (descrição otimizada e persuasiva)

'titleJustification' (justificativa técnica detalhada para o título escolhido)

'descriptionJustification' (justificativa técnica detalhada para a descrição escolhida)
Não abrevie as respostas. Preencha os campos de justificativa.`;

const SCRAPE_TIMEOUT_MS = 5000;
const MAX_EXTRACTED_CONTENT_CHARS = 1500;

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

async function scrapeUrl(url: string): Promise<string> {
  if (!/^https?:\/\//i.test(url)) return "";

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SCRAPE_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: {
        Accept: "text/html,application/xhtml+xml",
      },
      signal: controller.signal,
    });

    if (!response.ok) return "";

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("text/html")) return "";

    return extractBodyText(await response.text());
  } catch {
    return "";
  } finally {
    clearTimeout(timeout);
  }
}

function parseJsonObject(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    return match ? JSON.parse(match[0]) : null;
  }
}

function normalizeResults(raw: unknown, ids: Set<number>): BatchResult[] {
  const container = raw as { resultados?: unknown };
  const resultados = Array.isArray(container?.resultados) ? container.resultados : [];

  return resultados
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
        const body = (await request.json().catch(() => null)) as OptimizeBatchPayload | null;
        const apiKey = body?.apiKey?.trim();
        const provider = body?.provider?.trim() || "openai";
        const userPrompt = asString(body?.userPrompt, 12000);
        const batch = Array.isArray(body?.batch) ? body.batch : [];

        if (!apiKey) {
          return Response.json({ error: "apiKey em falta" }, { status: 400 });
        }

        if (batch.length === 0) {
          return Response.json({ error: "batch vazio" }, { status: 400 });
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
          return Response.json({ error: "batch vazio" }, { status: 400 });
        }

        const ids = new Set(safeBatch.map((row) => row.id));
        const settledPages = await Promise.allSettled(safeBatch.map((row) => scrapeUrl(row.url)));

        const enrichedBatch = settledPages.map((result, index) => {
          let conteudo = result.status === "fulfilled" ? result.value : "";

          if (provider === "cerebras") {
            conteudo = conteudo.slice(0, 300);
          }

          return {
            id: safeBatch[index].id,
            url: safeBatch[index].url,
            title_atual: safeBatch[index].title,
            desc_atual: safeBatch[index].description,
            conteudo_extraido: conteudo,
          };
        });

        try {
          let content = "{}";

          if (provider === "gemini") {
            const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

            const geminiPayload = {
              systemInstruction: {
                parts: [
                  {
                    text: `${SYSTEM_PROMPT}\n\nREGRAS DO USUÁRIO:\n${userPrompt || "Otimize titles e descriptions para SEO."}`,
                  },
                ],
              },
              contents: [
                {
                  role: "user",
                  parts: [{ text: JSON.stringify({ batch: enrichedBatch }) }],
                },
              ],
              generationConfig: {
                temperature: 0.3,
                responseMimeType: "application/json",
              },
              safetySettings: [
                { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
                { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
                { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
                { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
              ],
            };

            const geminiRes = await fetch(geminiUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(geminiPayload),
            });

            if (!geminiRes.ok) {
              const errorText = await geminiRes.text();
              console.error("Gemini Raw Error:", errorText);
              let errorMessage = `Erro Gemini HTTP ${geminiRes.status}`;
              try {
                const parsedErr = JSON.parse(errorText);
                if (parsedErr.error && parsedErr.error.message) {
                  errorMessage = `Gemini: ${parsedErr.error.message}`;
                }
              } catch (e) {}
              throw Object.assign(new Error(errorMessage), { status: geminiRes.status });
            }

            const geminiData = await geminiRes.json();

            const firstCandidate = geminiData.candidates?.[0];
            if (firstCandidate?.finishReason !== "STOP") {
              throw new Error(
                `Geração Gemini interrompida. Motivo: ${firstCandidate?.finishReason || "Desconhecido"}`,
              );
            }

            content = firstCandidate?.content?.parts?.[0]?.text ?? "{}";
          } else {
            // Integração Padrão OpenAI (Groq, Cerebras, ChatGPT)
            let baseURL: string | undefined = undefined;
            let model = "gpt-4o-mini";

            if (provider === "groq") {
              baseURL = "https://api.groq.com/openai/v1";
              model = "llama-3.3-70b-versatile";
            } else if (provider === "cerebras") {
              baseURL = "https://api.cerebras.ai/v1";
              model = "gpt-oss-120b";
            }

            const client = new OpenAI({ apiKey, baseURL });
            const completion = await client.chat.completions.create({
              model,
              temperature: 0.3,
              response_format: { type: "json_object" },
              messages: [
                {
                  role: "system",
                  content: `${SYSTEM_PROMPT}\n\nREGRAS DO USUÁRIO:\n${userPrompt || "Otimize titles e descriptions para SEO."}`,
                },
                { role: "user", content: JSON.stringify({ batch: enrichedBatch }) },
              ],
            });

            content = completion.choices[0]?.message?.content ?? "{}";
          }
          const parsed = parseJsonObject(content);
          const resultados = normalizeResults(parsed, ids);

          return Response.json({ resultados });
        } catch (err) {
          const status = Number((err as { status?: number })?.status) || 500;
          const message = err instanceof Error ? err.message : "erro ia";
          const responseStatus = status === 429 || status === 402 || status === 401 ? status : 500;

          return Response.json({ error: message }, { status: responseStatus });
        }
      },
    },
  },
});
