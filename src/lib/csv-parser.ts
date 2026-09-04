/**
 * Importacao de CSV para o IndexedDB, em streaming.
 *
 * Mapeamento de colunas:
 *   - Se a primeira linha for um cabecalho, as colunas sao encontradas por
 *     nome (URL / Title / Description e variantes em portugues, incluindo os
 *     nomes que o Screaming Frog exporta). Colunas extras sao ignoradas.
 *   - Sem cabecalho, o mapeamento e posicional: 1a URL, 2a title, 3a description.
 *
 * O arquivo e lido em blocos (modo `chunk` do papaparse, na thread principal:
 * o modo worker nao suporta pause/resume) e gravado em lotes de FLUSH_SIZE
 * linhas. A base anterior so e apagada depois que a primeira linha valida do
 * arquivo novo e encontrada: um arquivo invalido nunca destroi o trabalho
 * anterior.
 */

import Papa from "papaparse";
import { putCsvRows, resetCsvData, setCsvRowCount } from "./db";
import type { CsvRow } from "./store";

export interface ImportProgress {
  imported: number;
}

export interface ColumnMapping {
  url: number;
  title: number | null;
  description: number | null;
  /** true quando a primeira linha foi reconhecida como cabecalho. */
  byName: boolean;
}

export interface ImportResult {
  rowsImported: number;
  errors: string[];
  warnings: string[];
  mapping: ColumnMapping | null;
}

const FLUSH_SIZE = 1000;
const CHUNK_BYTES = 1024 * 1024;
const MAX_WARNINGS = 3;

const URL_HEADERS = new Set([
  "url",
  "urls",
  "address",
  "endereco",
  "link",
  "links",
  "pagina",
  "page",
  "url da pagina",
  "landing page",
]);

function normalizeHeader(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function looksLikeUrl(value: string): boolean {
  const cell = value.trim().toLowerCase();
  if (!cell) return false;
  return (
    /^https?:\/\//.test(cell) ||
    cell.startsWith("www.") ||
    cell.startsWith("/") ||
    /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/|$)/.test(cell)
  );
}

/**
 * Decide se a primeira linha e cabecalho e, se for, onde estao as colunas.
 * Retorna null quando a linha ja e dado (sem cabecalho).
 */
export function detectColumnMapping(firstRow: string[]): ColumnMapping | null {
  const cells = firstRow.map((cell) => normalizeHeader(cell ?? ""));

  let url: number | null = null;
  let title: number | null = null;
  let description: number | null = null;

  cells.forEach((cell, index) => {
    if (
      url === null &&
      (URL_HEADERS.has(cell) || cell === "url atual" || cell.startsWith("url "))
    ) {
      url = index;
      return;
    }
    if (description === null && /(description|descricao)/.test(cell)) {
      description = index;
      return;
    }
    if (title === null && /(^|\s)(title|titulo)(\s|$|\d)/.test(cell)) {
      title = index;
    }
  });

  if (url !== null) {
    return { url, title, description, byName: true };
  }

  // Nenhuma coluna nomeada. Se a primeira celula parece URL, nao ha cabecalho.
  if (looksLikeUrl(firstRow[0] ?? "")) return null;

  // Texto sem cara de URL na primeira celula: cabecalho generico, mapeamento posicional.
  return { url: 0, title: 1, description: 2, byName: false };
}

function describePapaError(error: Papa.ParseError): string {
  const where = typeof error.row === "number" ? ` (linha ${error.row + 1})` : "";
  switch (error.code) {
    case "UndetectableDelimiter":
      return "Nao foi possivel detectar o separador de colunas; o arquivo pode ter uma coluna so.";
    case "MissingQuotes":
      return `Aspas abertas sem fechar${where}. Parte do conteudo pode ter sido colada numa unica celula.`;
    case "TooFewFields":
      return `Linha com menos colunas que o esperado${where}.`;
    case "TooManyFields":
      return `Linha com mais colunas que o esperado${where}.`;
    default:
      return `${error.message}${where}`;
  }
}

export async function importCSVToIndexedDB(
  file: File,
  onProgress?: (progress: ImportProgress) => void,
): Promise<ImportResult> {
  return new Promise((resolve) => {
    const errors: string[] = [];
    const warnings: string[] = [];
    const seenWarningCodes = new Set<string>();
    let mapping: ColumnMapping | null = null;
    let headerChecked = false;
    let buffer: CsvRow[] = [];
    let imported = 0;
    let dbReady = false;
    let settled = false;
    let pendingFlush: Promise<void> = Promise.resolve();

    const ensureDbReset = async () => {
      if (dbReady) return;
      await resetCsvData(file.name);
      dbReady = true;
    };

    const flush = async () => {
      if (buffer.length === 0) return;
      const rowsToStore = buffer;
      buffer = [];
      await ensureDbReset();
      await putCsvRows(rowsToStore);
      await setCsvRowCount(imported);
      onProgress?.({ imported });
    };

    const finish = async () => {
      if (settled) return;
      settled = true;

      try {
        await pendingFlush;
        await flush();
        if (dbReady) await setCsvRowCount(imported);
      } catch (err) {
        errors.push(
          `Falha ao gravar as linhas no navegador: ${err instanceof Error ? err.message : "erro desconhecido"}.`,
        );
      }

      if (imported === 0 && errors.length === 0) {
        errors.push(
          "Nenhuma linha valida encontrada no CSV (a primeira coluna precisa ser a URL).",
        );
      }

      resolve({ rowsImported: imported, errors, warnings, mapping });
    };

    const noteWarnings = (parseErrors: Papa.ParseError[]) => {
      for (const error of parseErrors) {
        if (seenWarningCodes.has(error.code)) continue;
        seenWarningCodes.add(error.code);
        if (warnings.length < MAX_WARNINGS) warnings.push(describePapaError(error));
      }
    };

    Papa.parse<string[]>(file, {
      header: false,
      skipEmptyLines: "greedy",
      chunkSize: CHUNK_BYTES,
      chunk(results, parser) {
        if (settled) return;
        if (results.errors?.length) noteWarnings(results.errors);

        const rows = results.data;
        let startAt = 0;

        if (!headerChecked && rows.length > 0) {
          headerChecked = true;
          const detected = detectColumnMapping(rows[0]);
          // null = a primeira linha ja e dado; qualquer mapping = havia cabecalho.
          mapping = detected ?? { url: 0, title: 1, description: 2, byName: false };
          startAt = detected ? 1 : 0;
        }

        const map = mapping ?? { url: 0, title: 1, description: 2, byName: false };

        for (let index = startAt; index < rows.length; index += 1) {
          const cols = rows[index];
          const url = (cols[map.url] ?? "").trim();
          if (!url) continue;

          imported += 1;
          buffer.push({
            id: imported,
            url,
            title: map.title === null ? "" : (cols[map.title] ?? "").trim(),
            description: map.description === null ? "" : (cols[map.description] ?? "").trim(),
          });
        }

        onProgress?.({ imported });

        if (buffer.length >= FLUSH_SIZE) {
          parser.pause();
          pendingFlush = pendingFlush
            .then(flush)
            .then(() => parser.resume())
            .catch((err) => {
              errors.push(
                `Falha ao gravar as linhas no navegador: ${err instanceof Error ? err.message : "erro desconhecido"}.`,
              );
              parser.abort();
              void finish();
            });
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
