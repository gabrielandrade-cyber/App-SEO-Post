/**
 * Estado global de configuracoes com persistencia em localStorage.
 *
 * Guarda: provedor de texto, provedor de visao, chaves BYOK, token de acesso
 * opcional do Worker e o tom de voz da marca. As chaves sao cifradas com
 * AES-GCM antes de tocar o localStorage; a CryptoKey fica num IndexedDB
 * separado e nao e exportavel.
 *
 * Hidratacao: o estado inicial e SEMPRE `emptySettings()`, identico no
 * servidor e no cliente. O que esta salvo so entra via HYDRATE dentro de um
 * useEffect, o que elimina divergencia de hidratacao no SSR. Quem precisa
 * saber se o estado salvo ja chegou le `hydrated` do contexto.
 *
 * O reducer e puro: a persistencia acontece num efeito, nunca dentro dele.
 */

import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { isAIProvider, isVisionProvider, type AIProvider, type VisionProvider } from "./providers";

export type { AIProvider, VisionProvider } from "./providers";

export type KeySecurityStatus =
  /** Chaves cifradas em repouso, tudo certo. */
  | "encrypted"
  /** Existe um pacote cifrado salvo, mas este navegador nao consegue abri-lo. */
  | "locked"
  /** Navegador sem WebCrypto/IndexedDB: chaves ficam so em memoria. */
  | "session-only"
  /** A cifra falhou nesta sessao; o pacote antigo foi preservado. */
  | "unavailable"
  /** Ainda nao carregou ou nao migrou. */
  | "pending";

export interface KeySecurity {
  status: KeySecurityStatus;
  message?: string;
}

export type SecretField = "geminiKey" | "groqKey" | "cerebrasKey" | "openaiKey" | "accessToken";

export interface AppSettings {
  provider: AIProvider;
  visionProvider: VisionProvider;
  geminiKey: string;
  groqKey: string;
  cerebrasKey: string;
  openaiKey: string;
  /** Token compartilhado com o Worker (OPTMOS_ACCESS_TOKEN). Opcional. */
  accessToken: string;
  brandPersona: string;
  keySecurity: KeySecurity;
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
  optimizedTitle?: boolean;
  optimizedDesc?: boolean;
}

type SecretPayload = Record<SecretField, string>;

interface StoredSettings {
  version: 4;
  provider: AIProvider;
  visionProvider: VisionProvider;
  brandPersona: string;
  encryptedKeys: { iv: string; data: string } | null;
}

const STORAGE_KEY = "serp-studio-settings";
const KEY_DB_NAME = "serp-studio-keyring";
const KEY_DB_STORE = "crypto-keys";
const SETTINGS_KEY_ID = "settings-aes-gcm-key";

const SECRET_FIELDS: SecretField[] = [
  "geminiKey",
  "groqKey",
  "cerebrasKey",
  "openaiKey",
  "accessToken",
];

let persistSequence = 0;
let cryptoKeyPromise: Promise<CryptoKey> | null = null;

const emptySecrets = (): SecretPayload => ({
  geminiKey: "",
  groqKey: "",
  cerebrasKey: "",
  openaiKey: "",
  accessToken: "",
});

export function emptySettings(): AppSettings {
  return {
    provider: "openai",
    visionProvider: "gemini",
    ...emptySecrets(),
    brandPersona: "",
    keySecurity: { status: "pending" },
  };
}

function hasBrowserStorage(): boolean {
  try {
    return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
  } catch {
    return false;
  }
}

function hasTransparentCrypto(): boolean {
  return (
    typeof crypto !== "undefined" && Boolean(crypto.subtle) && typeof indexedDB !== "undefined"
  );
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function normalizeProvider(value: unknown): AIProvider {
  return isAIProvider(value) ? value : "openai";
}

function normalizeVisionProvider(value: unknown): VisionProvider {
  return isVisionProvider(value) ? value : "gemini";
}

function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

// ─── Keyring (IndexedDB) ───────────────────────────────────────────────────────

function openKeyDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(KEY_DB_NAME, 1);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(KEY_DB_STORE)) {
        db.createObjectStore(KEY_DB_STORE);
      }
    };

    request.onblocked = () => reject(new Error("Keyring bloqueado por outra aba."));
    request.onerror = () => reject(request.error ?? new Error("Falha ao abrir o keyring."));
    request.onsuccess = () => resolve(request.result);
  });
}

function readStoredCryptoKey(db: IDBDatabase): Promise<CryptoKey | null> {
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

function writeStoredCryptoKey(db: IDBDatabase, key: CryptoKey): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(KEY_DB_STORE, "readwrite");
    tx.onerror = () => reject(tx.error);
    tx.oncomplete = () => resolve();
    tx.objectStore(KEY_DB_STORE).put(key, SETTINGS_KEY_ID);
  });
}

/**
 * Abre o keyring uma unica vez por sessao, fecha a conexao logo depois e
 * guarda a CryptoKey em memoria. Nao vaza conexoes por tecla digitada.
 */
