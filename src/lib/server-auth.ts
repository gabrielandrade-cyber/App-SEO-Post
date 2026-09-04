/**
 * Guarda de acesso dos endpoints do Worker.
 *
 * O OPTMOS e BYOK e nao tem login, entao o endpoint de lote e a server
 * function de visao seriam publicos para qualquer um que descobrisse a URL.
 * Duas barreiras baratas:
 *
 * 1. Mesma origem: navegadores mandam `Sec-Fetch-Site: same-origin` quando a
 *    propria pagina do app chama o endpoint. Um site de terceiros nao consegue
 *    forjar esse header, o que bloqueia CSRF e uso a partir de outras paginas.
 * 2. Token compartilhado opcional: se o Worker tiver a variavel
 *    OPTMOS_ACCESS_TOKEN (definida com `wrangler secret put`), toda chamada
 *    precisa mandar o mesmo valor no header `x-optmos-token`. O usuario cola
 *    o token no painel de configuracoes do app.
 */

const TOKEN_HEADER = "x-optmos-token";

export interface AccessDenied {
  ok: false;
  status: number;
  message: string;
}

export type AccessCheck = { ok: true } | AccessDenied;

function readEnvToken(): string {
  try {
    const value =
      typeof process !== "undefined" && process.env ? process.env.OPTMOS_ACCESS_TOKEN : undefined;
    return typeof value === "string" ? value.trim() : "";
  } catch {
    return "";
  }
}

function isSameOrigin(request: Request): boolean {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite) return fetchSite === "same-origin" || fetchSite === "none";

  const origin = request.headers.get("origin");
  if (!origin) return true;

  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

export function checkRequestAccess(request: Request): AccessCheck {
  if (!isSameOrigin(request)) {
    return {
      ok: false,
      status: 403,
      message: "Requisicao recusada: este endpoint so aceita chamadas feitas pelo proprio OPTMOS.",
    };
  }

  const expected = readEnvToken();
  if (expected) {
    const provided = (request.headers.get(TOKEN_HEADER) ?? "").trim();
    if (provided !== expected) {
      return {
        ok: false,
        status: 401,
        message:
          "Token de acesso ausente ou invalido. Cole o token configurado no Worker no painel de configuracoes (campo Token de acesso).",
      };
    }
  }

  return { ok: true };
}

export function accessTokenHeader(token: string | undefined): Record<string, string> {
  const value = (token ?? "").trim();
  return value ? { [TOKEN_HEADER]: value } : {};
}
