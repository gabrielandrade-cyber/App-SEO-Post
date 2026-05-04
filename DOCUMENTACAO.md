# OPTMOS Hub - Documentação Oficial do Projeto

## 1. Identidade e Objetivo do Projeto
O **OPTMOS** (anteriormente SERP Optimizer) é um Hub de Ferramentas focado em otimização para SEO e Web Performance. A sua identidade central gira em torno da filosofia **"Bring Your Own Key" (BYOK)**. Isto significa que o utilizador não paga subscrições mensais por serviços de Inteligência Artificial; em vez disso, liga as suas próprias chaves (API Keys) dos escalões gratuitos de grandes fornecedores para operar a máquina sem custos recorrentes.

**Principais Módulos Atuais:**
1. **SERP Optimizer:** Processamento em lote de ficheiros CSV contendo URLs. A IA navega pelo contexto da URL e redige automaticamente `Meta Titles` e `Meta Descriptions` altamente otimizados para motores de pesquisa.
2. **Image Optimizer:** Ferramenta focada em Performance Web (Core Web Vitals). Converte instantaneamente imagens pesadas (JPG/PNG) para o formato WebP via Client-Side Canvas, garantindo privacidade e velocidade. Simultaneamente, utiliza Inteligência Artificial Multimodal (Visão) para analisar o conteúdo visual da imagem e gerar descrições ricas para a tag `Alt` e `Nomes de Ficheiro` amigáveis para SEO.

## 2. Identidade Visual (Liquid Glass)
O projeto foi desenhado sob uma diretriz visual estrita denominada **"Liquid Glass"**.
- **Inspiração:** Design moderno da Apple (iOS) com foco em profundidade, desfoque (*backdrop-blur*) e transições suaves.
- **Paleta de Cores:** Fundo escuro imersivo, com caixas transparentes (`bg-white/[0.02]`), bordas finas (`border-white/5`) e esferas de luzes néon (`blur-3xl` em tons Índigo, Fúcsia e Esmeralda).
- **Sensação:** A aplicação deve parecer "viva", fluída e de alta performance. Os cantos das caixas são excessivamente arredondados (`rounded-3xl` / `rounded-[32px]`) para um aspeto amigável e premium.

## 3. Stack Tecnológico e Arquitetura
O projeto foi construído sobre uma arquitetura moderna preparada para alojamento *Serverless* (idealmente na Vercel).

- **Frontend:** React com Vite.
- **Routing:** TanStack Router (`@tanstack/react-router`) para navegação assíncrona baseada em ficheiros.
- **Styling:** Tailwind CSS (com classes utilitárias cruas para Glassmorphism).
- **Backend / API (BFF):** TanStack Start (`createServerFn`) para criar pontes seguras entre o cliente e o servidor ao contactar as APIs das Inteligências Artificiais. A chamada à API de visão e de texto ocorre no Servidor (Node) para contornar problemas de CORS.
- **Manipulação de Ficheiros:** Conversão de imagens nativa com a Canvas API (sem backend pesado), e empacotamento em ZIP no browser usando `jszip`.
- **Inteligência Artificial:** Integração via `@google/genai` e `openai` (compatível com a Groq e Cerebras). Modelos recomendados: `gemini-2.5-flash` para Google, `meta-llama/llama-4-scout-17b-16e-instruct` para a visão da Groq.

### Gestão de Estado (SettingsProvider)
Para garantir que o utilizador não tem de colocar as suas chaves de API repetidamente, a aplicação utiliza um **Provider Global** na raiz (`__root.tsx`). Este Provider extrai as configurações do `localStorage` de forma síncrona para não quebrar a hidratação do React, distribuindo as configurações (`settings`) e o método de atualização (`dispatch`) para todos os ecrãs de forma centralizada.

---

## 4. Como Rodar em Outros Computadores

Como o projeto utiliza Node.js e Vite, instalá-lo numa máquina nova demora menos de 5 minutos.

### Pré-requisitos
- Ter o **Node.js** instalado (versão 18 ou superior). O Node.js inclui o NPM (gestor de pacotes).
- Ter o **Git** instalado (opcional, mas recomendado para clonar).

### Passo a Passo da Instalação Local

1. **Copiar os Ficheiros:**
   Descomprima o projeto numa pasta ou clone-o através do GitHub.

2. **Abrir o Terminal:**
   Navegue até à pasta raiz do projeto (onde está o ficheiro `package.json`).
   ```bash
   cd caminho/para/o/projeto/serp-studio-main
   ```

3. **Instalar as Dependências:**
   O projeto tem bibliotecas como o Tailwind, Framer Motion e Lucide que precisam de ser descarregadas. Execute:
   ```bash
   npm install
   # ou
   npm i
   ```

4. **Arrancar o Servidor de Desenvolvimento:**
   Para testar a aplicação na sua máquina, corra:
   ```bash
   npm run dev
   ```
   A consola irá devolver um URL local (normalmente `http://localhost:5173` ou `:8080`). Clique nele para abrir o Hub no navegador.

### Preparação para Deploy (Vercel ou Netlify)
Se desejar colocar o site no ar para qualquer pessoa aceder na internet:
1. Crie uma conta na [Vercel](https://vercel.com/).
2. Faça upload do projeto para um repositório no GitHub.
3. No painel da Vercel, clique em "Add New Project" e importe o seu repositório.
4. O *Framework Preset* deverá ser automaticamente detetado como **Vite** ou **React**.
5. Clique em Deploy. (A Vercel executa internamente o comando `npm run build` e expõe a pasta gerada).
