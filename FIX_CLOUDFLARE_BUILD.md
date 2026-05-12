# Resolução: build Cloudflare Pages + TanStack Start (Bun)

Este guia cobre o erro `lockfile had changes, but lockfile is frozen` e a configuração segura de variáveis no painel da Cloudflare.

## O que já foi feito no repositório

- **`bun.lockb`** foi regenerado com **Bun 1.3.13** (instalação limpa após remover `node_modules` e o lockfile antigo).
- **`wrangler.jsonc`** já contém `"compatibility_flags": ["nodejs_compat"]`, necessário para os SDKs Node (OpenAI, Google GenAI, etc.) no Worker.
- **Não existem chaves de API** em `wrangler.jsonc` (apenas `name`, `compatibility_*`, `main`, `observability`).

> **Importante:** o lockfile atual é da série **Bun 1.3.x**. O ambiente padrão do Cloudflare Pages (Build System V3) usa **Bun 1.2.15**, que **não consegue ler** esse `bun.lockb`. Sem alinhar a versão do Bun no painel, o build continuará a falhar mesmo com lockfile novo.

---

## Passos manuais no painel Cloudflare (Pages)

### 1. Variável de texto: acesso a `process.env` durante o build

1. Abra o projeto **Workers & Pages** → o seu site **Pages** → **Settings** → **Environment variables** (ou **Variables and Secrets**).
2. Adicione uma variável de **texto simples** (não Secret):
   - **Nome:** `CLOUDFLARE_INCLUDE_PROCESS_ENV`
   - **Valor:** `true`

Isto permite que o TanStack Start aceda às variáveis de ambiente durante o build/pré-renderização na nuvem, conforme recomendado para este stack.

### 2. Alinhar a versão do Bun ao lockfile (obrigatório com o lockfile atual)

1. Na mesma secção **Environment variables**, adicione:
   - **Nome:** `BUN_VERSION`
   - **Valor:** `1.3.13` (ou a mesma versão de Bun com que regenerou o `bun.lockb` localmente)

Referência: [Build image · Cloudflare Pages](https://developers.cloudflare.com/pages/configuration/build-image/) — a variável `BUN_VERSION` define a versão do Bun usada no comando `bun install --frozen-lockfile`.

### 3. Chaves de API de IA como **Secret** (criptografado)

Nunca coloque chaves em `wrangler.jsonc`, em ficheiros commitados ou em variáveis de texto visíveis.

1. Em **Environment variables**, para cada chave que o Worker ou o build precisarem **no servidor**, use o tipo **Secret** (valor encriptado).
2. Exemplos de nomes convencionais (ajuste ao que o seu código ler com `process.env.*`):

   | Nome sugerido (Secret) | Uso típico        |
   | ---------------------- | ----------------- |
   | `GEMINI_API_KEY`       | Google Gemini     |
   | `OPENAI_API_KEY`       | OpenAI            |
   | `GROQ_API_KEY`         | Groq              |
   | `OPENROUTER_API_KEY`   | OpenRouter        |
   | `CEREBRAS_API_KEY`     | Cerebras          |

**Nota sobre este projeto:** a app segue um modelo **BYOK** (chaves introduzidas no browser e enviadas por requisição). Mesmo assim, qualquer chave que no futuro exista só no Worker deve existir **apenas** como Secret no painel, nunca no repositório.

### 4. Git e novo deploy

1. Faça **commit** e **push** do novo `bun.lockb` (e de `node_modules` **não** — deve continuar no `.gitignore`).
2. Dispare um novo deploy no Pages; com `BUN_VERSION` alinhado e `CLOUDFLARE_INCLUDE_PROCESS_ENV=true`, o `bun install --frozen-lockfile` deve concluir sem alterar o lockfile.

---

## Verificação local (opcional)

Com a mesma versão de Bun do CI:

```bash
bun install --frozen-lockfile
```

Deve terminar sem erros e sem alterações ao `bun.lockb`.
