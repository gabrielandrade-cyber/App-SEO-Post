import type { CsvRow } from "@/lib/store";

export { PROVIDER_LABELS } from "@/lib/providers";

/** Colunas: URL, title atual, novo title, description atual, nova description, acoes. */
export const SERP_GRID_TEMPLATE =
  "minmax(0, 0.8fr) minmax(0, 0.9fr) minmax(0, 1.3fr) minmax(0, 1.1fr) minmax(0, 1.45fr) 88px";

export const CSV_ACCEPTED_EXTENSIONS = [".csv", ".txt", ".tsv"];
export const CSV_ACCEPTED_TYPES = [
  "text/csv",
  "text/plain",
  "text/tab-separated-values",
  "application/csv",
  "application/vnd.ms-excel",
];

export function isAcceptedCsvFile(file: File): boolean {
  const name = file.name.toLowerCase();
  if (CSV_ACCEPTED_EXTENSIONS.some((ext) => name.endsWith(ext))) return true;
  return CSV_ACCEPTED_TYPES.includes(file.type);
}

export function sanitizeCsvFileName(name: string): string {
  const withoutExtension = name.replace(/\.[^/.]+$/, "");
  const cleaned = withoutExtension
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "");

  return cleaned || "serp-controle";
}

/**
 * Escapa um valor para CSV e neutraliza injecao de formula: celulas que
 * comecam com = + - @ ou tab ganham um apostrofo, como recomenda a OWASP,
 * para o Excel e o Sheets nao interpretarem o texto como formula.
 */
export function escapeCsvValue(value?: string): string {
  let text = (value ?? "").normalize("NFC").replace(/\r?\n/g, " ").trim();
  if (/^[=+\-@\t]/.test(text)) text = `'${text}`;
  return /[",;\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Prefixo BOM para o Excel reconhecer UTF-8 ao abrir com duplo clique. */
export const CSV_BOM = "﻿";

/**
 * Layout de upload da liveSEO: 7 colunas, sem cabecalho, separadas por
 * virgula. Ordem: URL, novo title, nova description, justificativa do title,
 * justificativa da description, title atual, description atual.
 */
export function buildControlCsvLines(rows: CsvRow[]): string {
  return rows
    .map((row) =>
      [
        row.url,
        row.newTitle ?? "",
        row.newDescription ?? "",
        row.titleJustification ?? "",
        row.descriptionJustification ?? "",
        row.title,
        row.description,
      ]
        .map(escapeCsvValue)
        .join(","),
    )
    .join("\r\n");
}

export function buildControlCsv(rows: CsvRow[]): string {
  return CSV_BOM + buildControlCsvLines(rows);
}

/** Dispara o download de um Blob de forma compativel com Firefox e Safari. */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  window.setTimeout(() => {
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, 10_000);
}
