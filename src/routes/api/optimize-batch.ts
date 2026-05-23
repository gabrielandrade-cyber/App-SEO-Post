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
  model?: string;
  batch?: BatchRow[];
}

interface BatchResult {
  id: number;
  newTitle: string;
  newDescription: string;
  titleJustification: string;
  descriptionJustification: string;
}

const SYSTEM_PROMPT =
  'analisa o array json fornecido com ids. devolve um json com a chave "resultados" contendo um array onde cada objeto tem o id original, newTitle e newDescription otimizados. newTitle max 60 caracteres. newDescription max 150 caracteres. nao justifiques.';

function asString(value: unknown, max = 500): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
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
        newTitle: asString(row.newTitle, 60),
        newDescription: asString(row.newDescription, 150),
        titleJustification: "",
        descriptionJustification: "",
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
        const model = body?.model?.trim() || "gpt-4o-mini";
        const batch = Array.isArray(body?.batch) ? body.batch.slice(0, 20) : [];

        if (!apiKey) {
          return Response.json({ error: "apiKey em falta" }, { status: 400 });
        }

        if (batch.length === 0) {
          return Response.json({ error: "batch vazio" }, { status: 400 });
        }

        const safeBatch = batch.map((row) => ({
          id: Number(row.id),
          url: asString(row.url, 500),
          title: asString(row.title, 160),
          description: asString(row.description, 220),
        }));

        const ids = new Set(safeBatch.map((row) => row.id));

        try {
          const client = new OpenAI({ apiKey });
          const completion = await client.chat.completions.create({
            model,
            temperature: 0.1,
            max_tokens: 150 * safeBatch.length,
            response_format: { type: "json_object" },
            messages: [
              { role: "system", content: SYSTEM_PROMPT },
              { role: "user", content: JSON.stringify({ batch: safeBatch }) },
            ],
          });

          const content = completion.choices[0]?.message?.content ?? "{}";
          const parsed = parseJsonObject(content);
          const resultados = normalizeResults(parsed, ids);

          return Response.json({ resultados });
        } catch (err) {
          const status = Number((err as { status?: number })?.status) || 500;
          const message = err instanceof Error ? err.message : "erro openai";
          const responseStatus = status === 429 || status === 402 || status === 401 ? status : 500;

          return Response.json({ error: message }, { status: responseStatus });
        }
      },
    },
  },
});
