import { createServerFn } from "@tanstack/react-start";
import OpenAI from "openai";
import type { AIProvider } from "./store";

export type OptimizeField = "title" | "description";

export interface AIResponse {
  text: string;
  justification?: string;
  error?: string;
  success?: boolean;
  retryAfter?: number;
}

export interface BatchResult {
  id: number;
  newTitle: string;
  newDescription: string;
  titleJustification: string;
  descriptionJustification: string;
}

export interface OptimizeFieldPayload {
  provider: AIProvider;
  apiKey: string;
  systemPrompt: string;
  targetUrl: string;
  field: OptimizeField;
}

export interface BatchItem {
  id: number;
  url: string;
  title_atual: string;
  desc_atual: string;
  conteudo_extraido: string;
}

export interface OptimizeBatchPayloadInternal {
  apiKey: string;
  systemPrompt: string;
  batch: BatchItem[];
  provider: AIProvider;
}

// ─── Utilities ───────────────────────────────────────────────────────────────

export function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function cleanMarkdown(text: string): string {
  return text.replace(/```json\n?|```/g, "").trim();
}

function parseJSONSafely(text: string): any {
  const cleaned = cleanMarkdown(text);
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    // Try to find JSON block
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        throw new Error("Falha ao processar resposta JSON da IA.");
      }
    }
    throw new Error("A IA não retornou um formato JSON válido.");
  }
}

// ─── Adapters ────────────────────────────────────────────────────────────────

interface AIAdapter {
  optimizeField(payload: OptimizeFieldPayload): Promise<AIResponse>;
  optimizeBatch(payload: OptimizeBatchPayloadInternal): Promise<BatchResult[]>;
}

class OpenAIAdapter implements AIAdapter {
  private client: OpenAI;
  private model: string;

  constructor(apiKey: string, baseURL?: string, model: string = "gpt-4o-mini") {
    this.client = new OpenAI({ apiKey, baseURL, dangerouslyAllowBrowser: false });
    this.model = model;
  }

  async optimizeField(payload: OptimizeFieldPayload): Promise<AIResponse> {
    try {
      const completion = await this.client.chat.completions.create({
        model: this.model,
        temperature: 0.3,
        messages: [
          { role: "system", content: payload.systemPrompt },
          { role: "user", content: `URL: ${payload.targetUrl}` },
        ],
        response_format: { type: "json_object" },
      });

      const content = completion.choices[0]?.message?.content || "{}";
      const parsed = parseJSONSafely(content);
      return {
        text: parsed.text || parsed.title || parsed.description || "",
        justification: parsed.justification || "",
        success: true,
      };
    } catch (err: any) {
      return this.handleError(err);
    }
  }

  async optimizeBatch(payload: OptimizeBatchPayloadInternal): Promise<BatchResult[]> {
    const completion = await this.client.chat.completions.create({
      model: this.model,
      temperature: 0.3,
      messages: [
        { role: "system", content: payload.systemPrompt },
        { role: "user", content: JSON.stringify({ batch: payload.batch }) },
      ],
      response_format: { type: "json_object" },
    });

    const content = completion.choices[0]?.message?.content || "{}";
    const parsed = parseJSONSafely(content);
    return parsed.resultados || [];
  }

  private handleError(err: any): AIResponse {
    const status = err.status || 500;
    if (status === 429) {
      return {
        text: "",
        error: "Limite de taxa atingido (429). Por favor, aguarde.",
        success: false,
        retryAfter: 5000,
      };
    }
    return { text: "", error: err.message || "Erro na API", success: false };
  }
}

class GeminiAdapter implements AIAdapter {
  private apiKey: string;
  private model: string = "gemini-2.0-flash";

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async optimizeField(payload: OptimizeFieldPayload): Promise<AIResponse> {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: payload.systemPrompt }] },
          contents: [{ parts: [{ text: `URL: ${payload.targetUrl}` }] }],
          generationConfig: {
            temperature: 0.3,
            responseMimeType: "application/json",
          },
        }),
      });

      if (!res.ok) throw await this.createError(res);

      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
      const parsed = parseJSONSafely(text);
      return {
        text: parsed.text || parsed.title || parsed.description || "",
        justification: parsed.justification || "",
        success: true,
      };
    } catch (err: any) {
      return this.handleError(err);
    }
  }

  async optimizeBatch(payload: OptimizeBatchPayloadInternal): Promise<BatchResult[]> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: payload.systemPrompt }] },
        contents: [{ parts: [{ text: JSON.stringify({ batch: payload.batch }) }] }],
        generationConfig: {
          temperature: 0.3,
          responseMimeType: "application/json",
        },
      }),
    });

    if (!res.ok) throw await this.createError(res);

    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
    const parsed = parseJSONSafely(text);
    return parsed.resultados || [];
  }

  private async createError(res: Response) {
    const body = await res.json().catch(() => ({}));
    const message = body.error?.message || `HTTP ${res.status}`;
    const err = new Error(message) as any;
    err.status = res.status;
    return err;
  }

  private handleError(err: any): AIResponse {
    if (err.status === 429) {
      return {
        text: "",
        error: "Gemini: Limite de cota atingido. Aguarde alguns instantes.",
        success: false,
        retryAfter: 5000,
      };
    }
    return { text: "", error: `Gemini: ${err.message}`, success: false };
  }
}

// ─── Factory ─────────────────────────────────────────────────────────────────

export function getAdapter(provider: AIProvider, apiKey: string): AIAdapter {
  switch (provider) {
    case "gemini":
      return new GeminiAdapter(apiKey);
    case "groq":
      return new OpenAIAdapter(apiKey, "https://api.groq.com/openai/v1", "llama-3.3-70b-versatile");
    case "cerebras":
      return new OpenAIAdapter(apiKey, "https://api.cerebras.ai/v1", "llama3.1-8b");
    case "openai":
    default:
      return new OpenAIAdapter(apiKey, undefined, "gpt-4o-mini");
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

export const optimizeField = (createServerFn({ method: "POST" }) as any)
  .inputValidator((data: OptimizeFieldPayload) => data)
  .handler(async ({ data }: { data: OptimizeFieldPayload }): Promise<AIResponse> => {
    const { provider, apiKey } = data;
    if (!apiKey?.trim()) {
      return { text: "", error: "API Key não fornecida.", success: false };
    }

    const adapter = getAdapter(provider, apiKey);
    return adapter.optimizeField(data);
  });
