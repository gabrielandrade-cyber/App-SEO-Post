/**
 * Server function de visao do Image Optimizer.
 *
 * Recebe a imagem em base64 (ja convertida e redimensionada no navegador),
 * chama o modelo multimodal do provedor escolhido com a chave BYOK do
 * usuario e devolve texto curto (nome de arquivo ou alt text).
 */

import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { GoogleGenAI } from "@google/genai";
import OpenAI from "openai";
import { PROVIDER_META, isVisionProvider, type VisionProvider } from "./providers";
import { checkRequestAccess } from "./server-auth";

export interface VisionPayload {
  /** Data URL: "data:image/webp;base64,..." */
  base64Image: string;
  prompt: string;
  provider: VisionProvider;
  apiKey: string;
}

export interface VisionResponse {
  success: boolean;
  text: string;
  model: string;
}

/** Limite de base64 aceito pelos provedores para imagem inline (Groq: 4 MB). */
export const MAX_VISION_BASE64_BYTES = 4 * 1024 * 1024;
const VISION_TIMEOUT_MS = 45_000;
const MAX_OUTPUT_TOKENS = 160;

function friendlyError(provider: VisionProvider, err: unknown): Error {
  const label = PROVIDER_META[provider].label;
  const message = err instanceof Error ? err.message : "Erro desconhecido";
  const status = (err as { status?: number })?.status;
  const lower = message.toLowerCase();

  if (status === 401 || status === 403 || /api key|unauthenticated|permission/i.test(message)) {
    return new Error(`[${label}] Chave invalida ou sem permissao. Confira a chave no painel.`);
  }
  if (
    status === 429 ||
    lower.includes("quota") ||
    lower.includes("rate limit") ||
    lower.includes("resource_exhausted")
  ) {
    return new Error(`[${label}] Limite de requisicoes atingido (429). Aguarde alguns instantes.`);
  }
  if (status === 402 || lower.includes("billing") || lower.includes("insufficient")) {
    return new Error(`[${label}] A conta esta sem saldo ou sem creditos ativos.`);
  }
  if (status === 404 || /model.*(not found|decommission|deprecat|unsupported)/i.test(message)) {
    return new Error(
      `[${label}] O modelo de visao ${PROVIDER_META[provider].visionModel} nao esta disponivel nesta conta.`,
    );
  }
  if (status === 413 || message.includes("413") || lower.includes("too large")) {
    return new Error(
      "A imagem e grande demais para o provedor (413). Use Compressao Max e tente de novo.",
    );
  }
  if (status === 504 || lower.includes("timeout") || lower.includes("aborted")) {
    return new Error(`[${label}] O servidor da IA demorou demais para responder (timeout).`);
  }
  return new Error(`[${label}] ${message}`);
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(Object.assign(new Error("timeout"), { status: 504 })),
      ms,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

async function callGemini(apiKey: string, prompt: string, mimeType: string, data: string) {
  const model = PROVIDER_META.gemini.visionModel!;
  const ai = new GoogleGenAI({ apiKey });
  const response = await withTimeout(
    ai.models.generateContent({
      model,
      contents: [{ role: "user", parts: [{ text: prompt }, { inlineData: { data, mimeType } }] }],
      config: { maxOutputTokens: MAX_OUTPUT_TOKENS },
    }),
    VISION_TIMEOUT_MS,
  );
  const text = response.text?.trim();
  if (!text) throw new Error("O modelo retornou uma resposta vazia.");
  return { text, model };
}

async function callOpenAICompatible(
  provider: "groq" | "openai",
  apiKey: string,
  prompt: string,
  dataUrl: string,
) {
  const meta = PROVIDER_META[provider];
  const model = meta.visionModel!;
  const client = new OpenAI({
    apiKey,
    baseURL: meta.baseURL,
    maxRetries: 0,
    timeout: VISION_TIMEOUT_MS,
  });
  const request: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = {
    model,
    max_completion_tokens: MAX_OUTPUT_TOKENS,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: dataUrl } },
        ],
      },
    ],
  };
  if (provider === "groq") request.temperature = 0.1;

  const response = await client.chat.completions.create(request);
  const text = response.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("O modelo retornou uma resposta vazia.");
  return { text, model };
}

export const optimizeVision = createServerFn({ method: "POST" })
  .inputValidator((data: VisionPayload) => data)
  .handler(async ({ data }): Promise<VisionResponse> => {
    const access = checkRequestAccess(getRequest());
    if (!access.ok) throw new Error(access.message);

    const { base64Image, prompt, provider, apiKey } = data;

    if (!isVisionProvider(provider)) throw new Error("Provedor sem suporte a visao.");
    if (!apiKey?.trim())
      throw new Error(`[${PROVIDER_META[provider].label}] API Key nao fornecida.`);
    if (!base64Image || !base64Image.startsWith("data:image/") || !base64Image.includes(",")) {
      throw new Error("Imagem invalida.");
    }
    if (base64Image.length > MAX_VISION_BASE64_BYTES) {
      throw new Error(
        "A imagem passou de 4 MB depois da compressao. Use Compressao Max e tente de novo.",
      );
    }

    const mimeType = base64Image.slice(5, base64Image.indexOf(";")) || "image/webp";
    const base64Data = base64Image.slice(base64Image.indexOf(",") + 1);
    const safePrompt = prompt.slice(0, 600);

    try {
      if (provider === "gemini") {
        const { text, model } = await callGemini(apiKey, safePrompt, mimeType, base64Data);
        return { success: true, text, model };
      }
      const { text, model } = await callOpenAICompatible(provider, apiKey, safePrompt, base64Image);
      return { success: true, text, model };
    } catch (err) {
      throw friendlyError(provider, err);
    }
  });
