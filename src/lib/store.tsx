/**
 * Application state store with localStorage persistence.
 *
 * Manages: AI provider selection (Gemini/Groq/Cerebras/ChatGPT),
 * API key per provider, and optional brand persona guidance.
 */

import React, { createContext, useContext } from "react";

export type AIProvider = "gemini" | "groq" | "cerebras" | "openai";

export interface AppSettings {
  provider: AIProvider;
  geminiKey: string;
  groqKey: string;
  cerebrasKey: string;
  openaiKey: string;
  brandPersona?: string;
  keySecurity?: {
    status: "plain" | "encrypted" | "locked" | "unavailable";
    hasEncryptedKeys: boolean;
  };
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
  optimizationError?: string;
  loadingTitle?: boolean;
  loadingDesc?: boolean;
  optimizedTitle?: boolean;
  optimizedDesc?: boolean;
}

interface KeyPayload {
  geminiKey: string;
  groqKey: string;
  cerebrasKey: string;
  openaiKey: string;
}

interface StoredEncryptedSettings {
  version: 3;
  provider: AIProvider;
  brandPersona: string;
  encryptedKeys: {
    iv: string;
    data: string;
  };
}

const STORAGE_KEY = "serp-studio-settings";
const KEY_DB_NAME = "serp-studio-keyring";
const KEY_DB_STORE = "crypto-keys";
const SETTINGS_KEY_ID = "settings-aes-gcm-key";

const DEPRECATED_PROVIDERS = ["deepseek", "gemma", "openrouter"];
const SUPPORTED_PROVIDERS: AIProvider[] = ["gemini", "groq", "cerebras", "openai"];

let persistSequence = 0;

const emptyKeys = (): KeyPayload => ({
  geminiKey: "",
  groqKey: "",
  cerebrasKey: "",
  openaiKey: "",
});

function emptySettings(): AppSettings {
  return {
    provider: "gemini",
    ...emptyKeys(),
    brandPersona: "",
    keySecurity: {
      status: "plain",
      hasEncryptedKeys: false,
    },
  };
}

function hasBrowserStorage(): boolean {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

function hasTransparentCrypto(): boolean {
  return (
    typeof crypto !== "undefined" &&
    Boolean(crypto.subtle) &&
    typeof indexedDB !== "undefined"
  );
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function isEncryptedSettings(value: Record<string, unknown>): value is StoredEncryptedSettings {
  return value.version === 3 && typeof value.encryptedKeys === "object";
}

function normalizeProvider(value: unknown): AIProvider {
  const savedProvider = typeof value === "string" ? value : "";
  return DEPRECATED_PROVIDERS.includes(savedProvider) ||
    !SUPPORTED_PROVIDERS.includes(savedProvider as AIProvider)
    ? "gemini"
    : (savedProvider as AIProvider);
}

function openKeyDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(KEY_DB_NAME, 1);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(KEY_DB_STORE)) {
        db.createObjectStore(KEY_DB_STORE);
      }
    };

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

async function readStoredCryptoKey(db: IDBDatabase): Promise<CryptoKey | null> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(KEY_DB_STORE, "readonly");
    const request = tx.objectStore(KEY_DB_STORE).get(SETTINGS_KEY_ID);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const value = request.result;
      resolve(value instanceof CryptoKey ? value : null);
    };
  });
}

async function writeStoredCryptoKey(db: IDBDatabase, key: CryptoKey): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(KEY_DB_STORE, "readwrite");
    tx.onerror = () => reject(tx.error);
    tx.oncomplete = () => resolve();
    tx.objectStore(KEY_DB_STORE).put(key, SETTINGS_KEY_ID);
  });
}

async function getOrCreateSettingsKey(): Promise<CryptoKey> {
  const db = await openKeyDb();
  const stored = await readStoredCryptoKey(db);
  if (stored) return stored;

  const key = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
  await writeStoredCryptoKey(db, key);
  return key;
}

async function encryptSettings(settings: AppSettings): Promise<StoredEncryptedSettings> {
  const encoder = new TextEncoder();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await getOrCreateSettingsKey();
  const payload: KeyPayload = {
    geminiKey: settings.geminiKey,
    groqKey: settings.groqKey,
    cerebrasKey: settings.cerebrasKey,
    openaiKey: settings.openaiKey,
  };

  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoder.encode(JSON.stringify(payload)),
  );

  return {
    version: 3,
    provider: settings.provider,
    brandPersona: settings.brandPersona ?? "",
    encryptedKeys: {
      iv: bytesToBase64(iv),
      data: bytesToBase64(new Uint8Array(encrypted)),
    },
  };
}

