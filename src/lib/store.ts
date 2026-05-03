/**
 * Application state store with localStorage persistence.
 *
 * Manages: AI provider selection (Gemini/Groq/Cerebras),
 * API key per provider, and custom prompts for Title/Description.
 */

import { createContext, useContext } from "react";

// ─── Types ──────────────────────────────────────────────────────────────────

export type AIProvider = "gemini" | "groq" | "cerebras";

export interface AppSettings {
  provider: AIProvider;
  geminiKey: string;
  groqKey: string;
  cerebrasKey: string;
  titlePrompt: string;
  descPrompt: string;
}

export interface CsvRow {
  id: number;
  url: string;
  title: string;
  description: string;
  loadingTitle?: boolean;
  loadingDesc?: boolean;
  optimizedTitle?: boolean;
  optimizedDesc?: boolean;
}

// ─── Defaults ───────────────────────────────────────────────────────────────

export const DEFAULT_TITLE_PROMPT = `Você é um Especialista em SEO Sênior e Copywriter de alta conversão.

<tarefa>
Analise a URL fornecida e crie um Meta Title otimizado para o produto/página dessa URL.
</tarefa>

<regras_inviolaveis>
1. TAMANHO: O título DEVE ter entre 50 e 60 caracteres. Conte cada caractere incluindo espaços.
2. ESTRUTURA: Use a fórmula: [Nome do Produto] + [Tipo/Categoria] + [Diferencial Principal].
3. PROIBIDO incluir nomes de lojas, marcas de e-commerce ou nomes de empresas (ex: "MyFavorite", "Amazon", "Shopee").
4. PROIBIDO incluir códigos de produto, SKUs ou números de referência (ex: "501B", "CF008679", "BL010042").
5. Use apenas palavras descritivas sobre o produto em si: material, cor, funcionalidade, público-alvo.
6. FOCO: Identifique o tipo de produto pela URL e construa o título baseado nas características do produto.
</regras_inviolaveis>

<exemplo_correto>
"ENERMAX: SUPLEMENTO MINERAL ADENSADO PARA BOVINOS DE CORTE"
"Saia Curta Estampada com Babados - Tendência Verão Feminina"
"Calça Jeans Cintura Alta Feminina - Conforto e Estilo Premium"
</exemplo_correto>

<exemplo_errado_nunca_faca>
"Saia Curta Estampada Babados MyFavorite" ← contém nome da loja
"BERMUDA JEANS 501B APLICAÇÕES" ← contém código do produto
"Calça Jeans 501CF008679 Full Length" ← contém SKU
</exemplo_errado_nunca_faca>

<formato_saida>
Responda APENAS com o texto do título. Sem aspas, sem introduções, sem explicações.
</formato_saida>`;

export const DEFAULT_DESC_PROMPT = `Você é um Especialista em SEO Sênior e Copywriter de alta conversão.

<tarefa>
Analise a URL fornecida e crie uma Meta Description persuasiva para o produto/página dessa URL.
</tarefa>

<regras_inviolaveis>
1. TAMANHO CIRÚRGICO: O texto DEVE ter entre 140 e 148 caracteres (máximo absoluto: 150). Conte cada caractere incluindo espaços.
2. ABERTURA: DEVE iniciar com verbo imperativo de ação (Conheça, Confira, Explore, Descubra, Garanta).
3. PROIBIDO incluir nomes de lojas, marcas de e-commerce ou nomes de empresas.
4. PROIBIDO incluir códigos de produto, SKUs ou números de referência.
5. CONSTRUÇÃO: Reforce as características reais do produto — material, funcionalidade, benefícios.
6. DIFERENCIAL: Destaque o que torna o produto único (qualidade, conforto, tecnologia, design).
7. SEO LOCAL: Inclua localização APENAS se a URL indicar estratégia de SEO Local.
8. FECHAMENTO: Termine com CTA forte e direto.
</regras_inviolaveis>

<exemplo_correto>
"Conheça a Carabina Naja Wood 5.5mm. Coronha em madeira, sistema Nitro Gás Ram para menor recuo e alta potência. Ideal para tiro esportivo!"
</exemplo_correto>

<exemplo_errado_nunca_faca>
"Descubra a Calça Jeans Full Length 501CF008679. Cintura alta..." ← contém código
"Confira na MyFavorite a blusa de renda..." ← contém nome da loja
</exemplo_errado_nunca_faca>

<formato_saida>
Responda APENAS com o texto da description. Sem aspas, sem introduções, sem explicações.
</formato_saida>`;

