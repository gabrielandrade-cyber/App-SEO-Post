import { openDB, type DBSchema, type IDBPDatabase } from "idb";
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
  updatedAt: Date.now(),
});

function getDb() {
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
  const meta = await getCsvMeta();
  await setCsvMeta({ ...meta, rowCount });
}

export async function getQueueState(): Promise<QueueState> {
  return getMetaValue<QueueState>(QUEUE_STATE_KEY, emptyQueueState());
}

export async function setQueueState(next: Partial<QueueState>): Promise<QueueState> {
  const current = await getQueueState();
  const state: QueueState = {
    ...current,
    ...next,
    updatedAt: Date.now(),
  };
  await setMetaValue(QUEUE_STATE_KEY, state);
  return state;
}

export async function resetCsvData(fileName: string): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(["rows", "meta"], "readwrite");
  await tx.objectStore("rows").clear();
  await tx.objectStore("meta").put({
    key: CSV_META_KEY,
    value: {
      fileName,
      rowCount: 0,
      importedAt: Date.now(),
    } satisfies CsvMeta,
  });
  await tx.objectStore("meta").put({
    key: QUEUE_STATE_KEY,
    value: emptyQueueState(),
  });
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
  await Promise.all(rows.map((row) => tx.store.put(row)));
  await tx.done;
}

export async function getCsvRow(id: number): Promise<CsvRow | undefined> {
  const db = await getDb();
  return db.get("rows", id);
}

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

export async function getAllCsvRows(): Promise<CsvRow[]> {
  const db = await getDb();
  const rows: CsvRow[] = [];
  let cursor = await db.transaction("rows").store.openCursor();

  while (cursor) {
    rows.push(cursor.value);
    cursor = await cursor.continue();
  }

  return rows;
}

export async function updateCsvRows(
  updates: Array<Partial<CsvRow> & Pick<CsvRow, "id">>,
): Promise<void> {
  if (updates.length === 0) return;

  const db = await getDb();
  const tx = db.transaction("rows", "readwrite");

  for (const update of updates) {
    const current = await tx.store.get(update.id);
    if (!current) continue;

    const next: CsvRow = {
      ...current,
      ...update,
      optimizedTitle: Boolean(update.newTitle ?? current.newTitle ?? current.optimizedTitle),
      optimizedDesc: Boolean(
        update.newDescription ?? current.newDescription ?? current.optimizedDesc,
      ),
      optimizationError:
        update.optimizationError ??
        (update.newTitle || update.newDescription ? undefined : current.optimizationError),
      loadingTitle: false,
      loadingDesc: false,
    };

    await tx.store.put(next);
  }

  await tx.done;
}
