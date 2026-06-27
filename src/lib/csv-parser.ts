/**
 * CSV Parser — PapaParse wrapper with POSITIONAL column mapping.
 *
 * Strategy:
 *   - 1st column → URL
 *   - 2nd column → Title
 *   - 3rd column → Meta Description (optional — empty string if absent)
 *
 * If the CSV has headers that match known aliases (url, title, description),
 * those are used. Otherwise, falls back to column position.
 *
 * Supports files up to 10k+ lines (web worker for files >2MB).
 */

import Papa from "papaparse";
import { putCsvRows, resetCsvData, setCsvRowCount } from "./db";
import type { CsvRow } from "./store";

export interface ParseResult {
  rows: CsvRow[];
  errors: string[];
}

export interface ImportProgress {
  imported: number;
}

export interface ImportResult {
  rowsImported: number;
  errors: string[];
}

const FLUSH_SIZE = 1000;

function looksLikeUrl(value: string): boolean {
  const firstCell = value.trim().toLowerCase();
  return firstCell.includes("http") || firstCell.includes("www.") || firstCell.includes(".");
}

/**
 * Parse a CSV File and return rows.
 *
 * Uses positional mapping: col 1 = URL, col 2 = Title, col 3 = Description.
 * If the file has no 3rd column, description defaults to empty string.
 */
export function parseCSV(file: File): Promise<ParseResult> {
  return new Promise((resolve) => {
    Papa.parse(file, {
      // Parse WITHOUT header mode so we always get arrays and can map by position
      header: false,
      skipEmptyLines: true,
      // Enable worker for large files to avoid blocking the main thread
      worker: file.size > 2 * 1024 * 1024, // >2 MB → use web worker
      complete(results) {
        const rawRows = results.data as string[][];

        if (rawRows.length === 0) {
          resolve({ rows: [], errors: ["O ficheiro CSV está vazio."] });
          return;
        }

        // Need at least 1 column (URL); Title and Description are optional
        if (rawRows[0].length < 1) {
          resolve({
            rows: [],
            errors: [
              "O CSV precisa de pelo menos 1 coluna (URL). Verifique o formato do ficheiro.",
            ],
          });
          return;
        }

        // ─── Detect if the first row is a header row ──────────────────
        // Heuristic: if the first cell looks like a URL (contains "." or "http")
        // then there's no header row. Otherwise, skip the first row as a header.
        const dataRows = looksLikeUrl(rawRows[0][0] ?? "") ? rawRows : rawRows.slice(1);

        // ─── Map positional columns to typed rows ─────────────────────
        const rows: CsvRow[] = dataRows
          .filter((cols) => (cols[0] ?? "").trim().length > 0) // skip empty URL rows
          .map((cols, i) => ({
            id: i + 1,
            url: (cols[0] ?? "").trim(),
            title: (cols[1] ?? "").trim(),
            description: (cols[2] ?? "").trim(), // empty if CSV has only 2 columns
          }));

        if (rows.length === 0) {
          resolve({ rows: [], errors: ["Nenhuma linha válida encontrada no CSV."] });
          return;
        }

        resolve({ rows, errors: [] });
      },
      error(err) {
        resolve({ rows: [], errors: [`Erro ao ler o CSV: ${err.message}`] });
      },
    });
  });
}

export async function importCSVToIndexedDB(
  file: File,
  onProgress?: (progress: ImportProgress) => void,
): Promise<ImportResult> {
  await resetCsvData(file.name);

  return new Promise((resolve) => {
    const errors: string[] = [];
    let buffer: CsvRow[] = [];
    let imported = 0;
    let nextId = 1;
    let firstRowChecked = false;
    let settled = false;
    let pendingFlush = Promise.resolve();

    const flush = async () => {
      if (buffer.length === 0) return;
      const rowsToStore = buffer;
      buffer = [];
      await putCsvRows(rowsToStore);
      await setCsvRowCount(imported);
      onProgress?.({ imported });
    };

    const finish = async () => {
      if (settled) return;
      settled = true;
      await pendingFlush;
      await flush();
      await setCsvRowCount(imported);

      if (imported === 0 && errors.length === 0) {
        errors.push("Nenhuma linha valida encontrada no CSV.");
      }

      resolve({ rowsImported: imported, errors });
    };

    Papa.parse<string[]>(file, {
      header: false,
      skipEmptyLines: true,
      worker: file.size > 2 * 1024 * 1024,
      step(result, parser) {
        const cols = result.data;

        if (!firstRowChecked) {
          firstRowChecked = true;

          if (!cols || cols.length < 1) {
            errors.push("O CSV precisa de pelo menos 1 coluna (URL).");
            parser.abort();
            void finish();
            return;
          }

          if (!looksLikeUrl(cols[0] ?? "")) return;
        }

        const url = (cols[0] ?? "").trim();
        if (!url) return;

        buffer.push({
          id: nextId++,
          url,
          title: (cols[1] ?? "").trim(),
          description: (cols[2] ?? "").trim(),
        });
        imported += 1;

        if (buffer.length >= FLUSH_SIZE) {
          parser.pause();
          pendingFlush = pendingFlush.then(flush).then(() => parser.resume());
        }
      },
      complete() {
        void finish();
      },
      error(err) {
        errors.push(`Erro ao ler o CSV: ${err.message}`);
        void finish();
      },
    });
  });
}