const STORAGE_KEY = "serp-studio-settings";

/** Providers that were removed — migrate to gemini */
const DEPRECATED_PROVIDERS = ["deepseek", "gemma", "openrouter"];

// ─── Persistence helpers ────────────────────────────────────────────────────

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, unknown>;

      // Always reset prompts to latest version to avoid stale prompts
      // Users who customized will lose customization, but this ensures quality
      const isDefaultish = (p: unknown) =>
        !p || typeof p !== "string" || p.length < 100 ||
        p.includes("You are an SEO") || p.includes("Rewrite the") ||
        !p.includes("<regras_inviolaveis>");

      // Migrate deprecated providers to gemini
      const savedProvider = parsed.provider as string;
      const provider = DEPRECATED_PROVIDERS.includes(savedProvider)
        ? "gemini"
        : (savedProvider as AIProvider) ?? "gemini";

      return {
        provider,
        geminiKey: (parsed.geminiKey as string) ?? (parsed.apiKey as string) ?? "",
        groqKey: (parsed.groqKey as string) ?? "",
        cerebrasKey: (parsed.cerebrasKey as string) ?? "",
        titlePrompt: isDefaultish(parsed.titlePrompt) ? DEFAULT_TITLE_PROMPT : (parsed.titlePrompt as string),
        descPrompt: isDefaultish(parsed.descPrompt) ? DEFAULT_DESC_PROMPT : (parsed.descPrompt as string),
      };
    }
  } catch {
    // Corrupted data — fall back to defaults silently
  }
  return {
    provider: "gemini",
    geminiKey: "",
    groqKey: "",
    cerebrasKey: "",
    titlePrompt: DEFAULT_TITLE_PROMPT,
    descPrompt: DEFAULT_DESC_PROMPT,
  };
}

export function saveSettings(settings: AppSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Storage full or unavailable — fail silently
  }
}

/** Get the active API key for the currently selected provider */
export function getActiveKey(settings: AppSettings): string {
  switch (settings.provider) {
    case "gemini": return settings.geminiKey;
    case "groq": return settings.groqKey;
    case "cerebras": return settings.cerebrasKey;
  }
}

// ─── Action types for reducer ───────────────────────────────────────────────

export type SettingsAction =
  | { type: "SET_PROVIDER"; payload: AIProvider }
  | { type: "SET_GEMINI_KEY"; payload: string }
  | { type: "SET_GROQ_KEY"; payload: string }
  | { type: "SET_CEREBRAS_KEY"; payload: string }
  | { type: "SET_TITLE_PROMPT"; payload: string }
  | { type: "SET_DESC_PROMPT"; payload: string }
  | { type: "RESET_PROMPTS" };

export function settingsReducer(
  state: AppSettings,
  action: SettingsAction,
): AppSettings {
  let next: AppSettings;
  switch (action.type) {
    case "SET_PROVIDER":
      next = { ...state, provider: action.payload };
      break;
    case "SET_GEMINI_KEY":
      next = { ...state, geminiKey: action.payload };
      break;
    case "SET_GROQ_KEY":
      next = { ...state, groqKey: action.payload };
      break;
    case "SET_CEREBRAS_KEY":
      next = { ...state, cerebrasKey: action.payload };
      break;
    case "SET_TITLE_PROMPT":
      next = { ...state, titlePrompt: action.payload };
      break;
    case "SET_DESC_PROMPT":
      next = { ...state, descPrompt: action.payload };
      break;
    case "RESET_PROMPTS":
      next = {
        ...state,
        titlePrompt: DEFAULT_TITLE_PROMPT,
        descPrompt: DEFAULT_DESC_PROMPT,
      };
      break;
    default:
      return state;
  }
  saveSettings(next);
  return next;
}

// ─── Context (optional) ─────────────────────────────────────────────────────

export const SettingsContext = createContext<AppSettings | null>(null);

export function useSettings(): AppSettings {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used within SettingsContext");
  return ctx;
}