function getOrCreateSettingsKey(): Promise<CryptoKey> {
  if (cryptoKeyPromise) return cryptoKeyPromise;

  cryptoKeyPromise = (async () => {
    const db = await openKeyDb();
    try {
      const stored = await readStoredCryptoKey(db);
      if (stored) return stored;

      const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
        "encrypt",
        "decrypt",
      ]);
      await writeStoredCryptoKey(db, key);
      return key;
    } finally {
      db.close();
    }
  })();

  cryptoKeyPromise.catch(() => {
    cryptoKeyPromise = null;
  });

  return cryptoKeyPromise;
}

async function encryptSecrets(secrets: SecretPayload): Promise<{ iv: string; data: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(12)));
  const key = await getOrCreateSettingsKey();
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(JSON.stringify(secrets)),
  );

  return { iv: bytesToBase64(iv), data: bytesToBase64(new Uint8Array(encrypted)) };
}

async function decryptSecrets(payload: { iv: string; data: string }): Promise<SecretPayload> {
  const key = await getOrCreateSettingsKey();
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(payload.iv) },
    key,
    base64ToBytes(payload.data),
  );
  const parsed = JSON.parse(new TextDecoder().decode(decrypted)) as Partial<SecretPayload>;
  const secrets = emptySecrets();
  for (const field of SECRET_FIELDS) {
    secrets[field] = asText(parsed[field]);
  }
  return secrets;
}

// ─── localStorage ──────────────────────────────────────────────────────────────

