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
  newTitle?: string;
  newDescription?: string;
  titleJustification?: string;
  descriptionJustification?: string;
  optimizationError?: string;
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

interface BatchQueueConfig {
  chunkSize: number;
  concurrency: number;
  requestDelayMs: number;
}

interface ChunkOutcome {
  index: number;
  ids: number[];
  results: BatchResult[];
  error?: unknown;
}

interface OpenAIAdapterOptions {
  useJsonMode?: boolean;
  minCompletionTokens?: number;
  reasoningEffort?: "none" | "low" | "medium" | "high";
}

const AI_REQUEST_TIMEOUT_MS = 45000;
const RETRY_DELAYS_MS = [2000, 5000];

const BATCH_QUEUE_CONFIG: Record<AIProvider, BatchQueueConfig> = {
  openai: { chunkSize: 20, concurrency: 1, requestDelayMs: 0 },
  gemini: { chunkSize: 1, concurrency: 1, requestDelayMs: 2500 },
  groq: { chunkSize: 1, concurrency: 1, requestDelayMs: 2200 },
  cerebras: { chunkSize: 1, concurrency: 1, requestDelayMs: 12500 },
};

// ─── Utilities ───────────────────────────────────────────────────────────────

export function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function chunkBatch(batch: BatchItem[], chunkSize: number): BatchItem[][] {
  const chunks: BatchItem[][] = [];
  for (let index = 0; index < batch.length; index += chunkSize) {
    chunks.push(batch.slice(index, index + chunkSize));
  }
  return chunks;
}

function getErrorStatus(err: unknown): number | undefined {
  if (!err || typeof err !== "object") return undefined;
  return (err as { status?: number; code?: number }).status ?? (err as { code?: number }).code;
}

function getHeaderValue(headers: unknown, name: string): string | null {
  if (!headers) return null;
  const lowerName = name.toLowerCase();

  if (headers instanceof Headers) return headers.get(name);

  if (typeof headers === "object") {
    const record = headers as Record<string, unknown>;
    const value = record[name] ?? record[lowerName];
    return typeof value === "string" ? value : null;
  }

  return null;
}

function parseRetryAfterMs(err: unknown): number | null {
  if (!err || typeof err !== "object") return null;
  const retryAfter =
    (err as { retryAfter?: number }).retryAfter ??
    Number(getHeaderValue((err as { headers?: unknown }).headers, "retry-after"));

  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return Math.min(retryAfter * 1000, 30000);
  }

  const retryAfterHeader = getHeaderValue((err as { headers?: unknown }).headers, "retry-after");
  if (retryAfterHeader) {
    const dateMs = Date.parse(retryAfterHeader);
    if (Number.isFinite(dateMs)) return Math.min(Math.max(dateMs - Date.now(), 0), 30000);
  }

  return null;
}

function isRetryableError(err: unknown): boolean {
  const status = getErrorStatus(err);
  if (status && [408, 409, 429, 500, 502, 503, 504].includes(status)) return true;

  const name = err instanceof Error ? err.name.toLowerCase() : "";
  const message = err instanceof Error ? err.message.toLowerCase() : "";
  return (
    name.includes("abort") ||
    message.includes("timeout") ||
    message.includes("timed out") ||
    message.includes("aborted") ||
    message.includes("fetch failed") ||
    message.includes("network") ||
    message.includes("econnreset")
  );
}

function formatProviderError(provider: AIProvider, err: unknown): string {
  const status = getErrorStatus(err);
  const message = err instanceof Error ? err.message : "Erro desconhecido.";
  const providerLabel = provider === "openai" ? "ChatGPT" : provider;

  if (status === 429) {
    return `${providerLabel}: limite de requisicoes atingido apos novas tentativas.`;
  }

  if (status === 503 || status === 504 || status === 408) {
    return `${providerLabel}: API indisponivel ou lenta apos novas tentativas.`;
  }

  return `${providerLabel}: ${message}`;
}

