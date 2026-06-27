import { type AIProvider, type CsvRow } from "../../lib/store";

export const SERP_GRID_TEMPLATE =
  "minmax(0, 0.8fr) minmax(0, 0.9fr) minmax(0, 1.3fr) minmax(0, 1.1fr) minmax(0, 1.45fr) 58px";

export const PROVIDER_LABELS: Record<AIProvider, string> = {
  gemini: "Gemini",
  groq: "Groq",
  cerebras: "Cerebras",
  openai: "ChatGPT",
};

export function sanitizeCsvFileName(name: string): string {
  const withoutExtension = name.replace(/\.[^/.]+$/, "");
  const cleaned = withoutExtension
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "");

  return cleaned || "serp-controle";
}

function escapeCsvValue(value?: string): string {
  const text = (value ?? "").trim();
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function buildControlCsv(rows: CsvRow[]): string {
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
    .join("\n");
}