async function decryptSettings(stored: StoredEncryptedSettings): Promise<KeyPayload> {
  const decoder = new TextDecoder();
  const key = await getOrCreateSettingsKey();
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(stored.encryptedKeys.iv) },
    key,
    base64ToBytes(stored.encryptedKeys.data),
  );
  const parsed = JSON.parse(decoder.decode(decrypted)) as Partial<KeyPayload>;

  return {
    ...emptyKeys(),
    geminiKey: typeof parsed.geminiKey === "string" ? parsed.geminiKey : "",
    groqKey: typeof parsed.groqKey === "string" ? parsed.groqKey : "",
    cerebrasKey: typeof parsed.cerebrasKey === "string" ? parsed.cerebrasKey : "",
    openaiKey: typeof parsed.openaiKey === "string" ? parsed.openaiKey : "",
  };
}

function readStoredSettings(): Record<string, unknown> | null {
  if (!hasBrowserStorage()) return null;

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function loadSettings(): AppSettings {
  const parsed = readStoredSettings();
  if (!parsed) return emptySettings();

  if (isEncryptedSettings(parsed)) {
    return {
      provider: normalizeProvider(parsed.provider),
      ...emptyKeys(),
      brandPersona: typeof parsed.brandPersona === "string" ? parsed.brandPersona : "",
      keySecurity: {
        status: "locked",
        hasEncryptedKeys: true,
      },
    };
  }

  return {
    provider: normalizeProvider(parsed.provider),
    geminiKey: (parsed.geminiKey as string) ?? (parsed.apiKey as string) ?? "",
    groqKey: (parsed.groqKey as string) ?? "",
    cerebrasKey: (parsed.cerebrasKey as string) ?? "",
    openaiKey: (parsed.openaiKey as string) ?? (parsed.chatgptKey as string) ?? "",
    brandPersona: typeof parsed.brandPersona === "string" ? parsed.brandPersona : "",
    keySecurity: {
      status: "plain",
      hasEncryptedKeys: false,
    },
  };
}

export function saveSettings(settings: AppSettings): void {
  if (!hasBrowserStorage()) return;

  const sequence = ++persistSequence;

  if (hasTransparentCrypto()) {
    void encryptSettings(settings)
      .then((encrypted) => {
        if (sequence === persistSequence) {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(encrypted));
        }
      })
      .catch(() => {
        const { keySecurity, ...persistable } = settings;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(persistable));
      });
    return;
  }

  const { keySecurity, ...persistable } = settings;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(persistable));
}

async function loadEncryptedKeys(): Promise<KeyPayload | null> {
  if (!hasBrowserStorage() || !hasTransparentCrypto()) return null;

  const parsed = readStoredSettings();
  if (!parsed || !isEncryptedSettings(parsed)) return null;

  return decryptSettings(parsed);
}

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

export type SettingsAction =
  | { type: "SET_PROVIDER"; payload: AIProvider }
  | { type: "SET_GEMINI_KEY"; payload: string }
  | { type: "SET_GROQ_KEY"; payload: string }
  | { type: "SET_CEREBRAS_KEY"; payload: string }
  | { type: "SET_OPENAI_KEY"; payload: string }
  | { type: "SET_BRAND_PERSONA"; payload: string }
  | { type: "HYDRATE_KEYS"; payload: KeyPayload }
  | { type: "SET_KEY_SECURITY"; payload: AppSettings["keySecurity"] };

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
    case "HYDRATE_KEYS":
      next = {
        ...state,
        ...action.payload,
        keySecurity: { status: "encrypted", hasEncryptedKeys: true },
      };
      break;
    case "SET_KEY_SECURITY":
      next = { ...state, keySecurity: action.payload };
      break;
    default:
      return state;
  }

  if (action.type !== "HYDRATE_KEYS" && action.type !== "SET_KEY_SECURITY") {
    saveSettings(next);
  }

  return next;
}

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

  React.useEffect(() => {
    let cancelled = false;

    loadEncryptedKeys()
      .then((keys) => {
        if (cancelled || !keys) return;
        dispatch({ type: "HYDRATE_KEYS", payload: keys });
      })
      .catch(() => {
        if (!cancelled) {
          dispatch({
            type: "SET_KEY_SECURITY",
            payload: { status: "unavailable", hasEncryptedKeys: false },
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  React.useEffect(() => {
    if (settings.keySecurity?.status === "plain" && hasTransparentCrypto()) {
      saveSettings(settings);
      dispatch({
        type: "SET_KEY_SECURITY",
        payload: { status: "encrypted", hasEncryptedKeys: true },
      });
    }
  }, [settings]);

  return (
    <SettingsContext.Provider value={{ settings, dispatch }}>{children}</SettingsContext.Provider>
  );
}
