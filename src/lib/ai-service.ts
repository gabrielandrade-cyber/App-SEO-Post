/**
 * AI Service — Multi-provider SEO optimization engine.
 *
 * Providers:
 *   • Google Gemini  → REST API (generativelanguage.googleapis.com) with model fallback
 *   • Groq           → OpenAI SDK (baseURL: api.groq.com)
 *   • Cerebras       → OpenAI SDK (baseURL: api.cerebras.ai)
 *
 * All OpenAI-compatible providers use `import OpenAI from "openai"` with
 * custom baseURL. System prompts are ALWAYS sent with role: "system".
 */

import OpenAI from "openai";
import type { AIProvider } from "./store";

export type OptimizeField = "title" | "description";

export interface AIResponse {
  text: string;
  error?: string;
  success?: boolean;
  retryAfter?: number;
}

export function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Delay between bulk requests (ms). */
export const BULK_DELAY_MS = 2000;

// ─── Response cleanup ────────────────────────────────────────────────────────

/**
 * Cleans up AI responses that may contain extra text, quotes, or explanations.
 * Extracts only the core SEO text.
 */
function cleanResponse(raw: string, field: OptimizeField): string {
  let text = raw.trim();

  // Remove wrapping quotes (single, double, or backtick)
  text = text.replace(/^["'`]+|["'`]+$/g, "");

  // If the model returned multiple lines, take only the first meaningful line
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length > 1) {
    const contentLine = lines.find((l) =>
      !l.startsWith("*") &&
      !l.startsWith("-") &&
      !l.startsWith("#") &&
      !l.toLowerCase().startsWith("aqui") &&
      !l.toLowerCase().startsWith("segue") &&
      !l.toLowerCase().startsWith("opção") &&
      !l.toLowerCase().startsWith("sugest") &&
      !l.toLowerCase().startsWith("meta title") &&
      !l.toLowerCase().startsWith("meta description") &&
      !l.toLowerCase().startsWith("título") &&
      !l.toLowerCase().startsWith("description") &&
      !l.includes("caracteres") &&
      l.length > 20
    );
    text = contentLine ?? lines[0];
  }

  // Remove any remaining wrapping quotes after line extraction
  text = text.replace(/^["'`]+|["'`]+$/g, "");

  // Enforce character limits — hard truncate if model was too verbose
  const maxChars = field === "title" ? 65 : 160;
  if (text.length > maxChars) {
    const truncated = text.substring(0, maxChars);
    const lastSpace = truncated.lastIndexOf(" ");
    text = lastSpace > maxChars * 0.7 ? truncated.substring(0, lastSpace) : truncated;
  }

  return text.trim();
}

// ─── Google Gemini (REST API with model fallback) ───────────────────────────

const GEMINI_MODELS = [
  "gemini-2.5-flash-lite",
  "gemini-2.0-flash",
  "gemini-1.5-flash",
  "gemini-1.5-flash-8b",
];

let geminiWorkingModel: string | null = null;

async function callGemini(
  apiKey: string,
  systemPrompt: string,
  url: string,
  field: OptimizeField,
): Promise<AIResponse> {
  const maxOutputTokens = field === "title" ? 40 : 100;
  const userMessage = `A URL alvo é: ${url}`;

  const tryModel = async (model: string): Promise<{ ok: boolean; quotaZero: boolean; response: AIResponse }> => {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents: [{ parts: [{ text: userMessage }] }],
          generationConfig: { temperature: 0.1, maxOutputTokens },
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        const apiMsg = body?.error?.message || `HTTP ${res.status}`;
        console.error(`[Gemini/${model}] Erro ${res.status}:`, apiMsg);

        const isQuotaZero = apiMsg.includes("limit: 0") || (res.status === 429 && apiMsg.includes("quota"));

        if (isQuotaZero || res.status === 404) {
          return { ok: false, quotaZero: true, response: { text: "", error: apiMsg, success: false } };
        }

        if (res.status === 429) {
          return {
            ok: false, quotaZero: false,
            response: {
              text: "",
              error: "[Gemini] Limite de requisições gratuitas atingido. Aguarde alguns segundos e tente novamente.",
              success: false,
              retryAfter: 5000,
            },
          };
        }

        return { ok: false, quotaZero: false, response: { text: "", error: `[Gemini] Erro ${res.status}: ${apiMsg}`, success: false } };
      }

      const data = await res.json();
      const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";
      if (!rawText) return { ok: false, quotaZero: false, response: { text: "", error: "[Gemini] Resposta vazia.", success: false } };

      const text = cleanResponse(rawText, field);
      console.log(`[Gemini/${model}] ✓ ${text.length} chars`);

      geminiWorkingModel = model;
      return { ok: true, quotaZero: false, response: { text, success: true } };
    } catch (err) {
      console.error(`[Gemini/${model}] Erro de rede:`, err);
      return { ok: false, quotaZero: false, response: { text: "", error: `[Gemini] Erro de rede: ${err instanceof Error ? err.message : "desconhecido"}`, success: false } };
    }
  };

  try {
    // Try cached model first
    if (geminiWorkingModel) {
      const result = await tryModel(geminiWorkingModel);
      if (result.ok) return result.response;
      if (!result.quotaZero) return result.response;
      geminiWorkingModel = null;
    }

    // Fallback chain
    const tried: string[] = [];
    for (const model of GEMINI_MODELS) {
      const result = await tryModel(model);
      if (result.ok) return result.response;
      if (result.quotaZero) { tried.push(model); continue; }
      return result.response;
    }

    return { text: "", error: `[Gemini] Nenhum modelo disponível. Testados: ${tried.join(", ")}. Troque para Groq, Cerebras ou OpenRouter.`, success: false };
  } catch (err) {
    console.error("[Gemini] Erro inesperado:", err);
    return { text: "", error: `[Gemini] ${err instanceof Error ? err.message : "Erro inesperado"}`, success: false };
  }
}

// ─── OpenAI-compatible providers (Groq, Cerebras) ───────────────

const OPENAI_PROVIDERS = {
  groq: {
    baseURL: "https://api.groq.com/openai/v1",
    model: "llama-3.3-70b-versatile",
    label: "Groq",
  },
  cerebras: {
    baseURL: "https://api.cerebras.ai/v1",
    model: "llama3.1-8b",
    label: "Cerebras",
  },
} as const;

type OpenAIProviderKey = keyof typeof OPENAI_PROVIDERS;

/**
 * Creates an OpenAI client configured for the given provider.
 * Uses the official `openai` npm package with custom baseURL.
 */
function createClient(provider: OpenAIProviderKey, apiKey: string): OpenAI {
  return new OpenAI({
    apiKey,
    baseURL: OPENAI_PROVIDERS[provider].baseURL,
    dangerouslyAllowBrowser: true,
  });
}

async function callOpenAIProvider(
  provider: OpenAIProviderKey,
  apiKey: string,
  systemPrompt: string,
  url: string,
  field: OptimizeField,
): Promise<AIResponse> {
  const config = OPENAI_PROVIDERS[provider];
  const maxTokens = field === "title" ? 40 : 100;

  try {
    console.log(`[${config.label}] Chamando modelo ${config.model}...`);

    const client = createClient(provider, apiKey);

    const completion = await client.chat.completions.create({
      model: config.model,
      temperature: 0.1,
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `A URL alvo é: ${url}` },
      ],
    });

    const rawText = completion.choices?.[0]?.message?.content?.trim() ?? "";
    if (!rawText) {
      console.error(`[${config.label}] Resposta vazia.`);
      return { text: "", error: `[${config.label}] Resposta vazia.`, success: false };
    }

    const text = cleanResponse(rawText, field);
    console.log(`[${config.label}] ✓ ${text.length} chars`);
    return { text, success: true };
  } catch (err: unknown) {
    // Extract status and message from OpenAI SDK errors
    const status = (err as { status?: number })?.status;
    const message = err instanceof Error ? err.message : "Erro desconhecido";
    console.error(`[${config.label}] Erro${status ? ` ${status}` : ""}:`, message);

    // ── Specific error handling ──
    if (status === 401) {
      return { text: "", error: `[${config.label}] API Key inválida. Verifique se copiou corretamente.`, success: false };
    }
    if (status === 429) {
      return {
        text: "",
        error: `[${config.label}] Limite de requisições gratuitas atingido. Aguarde alguns segundos e tente novamente.`,
        success: false,
        retryAfter: 5000,
      };
    }
    if (status === 400) {
      return { text: "", error: `[${config.label}] Requisição inválida (400): ${message}`, success: false };
    }
    if (status === 402) {
      return { text: "", error: `[${config.label}] Créditos insuficientes. Verifique sua conta.`, success: false };
    }

    return { text: "", error: `[${config.label}] ${message}`, success: false };
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function optimizeField(
  provider: AIProvider,
  apiKey: string,
  systemPrompt: string,
  targetUrl: string,
  field: OptimizeField,
): Promise<AIResponse> {
  try {
    if (provider === "gemini") {
      return await callGemini(apiKey, systemPrompt, targetUrl, field);
    }

    // Groq, Cerebras → all use OpenAI SDK
    return await callOpenAIProvider(
      provider as OpenAIProviderKey,
      apiKey,
      systemPrompt,
      targetUrl,
      field,
    );
  } catch (err) {
    // Ultimate safety net — never let the function crash
    console.error(`[optimizeField] Erro fatal não capturado (provider: ${provider}):`, err);
    return {
      text: "",
      error: `Erro inesperado ao chamar ${provider}. Verifique os logs do servidor.`,
      success: false,
      retryAfter: 3000,
    };
  }
}
