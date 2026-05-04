# Cloudflare Deployment Guide

## CI/CD Environment Variables

No painel da Cloudflare (Settings > Variables and Secrets), siga estas instruções para configurar o ambiente corretamente e garantir a segurança das chaves das APIs de IA:

1. **Adicionar variável de ambiente para processo:**
   - **Nome:** `CLOUDFLARE_INCLUDE_PROCESS_ENV`
   - **Type:** Clear Text
   - **Valor:** `true`
   *(Como o TanStack Start roda a pré-renderização durante o tempo de build na Cloudflare, ele precisa de acesso ao contexto de variáveis).*

2. **Adicionar Chaves de APIs de IA (MÁXIMA SEGURANÇA):**
   - Devem ser adicionadas **estritamente como "Secrets" (Criptografadas)** para não vazar informações e proteger o uso de BYOK (Bring Your Own Key).
   - Exemplos de nomes de variáveis:
     - `GEMINI_API_KEY`
     - `GROQ_API_KEY`
     - `OPENAI_API_KEY`
