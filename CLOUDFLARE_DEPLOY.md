# Cloudflare Deployment Guide

## CI/CD Environment Variables

No painel da Cloudflare (Settings > Variables and Secrets), siga estas instruções para configurar o ambiente corretamente e garantir a segurança das chaves das APIs de IA:

1. **Adicionar variável de ambiente para processo:**
   - **Nome:** `CLOUDFLARE_INCLUDE_PROCESS_ENV`
   - **Type:** Clear Text
   - **Valor:** `true`
   *(Como o TanStack Start roda a pré-renderização durante o tempo de build na Cloudflare, ele precisa de acesso ao contexto de variáveis).*

2. **Chaves de APIs de IA (Sobre o modelo BYOK):**
   - Como a nossa aplicação utiliza o modelo **BYOK (Bring Your Own Key)**, **NÃO É NECESSÁRIO** adicionar chaves de IA (Gemini, Groq, etc) no painel da Cloudflare.
   - As chaves são inseridas pelos usuários diretamente no navegador da aplicação, salvas no `localStorage` localmente, e enviadas ao backend (Cloudflare Workers) de forma segura em cada requisição.
   - A nossa principal preocupação (já resolvida no código) era apenas garantir que essas chaves enviadas pelos usuários não fossem impressas de volta nos logs do console da Cloudflare.
