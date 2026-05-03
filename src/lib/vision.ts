import { createServerFn } from "@tanstack/react-start";
import { GoogleGenAI } from "@google/genai";
import OpenAI from "openai";

interface VisionPayload {
  base64Image: string; // String no formato "data:image/webp;base64,..."
  prompt: string;
  provider: "gemini" | "groq";
  apiKey: string;
}

export const optimizeVision = createServerFn({ method: "POST" })
  .handler(async ({ data }: any) => {
    const { base64Image, prompt, provider, apiKey } = data as VisionPayload;

    if (!apiKey) {
      throw new Error(`[${provider}] API Key não fornecida.`);
    }

    if (!base64Image || !base64Image.includes(",")) {
      throw new Error("Imagem Base64 inválida.");
    }

    // A Vercel bloqueia payloads maiores que 4.5MB. Validamos aqui também.
    // O frontend deve garantir que a imagem chegue com < 3.5MB.
    const sizeInMB = base64Image.length / (1024 * 1024);
    if (sizeInMB > 4.2) {
      throw new Error("Payload Too Large: A imagem excede o limite seguro da Vercel (4.5MB).");
    }

    // Extrair o mimetype e os dados reais
    const mimeType = base64Image.split(";")[0].split(":")[1] || "image/webp";
    const base64Data = base64Image.split(",")[1];

    try {
      if (provider === "gemini") {
        const ai = new GoogleGenAI({ apiKey });
        
        const response = await ai.models.generateContent({
          model: "gemini-2.5-flash", // Modelo multimodal de alta performance
          contents: [
            prompt,
            { inlineData: { data: base64Data, mimeType } }
          ],
          config: {
            temperature: 0.1,
            maxOutputTokens: 200, // Curto para SEO
          }
        });

        if (!response.text) {
          throw new Error("Gemini retornou uma resposta vazia.");
        }

        return { success: true, text: response.text.trim() };

      } else if (provider === "groq") {
        const client = new OpenAI({
          apiKey: apiKey,
          baseURL: "https://api.groq.com/openai/v1",
        });

        const response = await client.chat.completions.create({
          model: "meta-llama/llama-4-scout-17b-16e-instruct",
          temperature: 0.1,
          max_tokens: 200,
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: prompt },
                {
                  type: "image_url",
                  image_url: {
                    url: `data:${mimeType};base64,${base64Data}`,
                  },
                },
              ],
            },
          ],
        });

        const rawText = response.choices?.[0]?.message?.content?.trim();
        if (!rawText) {
          throw new Error("Groq retornou uma resposta vazia.");
        }

        return { success: true, text: rawText };
      }

      throw new Error(`Provider ${provider} não é suportado para imagens.`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Erro desconhecido";
      const status = (err as { status?: number })?.status;

      // Tratamento de erros comuns
      if (status === 429 || message.toLowerCase().includes("quota") || message.toLowerCase().includes("rate limit")) {
        throw new Error(`[${provider}] Limite de requisições atingido (429). Aguarde alguns instantes.`);
      }
      if (status === 413 || message.includes("413")) {
        throw new Error("A imagem é demasiado grande (413 Payload Too Large). A compressão falhou.");
      }
      if (status === 504 || message.includes("timeout")) {
        throw new Error("O servidor da IA demorou demasiado tempo a responder (504 Timeout).");
      }

      console.error(`[VisionServerFn] Erro no ${provider}:`, err);
      throw new Error(`[${provider}] ${message}`);
    }
  });
