/**
 * Encaixe deterministico de SERP nas faixas de caracteres, no espirito do
 * `fit` da skill de SERP da liveSEO. Puro (sem SDK, sem React), para ser
 * testado isoladamente e usado no servidor depois das rodadas de reparo da IA.
 */

import { SERP_LIMITS, serpLength } from "./providers";

export interface SerpTexts {
  newTitle?: string;
  newDescription?: string;
}

export interface CharRange {
  min: number;
  max: number;
}

/** Pool de CTAs da diretriz liveSEO, do mais curto ao mais longo. */
export const CTA_POOL = [
  "Vem ver!",
  "Confira!",
  "Escolha o seu!",
  "Veja os modelos!",
  "Confira a coleção!",
  "Confira as opções!",
  "Explore as opções!",
  "Encontre o seu aqui!",
  "Veja o que chegou!",
  "Monte o seu look!",
  "Conheça a coleção completa!",
  "Confira e monte o seu look!",
];

export function lengthProblems(result: SerpTexts): string[] {
  const problems: string[] = [];
  const { title, description } = SERP_LIMITS;
  const titleLen = serpLength(result.newTitle ?? "");
  const descLen = serpLength(result.newDescription ?? "");

  if (titleLen < title.min)
    problems.push(`title curto: ${titleLen} caracteres, minimo ${title.min}`);
  if (titleLen > title.max)
    problems.push(`title longo: ${titleLen} caracteres, maximo ${title.max}`);
  if (descLen < description.min) {
    problems.push(`description curta: ${descLen} caracteres, minimo ${description.min}`);
  }
  if (descLen > description.max) {
    problems.push(`description longa: ${descLen} caracteres, maximo ${description.max}`);
  }

  return problems;
}

/** Distancia (em caracteres) de um texto ate a faixa; 0 quando esta dentro. */
export function distanceToRange(text: string, range: CharRange): number {
  const len = serpLength(text);
  if (len < range.min) return range.min - len;
  if (len > range.max) return len - range.max;
  return 0;
}

/** true quando `candidate` fica mais longe da faixa do que `current`. */
export function worse(candidate: string, current: string, range: CharRange): boolean {
  return distanceToRange(candidate, range) > distanceToRange(current, range);
}

/** Separa a description em corpo e CTA final (ultima frase curta terminada em "!"). */
export function splitCta(description: string): { body: string; cta: string | null } {
  const match = description.match(/^(.*?[.!?…])\s+([^.!?]{3,34}!)$/s);
  if (match) return { body: match[1].trim(), cta: match[2].trim() };
  return { body: description.trim(), cta: null };
}

/** Corta em `max` caracteres na ultima palavra inteira, sem pontuacao solta no fim. */
export function trimAtWord(text: string, max: number): string {
  const chars = Array.from(text);
  if (chars.length <= max) return text;
  const cut = chars.slice(0, max).join("");
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[\s,;:]+$/g, "");
}

/**
 * Quando a IA nao acertou a faixa depois das rodadas de reparo, encaixa a
 * description trocando so o CTA final (o corpo escrito e preservado) e corta
 * o title por palavra. So mexe quando o resultado fica dentro da faixa; senao
 * deixa o texto como veio, e a UI mostra o contador em vermelho.
 */
export function fitDeterministic(result: SerpTexts): void {
  const { title, description } = SERP_LIMITS;

  if (result.newTitle) {
    const len = serpLength(result.newTitle);
    if (len > title.max) {
      const trimmed = trimAtWord(result.newTitle, title.max);
      if (serpLength(trimmed) >= title.min) result.newTitle = trimmed;
    }
  }

  if (result.newDescription) {
    const len = serpLength(result.newDescription);
    if (len < description.min || len > description.max) {
      const { body, cta } = splitCta(result.newDescription);
      const candidates = cta ? [cta, ...CTA_POOL.filter((item) => item !== cta)] : [...CTA_POOL];

      const tryBody = (base: string): string | null => {
        for (const candidate of candidates) {
          const full = `${base} ${candidate}`;
          const total = serpLength(full);
          if (total >= description.min && total <= description.max) return full;
        }
        return null;
      };

      let fitted = tryBody(body);
      if (!fitted && len > description.max) {
        // Corpo longo demais para qualquer CTA: corta o corpo por palavra e tenta de novo.
        const shortest = serpLength(CTA_POOL[0]) + 1;
        const room = description.max - shortest;
        const trimmedBody = trimAtWord(body, room).replace(/[.!?…]*$/, ".");
        fitted = tryBody(trimmedBody);
      }
      if (fitted) result.newDescription = fitted;
    }
  }
}
