/**
 * Camada de dados do SERP Optimizer sobre IndexedDB (lib `idb`).
 *
 * Banco `optmos-serp` com dois object stores:
 *   - `rows`: uma entrada por linha do CSV, keyPath `id`.
 *   - `meta`: cabecalho do arquivo (`csv-meta`) e estado da fila (`queue-state`).
 *
 * Invariante: os ids das linhas sao sempre 1..N contiguos, na ordem do CSV.
 * `importCSVToIndexedDB` e o unico escritor de linhas novas e garante isso.
 * `getRowsWindow(startIndex, limit)` depende dessa invariante para tratar o
 * indice posicional da fila como id.
 */

import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import { isOutOfRange } from "./providers";
import type { CsvRow } from "./store";

const DB_NAME = "optmos-serp";
const DB_VERSION = 1;

const CSV_META_KEY = "csv-meta";
const QUEUE_STATE_KEY = "queue-state";

export type QueueStatus = "idle" | "running" | "paused" | "done" | "error";

export interface CsvMeta {
  fileName: string | null;
  rowCount: number;
  importedAt: number | null;
}

export interface QueueState {
  status: QueueStatus;
  currentIndex: number;
  lastError?: string;
  errorCount?: number;
  updatedAt: number;
}

interface MetaRecord {
  key: string;
  value: unknown;
}

interface OptmosDB extends DBSchema {
  rows: {
    key: number;
    value: CsvRow;
  };
  meta: {
    key: string;
    value: MetaRecord;
  };
}

let dbPromise: Promise<IDBPDatabase<OptmosDB>> | null = null;

const emptyMeta = (): CsvMeta => ({
  fileName: null,
  rowCount: 0,
  importedAt: null,
});

const emptyQueueState = (): QueueState => ({
  status: "idle",
  currentIndex: 0,
  errorCount: 0,
  updatedAt: Date.now(),
});

/**
 * Abre o banco uma vez por sessao. Se a abertura falhar, a promise NAO fica
 * memorizada: a proxima chamada tenta de novo. Se outra aba apagar ou
 * bloquear o banco, a conexao e descartada para ser reaberta.
 */
function getDb(): Promise<IDBPDatabase<OptmosDB>> {
  if (!dbPromise) {
    dbPromise = openDB<OptmosDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains("rows")) {
          db.createObjectStore("rows", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("meta")) {
          db.createObjectStore("meta", { keyPath: "key" });
        }
      },
      blocking() {
        dbPromise?.then((db) => db.close()).catch(() => undefined);
        dbPromise = null;
      },
      terminated() {
        dbPromise = null;
      },
    });

    dbPromise.catch(() => {
      dbPromise = null;
    });
  }

  return dbPromise;
}

async function getMetaValue<T>(key: string, fallback: T): Promise<T> {
  const db = await getDb();
  const record = await db.get("meta", key);
  return (record?.value as T | undefined) ?? fallback;
}

async function setMetaValue(key: string, value: unknown): Promise<void> {
  const db = await getDb();
  await db.put("meta", { key, value });
}

export async function getCsvMeta(): Promise<CsvMeta> {
  return getMetaValue<CsvMeta>(CSV_META_KEY, emptyMeta());
}

export async function setCsvMeta(meta: CsvMeta): Promise<void> {
  await setMetaValue(CSV_META_KEY, meta);
}

export async function setCsvRowCount(rowCount: number): Promise<void> {
  const db = await getDb();
  const tx = db.transaction("meta", "readwrite");
  const record = await tx.store.get(CSV_META_KEY);
  const current = (record?.value as CsvMeta | undefined) ?? emptyMeta();
  await tx.store.put({ key: CSV_META_KEY, value: { ...current, rowCount } });
  await tx.done;
}

export async function getQueueState(): Promise<QueueState> {
  return getMetaValue<QueueState>(QUEUE_STATE_KEY, emptyQueueState());
}

/**
 * Leitura e escrita na MESMA transacao, para que "pausar" e "avancar o
 * indice" nunca se sobrescrevam em corrida.
 */
export async function setQueueState(next: Partial<QueueState>): Promise<QueueState> {
  const db = await getDb();
  const tx = db.transaction("meta", "readwrite");
  const record = await tx.store.get(QUEUE_STATE_KEY);
  const current = (record?.value as QueueState | undefined) ?? emptyQueueState();
  const state: QueueState = { ...current, ...next, updatedAt: Date.now() };
  await tx.store.put({ key: QUEUE_STATE_KEY, value: state });
  await tx.done;
  return state;
}

export async function resetCsvData(fileName: string): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(["rows", "meta"], "readwrite");
  await tx.objectStore("rows").clear();
  await tx.objectStore("meta").put({
    key: CSV_META_KEY,
    value: { fileName, rowCount: 0, importedAt: Date.now() } satisfies CsvMeta,
  });
  await tx.objectStore("meta").put({ key: QUEUE_STATE_KEY, value: emptyQueueState() });
  await tx.done;
}

