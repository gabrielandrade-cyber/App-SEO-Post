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
  userPrompt?: string; // Recebe as suas regras do Frontend
  batch?: BatchRow[];
}

interface BatchResult {
  id: number;
  newTitle: string;
  newDescription: string;
  titleJustification: string;
  descriptionJustification: string;
}

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
        newTitle: asString(row.newTitle, 65), // Expandido para não cortar títulos de 60
        newDescription: asString(row.newDescription, 160), // Expandido para não cortar descrições
        titleJustification: asString(row.titleJustification, 300),
        descriptionJustification: asString(row.descriptionJustification, 300),
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
        const userPrompt = body?.userPrompt?.trim() || "";
        const batch = Array.isArray(body?.batch) ? body.batch.slice(0, 20) : [];

        if (!apiKey) return Response.json({ error: "apiKey em falta" }, { status: 400 });
        if (batch.length === 0) return Response.json({ error: "batch vazio" }, { status: 400 });

        const safeBatch = batch.map((row) => ({
          id: Number(row.id),
          url: asString(row.url, 500),
          title: asString(row.title, 160),
          description: asString(row.description, 220),
        }));

        const ids = new Set(safeBatch.map((row) => row.id));

        // Aqui é onde fundimos o SEU prompt com a regra de batch
        const SYSTEM_PROMPT = `${userPrompt}
        
ATENÇÃO IA: Ignore qualquer instrução para devolver a resposta como um objeto JSON individual.
APLIQUE RIGOROSAMENTE todas as regras de SEO descritas acima na lista de URLs fornecida.
Devolva OBRIGATORIAMENTE um JSON contendo a chave "resultados", que deve ser um Array.
Cada objeto do array DEVE conter exatamente estas chaves:
- "id" (o id numérico original)
- "newTitle" (o título gerado)
- "newDescription" (a description gerada)
- "titleJustification" (justificativa do título)
- "descriptionJustification" (justificativa da description)
Não escreva mais nada além do JSON final.`;

        try {
          const client = new OpenAI({ apiKey });
          const completion = await client.chat.completions.create({
            model,
            temperature: 0.2, // Um pouco mais de criatividade
            max_tokens: 350 * safeBatch.length, // Aumentado para permitir descrições ricas
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