function readStoredRecord(): Record<string, unknown> | null {
  if (!hasBrowserStorage()) return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function readStoredCiphertext(): { iv: string; data: string } | null {
  const record = readStoredRecord();
  const keys = record?.encryptedKeys;
  if (!keys || typeof keys !== "object") return null;
  const { iv, data } = keys as { iv?: unknown; data?: unknown };
  return typeof iv === "string" && typeof data === "string" ? { iv, data } : null;
}

function writeStoredRecord(record: StoredSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
}

export interface LoadedSettings {
  settings: Partial<AppSettings>;
  security: KeySecurity;
}

/**
 * Le o que esta salvo. Nunca lanca: qualquer falha vira um `security.status`
 * explicito para a UI mostrar o que aconteceu.
 */
export async function loadPersistedSettings(): Promise<LoadedSettings> {
  const cryptoOk = hasTransparentCrypto();
  const noCryptoSecurity: KeySecurity = {
    status: "session-only",
    message:
      "Este navegador nao oferece criptografia local. As chaves ficam apenas nesta sessao e somem ao recarregar.",
  };

  const record = readStoredRecord();
  if (!record) {
    return { settings: {}, security: cryptoOk ? { status: "encrypted" } : noCryptoSecurity };
  }

  const base: Partial<AppSettings> = {
    provider: normalizeProvider(record.provider),
    visionProvider: normalizeVisionProvider(record.visionProvider),
    brandPersona: asText(record.brandPersona),
  };

  const isVersioned = record.version === 3 || record.version === 4;

  if (isVersioned) {
    const ciphertext = readStoredCiphertext();
    if (!ciphertext) {
      return { settings: base, security: cryptoOk ? { status: "encrypted" } : noCryptoSecurity };
    }

    if (!cryptoOk) {
      return {
        settings: base,
        security: {
          status: "locked",
          message:
            "Ha chaves salvas de forma cifrada, mas este navegador nao consegue abri-las. Cole as chaves novamente.",
        },
      };
    }

    try {
      const secrets = await decryptSecrets(ciphertext);
      return { settings: { ...base, ...secrets }, security: { status: "encrypted" } };
    } catch {
      return {
        settings: base,
        security: {
          status: "locked",
          message:
            "Nao foi possivel decifrar as chaves salvas (o keyring deste navegador mudou). Cole as chaves novamente.",
        },
      };
    }
  }

  // Formato antigo, em texto puro. Migrado para cifrado na primeira gravacao.
  return {
    settings: {
      ...base,
      geminiKey: asText(record.geminiKey ?? record.apiKey),
      groqKey: asText(record.groqKey),
      cerebrasKey: asText(record.cerebrasKey),
      openaiKey: asText(record.openaiKey ?? record.chatgptKey),
    },
    security: { status: "pending" },
  };
}

/**
 * Grava as configuracoes. Chaves NUNCA vao em texto puro para o localStorage:
 * se a cifra falhar, o pacote cifrado anterior e preservado e so os campos
 * nao sensiveis sao atualizados.
 */
export async function persistSettings(settings: AppSettings): Promise<KeySecurity | null> {
  if (!hasBrowserStorage()) return null;

  const sequence = ++persistSequence;
  const plain = {
    version: 4 as const,
    provider: settings.provider,
    visionProvider: settings.visionProvider,
    brandPersona: settings.brandPersona,
  };
  const secrets = emptySecrets();
  for (const field of SECRET_FIELDS) secrets[field] = settings[field];
  const hasSecrets = SECRET_FIELDS.some((field) => secrets[field].length > 0);

  if (hasTransparentCrypto()) {
    try {
      const encryptedKeys = hasSecrets ? await encryptSecrets(secrets) : null;
      if (sequence !== persistSequence) return null;
      writeStoredRecord({ ...plain, encryptedKeys });
      return { status: "encrypted" };
    } catch {
      if (sequence !== persistSequence) return null;
      writeStoredRecord({ ...plain, encryptedKeys: readStoredCiphertext() });
      return {
        status: "unavailable",
        message:
          "Nao foi possivel cifrar as chaves neste navegador. Elas continuam validas nesta sessao, mas nao foram salvas.",
      };
    }
  }

  const previous = readStoredCiphertext();
  writeStoredRecord({ ...plain, encryptedKeys: previous });
  return previous
    ? {
        status: "locked",
        message:
          "Ha chaves salvas de forma cifrada, mas este navegador nao consegue abri-las. Cole as chaves novamente.",
      }
    : {
        status: "session-only",
        message:
          "Este navegador nao oferece criptografia local. As chaves ficam apenas nesta sessao e somem ao recarregar.",
      };
}

// ─── Seletores ─────────────────────────────────────────────────────────────────

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

export function getVisionKey(settings: AppSettings): string {
  switch (settings.visionProvider) {
    case "gemini":
      return settings.geminiKey;
    case "groq":
      return settings.groqKey;
    case "openai":
      return settings.openaiKey;
  }
}

export function keyFieldFor(provider: AIProvider): SecretField {
  switch (provider) {
    case "gemini":
      return "geminiKey";
    case "groq":
      return "groqKey";
    case "cerebras":
      return "cerebrasKey";
    case "openai":
      return "openaiKey";
  }
}

// ─── Reducer ───────────────────────────────────────────────────────────────────

export type SettingsAction =
  | { type: "SET_PROVIDER"; payload: AIProvider }
  | { type: "SET_VISION_PROVIDER"; payload: VisionProvider }
  | { type: "SET_SECRET"; field: SecretField; payload: string }
  | { type: "SET_BRAND_PERSONA"; payload: string }
  | { type: "HYDRATE"; payload: Partial<AppSettings>; security: KeySecurity }
  | { type: "SET_KEY_SECURITY"; payload: KeySecurity };

export function settingsReducer(state: AppSettings, action: SettingsAction): AppSettings {
  switch (action.type) {
    case "SET_PROVIDER":
      return state.provider === action.payload ? state : { ...state, provider: action.payload };
    case "SET_VISION_PROVIDER":
      return state.visionProvider === action.payload
        ? state
        : { ...state, visionProvider: action.payload };
    case "SET_SECRET":
      return state[action.field] === action.payload
        ? state
        : { ...state, [action.field]: action.payload };
    case "SET_BRAND_PERSONA":
      return state.brandPersona === action.payload
        ? state
        : { ...state, brandPersona: action.payload };
    case "HYDRATE": {
      // O que o usuario ja digitou antes da hidratacao vence o valor salvo.
      const next: AppSettings = { ...state, keySecurity: action.security };
      next.provider = action.payload.provider ?? state.provider;
      next.visionProvider = action.payload.visionProvider ?? state.visionProvider;
      next.brandPersona = state.brandPersona || action.payload.brandPersona || "";
      for (const field of SECRET_FIELDS) {
        next[field] = state[field] || action.payload[field] || "";
      }
      return next;
    }
    case "SET_KEY_SECURITY":
      return state.keySecurity.status === action.payload.status &&
        state.keySecurity.message === action.payload.message
        ? state
        : { ...state, keySecurity: action.payload };
    default:
      return state;
  }
}

// ─── Provider ──────────────────────────────────────────────────────────────────

export interface SettingsContextValue {
  settings: AppSettings;
  dispatch: React.Dispatch<SettingsAction>;
  /** true depois que o estado salvo foi lido do navegador. */
  hydrated: boolean;
}

export const SettingsContext = createContext<SettingsContextValue | null>(null);

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used within SettingsProvider");
  return ctx;
}

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, dispatch] = useReducer(settingsReducer, undefined, emptySettings);
  const [hydrated, setHydrated] = useState(false);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  useEffect(() => {
    let cancelled = false;

    loadPersistedSettings().then(({ settings: loaded, security }) => {
      if (cancelled) return;
      dispatch({ type: "HYDRATE", payload: loaded, security });
      setHydrated(true);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  // Assinatura do que precisa ser persistido (keySecurity fica de fora).
  const persistSignature = JSON.stringify([
    settings.provider,
    settings.visionProvider,
    settings.brandPersona,
    ...SECRET_FIELDS.map((field) => settings[field]),
  ]);

  useEffect(() => {
    if (!hydrated) return;
    let cancelled = false;

    persistSettings(settingsRef.current).then((security) => {
      if (!cancelled && security) dispatch({ type: "SET_KEY_SECURITY", payload: security });
    });

    return () => {
      cancelled = true;
    };
  }, [hydrated, persistSignature]);

  const value = useMemo(() => ({ settings, dispatch, hydrated }), [settings, hydrated]);

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}
