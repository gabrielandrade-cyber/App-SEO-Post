/**
 * Application state store with localStorage persistence.
 *
 * Manages: AI provider selection (Gemini/Groq/Cerebras/ChatGPT),
 * API key per provider, and optional brand persona guidance.
 */

import React, { createContext, useContext } from "react";

// ─── Types ──────────────────────────────────────────────────────────────────

export type AIProvider = "gemini" | "groq" | "cerebras" | "openai";

export interface AppSettings {
  provider: AIProvider;
  geminiKey: string;
  groqKey: string;
  cerebrasKey: string;
  openaiKey: string;
  brandPersona?: string;
}

export interface CsvRow {
  id: number;
  url: string;
  title: string;
  description: string;
  newTitle?: string;
  newDescription?: string;
  titleJustification?: string;
  descriptionJustification?: string;
  loadingTitle?: boolean;
  loadingDesc?: boolean;
  optimizedTitle?: boolean;
  optimizedDesc?: boolean;
}

const STORAGE_KEY = "serp-studio-settings";

/** Providers that were removed — migrate to gemini */
const DEPRECATED_PROVIDERS = ["deepseek", "gemma", "openrouter"];
const SUPPORTED_PROVIDERS: AIProvider[] = ["gemini", "groq", "cerebras", "openai"];

// ─── Persistence helpers ────────────────────────────────────────────────────

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, unknown>;

      // Migrate deprecated providers to gemini
      const savedProvider = typeof parsed.provider === "string" ? parsed.provider : "";
      const provider =
        DEPRECATED_PROVIDERS.includes(savedProvider) ||
        !SUPPORTED_PROVIDERS.includes(savedProvider as AIProvider)
          ? "gemini"
          : (savedProvider as AIProvider);

      return {
        provider,
        geminiKey: (parsed.geminiKey as string) ?? (parsed.apiKey as string) ?? "",
        groqKey: (parsed.groqKey as string) ?? "",
        cerebrasKey: (parsed.cerebrasKey as string) ?? "",
        openaiKey: (parsed.openaiKey as string) ?? (parsed.chatgptKey as string) ?? "",
        brandPersona: typeof parsed.brandPersona === "string" ? parsed.brandPersona : "",
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
    openaiKey: "",
    brandPersona: "",
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
    case "gemini":
      return settings.geminiKey;
    case "groq":
      return settings.groqKey;
    case "cerebras":
      return settings.cerebrasKey;
    case "openai":
      return settings.openaiKey;
  }
}

// ─── Action types for reducer ───────────────────────────────────────────────

export type SettingsAction =
  | { type: "SET_PROVIDER"; payload: AIProvider }
  | { type: "SET_GEMINI_KEY"; payload: string }
  | { type: "SET_GROQ_KEY"; payload: string }
  | { type: "SET_CEREBRAS_KEY"; payload: string }
  | { type: "SET_OPENAI_KEY"; payload: string }
  | { type: "SET_BRAND_PERSONA"; payload: string };

export function settingsReducer(state: AppSettings, action: SettingsAction): AppSettings {
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
    case "SET_OPENAI_KEY":
      next = { ...state, openaiKey: action.payload };
      break;
    case "SET_BRAND_PERSONA":
      next = { ...state, brandPersona: action.payload };
      break;
    default:
      return state;
  }
  saveSettings(next);
  return next;
}

// ─── Context ──────────────────────────────────────────────────────────────────

export const SettingsContext = createContext<{
  settings: AppSettings;
  dispatch: React.Dispatch<SettingsAction>;
} | null>(null);

export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used within SettingsContext");
  return ctx;
}

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, dispatch] = React.useReducer(settingsReducer, undefined, loadSettings);
  return (
    <SettingsContext.Provider value={{ settings, dispatch }}>{children}</SettingsContext.Provider>
  );
}