export async function clearCsvData(): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(["rows", "meta"], "readwrite");
  await tx.objectStore("rows").clear();
  await tx.objectStore("meta").put({ key: CSV_META_KEY, value: emptyMeta() });
  await tx.objectStore("meta").put({ key: QUEUE_STATE_KEY, value: emptyQueueState() });
  await tx.done;
}

export async function putCsvRows(rows: CsvRow[]): Promise<void> {
  if (rows.length === 0) return;

  const db = await getDb();
  const tx = db.transaction("rows", "readwrite");
  for (const row of rows) tx.store.put(row);
  await tx.done;
}

export async function getCsvRow(id: number): Promise<CsvRow | undefined> {
  const db = await getDb();
  return db.get("rows", id);
}

export async function getCsvRows(ids: number[]): Promise<CsvRow[]> {
  if (ids.length === 0) return [];
  const db = await getDb();
  const tx = db.transaction("rows");
  const rows = await Promise.all(ids.map((id) => tx.store.get(id)));
  await tx.done;
  return rows.filter((row): row is CsvRow => Boolean(row));
}

/** Janela posicional: `startIndex` e 0-based, os ids comecam em 1. */
export async function getRowsWindow(startIndex: number, limit: number): Promise<CsvRow[]> {
  if (limit <= 0) return [];

  const db = await getDb();
  const rows: CsvRow[] = [];
  let cursor = await db
    .transaction("rows")
    .store.openCursor(IDBKeyRange.lowerBound(startIndex + 1));

  while (cursor && rows.length < limit) {
    rows.push(cursor.value);
    cursor = await cursor.continue();
  }

  return rows;
}

export async function getBatchRows(startIndex: number, limit: number): Promise<CsvRow[]> {
  return getRowsWindow(startIndex, limit);
}

/** Linhas que ficaram com erro de otimizacao, em ordem de id. */
export async function getRowsWithErrors(limit = Infinity): Promise<CsvRow[]> {
  const db = await getDb();
  const rows: CsvRow[] = [];
  let cursor = await db.transaction("rows").store.openCursor();

  while (cursor && rows.length < limit) {
    if (cursor.value.optimizationError) rows.push(cursor.value);
    cursor = await cursor.continue();
  }

  return rows;
}

/** Linhas otimizadas cujo title ou description ficou fora da faixa de caracteres. */
export async function getRowsOutOfRange(limit = Infinity): Promise<CsvRow[]> {
  const db = await getDb();
  const rows: CsvRow[] = [];
  let cursor = await db.transaction("rows").store.openCursor();

  while (cursor && rows.length < limit) {
    if (!cursor.value.optimizationError && isOutOfRange(cursor.value)) rows.push(cursor.value);
    cursor = await cursor.continue();
  }

  return rows;
}

export async function countRowsOutOfRange(): Promise<number> {
  const db = await getDb();
  let count = 0;
  let cursor = await db.transaction("rows").store.openCursor();

  while (cursor) {
    if (!cursor.value.optimizationError && isOutOfRange(cursor.value)) count += 1;
    cursor = await cursor.continue();
  }

  return count;
}

export async function countRowsWithErrors(): Promise<number> {
  const db = await getDb();
  let count = 0;
  let cursor = await db.transaction("rows").store.openCursor();

  while (cursor) {
    if (cursor.value.optimizationError) count += 1;
    cursor = await cursor.continue();
  }

  return count;
}

/**
 * Percorre todas as linhas sem materializar o dataset inteiro em memoria.
 * O callback recebe blocos de `chunkSize` linhas.
 */
export async function iterateCsvRows(
  onChunk: (rows: CsvRow[]) => void | Promise<void>,
  chunkSize = 500,
): Promise<number> {
  const db = await getDb();
  let total = 0;
  let buffer: CsvRow[] = [];
  let cursor = await db.transaction("rows").store.openCursor();

  while (cursor) {
    buffer.push(cursor.value);
    total += 1;
    if (buffer.length >= chunkSize) {
      const chunk = buffer;
      buffer = [];
      await onChunk(chunk);
    }
    cursor = await cursor.continue();
  }

  if (buffer.length > 0) await onChunk(buffer);
  return total;
}

export async function updateCsvRows(
  updates: Array<Partial<CsvRow> & Pick<CsvRow, "id">>,
): Promise<number> {
  if (updates.length === 0) return 0;

  const db = await getDb();
  const tx = db.transaction("rows", "readwrite");
  let written = 0;

  for (const update of updates) {
    const current = await tx.store.get(update.id);
    if (!current) continue;

    const hasNewContent = Boolean(update.newTitle || update.newDescription);
    const next: CsvRow = {
      ...current,
      ...update,
      optimizedTitle: Boolean(update.newTitle ?? current.newTitle),
      optimizedDesc: Boolean(update.newDescription ?? current.newDescription),
      optimizationError:
        update.optimizationError ?? (hasNewContent ? undefined : current.optimizationError),
    };

    await tx.store.put(next);
    written += 1;
  }

  await tx.done;
  return written;
}