async function withRetry<T>(provider: AIProvider, operation: () => Promise<T>): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      return await operation();
    } catch (err) {
      lastError = err;

      if (!isRetryableError(err) || attempt === RETRY_DELAYS_MS.length) {
        throw err;
      }

      const retryAfterMs = parseRetryAfterMs(err);
      const delayMs = retryAfterMs ?? RETRY_DELAYS_MS[attempt];
      await delay(delayMs);
    }
  }

  throw lastError;
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AI_REQUEST_TIMEOUT_MS);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function completionBudgetForRows(rowCount: number): number {
  return Math.min(4000, Math.max(700, rowCount * 420));
}

function hasBatchResults(results: unknown, ids: Set<number>): boolean {
  if (!Array.isArray(results)) return false;
  return results.some((item) => {
    if (!item || typeof item !== "object") return false;
    return ids.has(Number((item as { id?: unknown }).id));
  });
}

async function optimizeBatchWithQueue(
  provider: AIProvider,
  payload: OptimizeBatchPayloadInternal,
  requestChunk: (chunk: BatchItem[]) => Promise<BatchResult[]>,
): Promise<BatchResult[]> {
  const config = BATCH_QUEUE_CONFIG[provider];
  const chunks = chunkBatch(payload.batch, config.chunkSize);
  const outcomes: ChunkOutcome[] = new Array(chunks.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < chunks.length) {
      const index = nextIndex;
      nextIndex += 1;

      if (config.requestDelayMs > 0 && index > 0) {
        await delay(config.requestDelayMs);
      }

      const chunk = chunks[index];
      try {
        outcomes[index] = {
          index,
          ids: chunk.map((item) => item.id),
          results: await requestChunk(chunk),
        };
      } catch (error) {
        outcomes[index] = {
          index,
          ids: chunk.map((item) => item.id),
          results: [],
          error,
        };
      }
    }
  }

  await Promise.all(Array.from({ length: config.concurrency }, () => worker()));

  const successfulResults = outcomes.flatMap((outcome) => outcome.results);
  const failedOutcomes = outcomes.filter((outcome) => outcome.error);

  if (failedOutcomes.length > 0 && successfulResults.length === 0) {
    throw failedOutcomes[0].error;
  }

  return outcomes.flatMap((outcome) => {
    if (!outcome.error) return outcome.results;

    return outcome.ids.map((id) => ({
      id,
      optimizationError: formatProviderError(provider, outcome.error),
    }));
  });
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
  private models: string[];
  private provider: AIProvider;
  private useJsonMode: boolean;
  private minCompletionTokens: number;
  private reasoningEffort?: "none" | "low" | "medium" | "high";

  constructor(
    apiKey: string,
    baseURL?: string,
    model: string | string[] = "gpt-4o-mini",
    provider: AIProvider = "openai",
    options: OpenAIAdapterOptions = {},
  ) {
    this.client = new OpenAI({ apiKey, baseURL, dangerouslyAllowBrowser: false });
    this.models = Array.isArray(model) ? model : [model];
    this.provider = provider;
    this.useJsonMode = options.useJsonMode ?? true;
    this.minCompletionTokens = options.minCompletionTokens ?? 700;
    this.reasoningEffort = options.reasoningEffort;
  }

  async optimizeField(payload: OptimizeFieldPayload): Promise<AIResponse> {
    try {
      const content = await this.createChatCompletionContent({
        temperature: 0.3,
        messages: [
          { role: "system", content: payload.systemPrompt },
          { role: "user", content: `URL: ${payload.targetUrl}` },
        ],
        maxCompletionTokens: 700,
      });

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
    return optimizeBatchWithQueue(this.provider, payload, (chunk) => this.requestBatch(payload, chunk));
  }

  private async requestBatch(
    payload: OptimizeBatchPayloadInternal,
    chunk: BatchItem[],
  ): Promise<BatchResult[]> {
    const ids = new Set(chunk.map((item) => item.id));
    const content = await this.createChatCompletionContent({
      temperature: 0.3,
      messages: [
        { role: "system", content: payload.systemPrompt },
        {
          role: "user",
          content: [
            "Retorne somente JSON valido no formato solicitado.",
            "Nao escreva markdown, comentario ou texto fora do JSON.",
            JSON.stringify({ batch: chunk }),
          ].join("\n"),
        },
      ],
      maxCompletionTokens: completionBudgetForRows(chunk.length),
      validate: (text) => {
        const parsed = parseJSONSafely(text);
        if (!hasBatchResults(parsed.resultados, ids)) {
          throw new Error("A IA retornou JSON valido, mas sem resultados para este lote.");
        }
      },
    });

    const parsed = parseJSONSafely(content);
    return parsed.resultados || [];
  }

  private async createChatCompletionContent({
    temperature,
    messages,
    maxCompletionTokens,
    validate,
  }: {
    temperature: number;
    messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
    maxCompletionTokens: number;
    validate?: (content: string) => void;
  }): Promise<string> {
    let lastError: unknown;

    for (const model of this.models) {
      try {
        const request: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = {
          model,
          temperature,
          messages,
          max_completion_tokens: Math.max(maxCompletionTokens, this.minCompletionTokens),
        };

        if (this.useJsonMode) {
          request.response_format = { type: "json_object" };
        }

        if (this.reasoningEffort) {
          (request as { reasoning_effort?: "none" | "low" | "medium" | "high" }).reasoning_effort =
            this.reasoningEffort;
        }

        const completion = await withRetry(this.provider, () =>
          this.client.chat.completions.create(request, { timeout: AI_REQUEST_TIMEOUT_MS }),
        );

        const content = completion.choices[0]?.message?.content?.trim();
        if (!content) throw new Error(`${this.provider}: resposta vazia do modelo ${model}.`);

        validate?.(content);
        return content;
      } catch (err) {
        lastError = err;
      }
    }

    throw lastError;
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
  private model: string = "gemini-2.5-flash-lite";

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async optimizeField(payload: OptimizeFieldPayload): Promise<AIResponse> {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;
      const res = await withRetry("gemini", () =>
        fetchWithTimeout(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: payload.systemPrompt }] },
            contents: [{ parts: [{ text: `URL: ${payload.targetUrl}` }] }],
            generationConfig: {
              temperature: 0.3,
              responseMimeType: "application/json",
              maxOutputTokens: 700,
            },
          }),
        }),
      );

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
    return optimizeBatchWithQueue("gemini", payload, (chunk) => this.requestBatch(payload, chunk));
  }

  private async requestBatch(
    payload: OptimizeBatchPayloadInternal,
    chunk: BatchItem[],
  ): Promise<BatchResult[]> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;
    const res = await withRetry("gemini", () =>
      fetchWithTimeout(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: payload.systemPrompt }] },
          contents: [{ parts: [{ text: JSON.stringify({ batch: chunk }) }] }],
          generationConfig: {
            temperature: 0.3,
            responseMimeType: "application/json",
            maxOutputTokens: completionBudgetForRows(chunk.length),
          },
        }),
      }),
    );

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
    err.headers = res.headers;
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
      return new OpenAIAdapter(
        apiKey,
        "https://api.groq.com/openai/v1",
        "llama-3.3-70b-versatile",
        "groq",
      );
    case "cerebras":
      return new OpenAIAdapter(
        apiKey,
        "https://api.cerebras.ai/v1",
        ["llama-3.3-70b", "llama3.1-8b", "zai-glm-4.7"],
        "cerebras",
        { useJsonMode: false, minCompletionTokens: 1200, reasoningEffort: "none" },
      );
    case "openai":
    default:
      return new OpenAIAdapter(apiKey, undefined, "gpt-4o-mini", "openai");
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
