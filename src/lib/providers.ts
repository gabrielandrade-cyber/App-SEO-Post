/**
 * Fonte unica de verdade sobre os provedores de IA suportados.
 *
 * Usado tanto no cliente (rotulos, tamanhos de lote, links de chave) quanto
 * no servidor (modelos, base URLs, ritmo de requisicoes). Alterar um modelo
 * aqui reflete em todo o app.
 *
 * Modelos conferidos em 04/09/2026 contra a documentacao oficial de cada
 * provedor. `fallbackModels` so entra em acao quando o modelo principal
 * responde 404 / "model not found" (modelo descontinuado), nunca em erro de
 * quota, chave ou rede.
 */

export type AIProvider = "gemini" | "groq" | "cerebras" | "openai";
export type VisionProvider = "gemini" | "groq" | "openai";

export interface ProviderMeta {
  label: string;
  /** Modelo de texto usado no SERP Optimizer. */
  textModel: string;
  /** Modelos tentados em sequencia se o principal estiver descontinuado. */
  fallbackModels: string[];
  /** Modelo multimodal usado no Image Optimizer (undefined = sem visao). */
  visionModel?: string;
  /** Base URL compativel com a API da OpenAI (undefined = SDK/REST proprio). */
  baseURL?: string;
  /** Quantas linhas do CSV vao em cada requisicao para a IA. */
  batchSize: number;
  /**
   * Quantas requisicoes ficam em voo ao mesmo tempo. Cada uma e uma invocacao
   * separada do Worker, entao os limites do Cloudflare (CPU, subrequests)
   * valem por requisicao e nao pelo total. O teto real e o rate limit (RPM e
   * TPM) da conta no provedor: se aparecer 429 com frequencia, reduzir aqui.
   */
  concurrency: number;
  /** Pausa entre lancamentos de requisicoes, para segurar o RPM. */
  batchDelayMs: number;
  /** Provedor costuma ser usado no free tier (rate limit apertado). */
  freeTier: boolean;
  keyPlaceholder: string;
  keyUrl: string;
  /** Texto curto exibido na UI ao lado do provedor. */
  hint: string;
}

export const PROVIDER_META: Record<AIProvider, ProviderMeta> = {
  openai: {
    label: "ChatGPT",
    textModel: "gpt-5.6-luna",
    fallbackModels: ["gpt-5.6", "gpt-4.1-mini"],
    visionModel: "gpt-5.6-luna",
    batchSize: 20,
    concurrency: 3,
    batchDelayMs: 400,
    freeTier: false,
    keyPlaceholder: "sk-...",
    keyUrl: "https://platform.openai.com/api-keys",
    hint: "GPT-5.6 Luna: rapido, barato (US$ 0,20/M tokens) e contexto de 1M. Requer creditos.",
  },
  gemini: {
    label: "Gemini",
    textModel: "gemini-3.5-flash-lite",
    fallbackModels: ["gemini-3.1-flash-lite", "gemini-2.5-flash-lite"],
    visionModel: "gemini-3.5-flash-lite",
    batchSize: 10,
    concurrency: 2,
    batchDelayMs: 3000,
    freeTier: true,
    keyPlaceholder: "AIzaSy...",
    keyUrl: "https://aistudio.google.com/app/apikey",
    hint: "Gemini 3.5 Flash-Lite: o modelo do Google para alto volume e baixo custo, com contexto de 1M.",
  },
  groq: {
    label: "Groq",
    textModel: "openai/gpt-oss-120b",
    fallbackModels: ["llama-3.3-70b-versatile"],
    visionModel: "qwen/qwen3.8-27b",
    baseURL: "https://api.groq.com/openai/v1",
    batchSize: 5,
    concurrency: 1,
    batchDelayMs: 2500,
    freeTier: true,
    keyPlaceholder: "gsk_...",
    keyUrl: "https://console.groq.com/keys",
    hint: "GPT-OSS 120B servido pela Groq: qualidade proxima do GPT, ultrarrapido, free tier generoso.",
  },
  cerebras: {
    label: "Cerebras",
    textModel: "gpt-oss-120b",
    fallbackModels: ["qwen-3.8-27b"],
    baseURL: "https://api.cerebras.ai/v1",
    batchSize: 3,
    concurrency: 1,
    batchDelayMs: 6000,
    freeTier: true,
    keyPlaceholder: "csk-...",
    keyUrl: "https://cloud.cerebras.ai",
    hint: "GPT-OSS 120B a ~3000 tokens/s. Sem visao. Free tier limitado a poucos pedidos por minuto.",
  },
};

export const AI_PROVIDERS: AIProvider[] = ["openai", "gemini", "groq", "cerebras"];
export const VISION_PROVIDERS: VisionProvider[] = ["gemini", "openai", "groq"];

export const PROVIDER_LABELS: Record<AIProvider, string> = {
  openai: PROVIDER_META.openai.label,
  gemini: PROVIDER_META.gemini.label,
  groq: PROVIDER_META.groq.label,
  cerebras: PROVIDER_META.cerebras.label,
};

export function isAIProvider(value: unknown): value is AIProvider {
  return typeof value === "string" && (AI_PROVIDERS as string[]).includes(value);
}

export function isVisionProvider(value: unknown): value is VisionProvider {
  return typeof value === "string" && (VISION_PROVIDERS as string[]).includes(value);
}

/** Maximo de linhas que o endpoint de lote aceita numa unica requisicao. */
export const MAX_BATCH_ROWS = 25;

/** Faixas de caracteres da SERP, contando espacos (diretriz liveSEO). */
export const SERP_LIMITS = {
  title: { min: 50, max: 58 },
  description: { min: 150, max: 160 },
} as const;

/** Comprimento como o Google e a planilha contam: NFC, com espacos. */
export function serpLength(text: string): number {
  return Array.from(text.normalize("NFC")).length;
}

/** true quando title ou description gerados estao fora da faixa. */
export function isOutOfRange(row: { newTitle?: string; newDescription?: string }): boolean {
  if (!row.newTitle || !row.newDescription) return false;
  const titleLen = serpLength(row.newTitle);
  const descLen = serpLength(row.newDescription);
  return (
    titleLen < SERP_LIMITS.title.min ||
    titleLen > SERP_LIMITS.title.max ||
    descLen < SERP_LIMITS.description.min ||
    descLen > SERP_LIMITS.description.max
  );
}
