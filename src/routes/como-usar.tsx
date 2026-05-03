import { createFileRoute } from "@tanstack/react-router";
import { 
  Key, FileSpreadsheet, Bot, Download,
  CheckCircle2, AlertCircle, ArrowRight, Sparkles
} from "lucide-react";

export const Route = createFileRoute("/como-usar")({
  component: ComoUsar,
});

function ComoUsar() {
  return (
    <main className="min-h-screen pt-8 pb-20 px-4">
      <div className="mx-auto max-w-4xl space-y-12">
        <div className="text-center space-y-4">
          <div className="inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-400 to-fuchsia-500 shadow-[0_0_30px_-5px_rgba(168,85,247,0.6)] mb-2">
            <Bot className="h-8 w-8 text-white" />
          </div>
          <h1 className="text-4xl font-extrabold tracking-tight text-white sm:text-5xl">
            Como usar o SERP Optimizer
          </h1>
          <p className="mx-auto max-w-2xl text-lg text-white/60">
            Um guia rápido para automatizar a criação de Meta Titles e Descriptions de alta conversão usando inteligência artificial gratuita.
          </p>
        </div>

        <div className="space-y-8">
          {/* Passo 1 */}
          <div className="group relative overflow-hidden rounded-3xl border border-white/10 bg-white/5 p-8 transition-all hover:bg-white/10">
            <div className="absolute -right-20 -top-20 h-64 w-64 rounded-full bg-indigo-500/10 blur-3xl transition-all group-hover:bg-indigo-500/20" />
            <div className="relative z-10 space-y-6">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-500/20 text-indigo-300">
                <Key className="h-6 w-6" />
              </div>
              <div>
                <h3 className="text-xl font-bold text-white mb-2">1. Obter a sua API Key</h3>
                <p className="text-white/60 leading-relaxed mb-6">
                  Para usar a inteligência artificial gratuitamente, precisa de gerar uma chave (API Key) num dos fornecedores suportados.
                </p>
                <div className="grid gap-4 sm:grid-cols-3">
                  <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-4 transition-colors hover:bg-white/[0.04]">
                    <h4 className="font-semibold text-white/80 text-sm mb-1">Google Gemini (Recomendado)</h4>
                    <p className="text-[11px] text-white/50 mb-3">Integração nativa Google. Excelente qualidade de texto e contexto.</p>
                    <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-[11px] font-medium text-sky-400 hover:text-sky-300">
                      Gerar chave Google <ArrowRight className="h-3 w-3" />
                    </a>
                  </div>
                  <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-4 transition-colors hover:bg-white/[0.04]">
                    <h4 className="font-semibold text-white/80 text-sm mb-1">Groq</h4>
                    <p className="text-[11px] text-white/50 mb-3">Modelos ultrarrápidos (Llama 3.3). Muito generoso no free tier.</p>
                    <a href="https://console.groq.com/keys" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-[11px] font-medium text-amber-400 hover:text-amber-300">
                      Gerar chave Groq <ArrowRight className="h-3 w-3" />
                    </a>
                  </div>
                  <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-4 transition-colors hover:bg-white/[0.04]">
                    <h4 className="font-semibold text-white/80 text-sm mb-1">Cerebras</h4>
                    <p className="text-[11px] text-white/50 mb-3">Respostas instantâneas e limite de 30 requisições por minuto.</p>
                    <a href="https://cloud.cerebras.ai" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-[11px] font-medium text-indigo-400 hover:text-indigo-300">
                      Criar conta Cerebras <ArrowRight className="h-3 w-3" />
                    </a>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Passo 2 */}
          <div className="group relative overflow-hidden rounded-3xl border border-white/10 bg-white/5 p-8 transition-all hover:bg-white/10">
            <div className="absolute -left-20 -top-20 h-64 w-64 rounded-full bg-emerald-500/10 blur-3xl transition-all group-hover:bg-emerald-500/20" />
            <div className="relative z-10 space-y-6">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500/20 text-emerald-300">
                <FileSpreadsheet className="h-6 w-6" />
              </div>
              <div>
                <h3 className="text-xl font-bold text-white mb-2">2. Preparar o seu Ficheiro CSV</h3>
                <p className="text-white/60 leading-relaxed mb-6">
                  A aplicação precisa de uma lista de URLs para saber o que otimizar. Pode exportar isto do Google Search Console, Screaming Frog ou Shopify.
                </p>
                
                <div className="rounded-2xl border border-white/10 bg-black/20 p-4 font-mono text-[11px] text-white/70">
                  <div className="flex gap-4 border-b border-white/10 pb-2 mb-2 text-white/40">
                    <span className="w-1/3">URL</span>
                    <span className="w-1/3">Title (opcional)</span>
                    <span className="w-1/3">Description (opcional)</span>
                  </div>
                  <div className="flex gap-4">
                    <span className="w-1/3 text-emerald-400">https://loja.com/produto-1</span>
                    <span className="w-1/3 truncate">Ténis Desportivos</span>
                    <span className="w-1/3 truncate">Compre ténis desportivos...</span>
                  </div>
                  <div className="flex gap-4 mt-2">
                    <span className="w-1/3 text-emerald-400">https://loja.com/produto-2</span>
                    <span className="w-1/3 truncate"></span>
                    <span className="w-1/3 truncate"></span>
                  </div>
                </div>
                <div className="mt-4 flex items-start gap-3 rounded-xl bg-indigo-500/10 border border-indigo-500/20 p-4">
                  <AlertCircle className="h-5 w-5 text-indigo-400 shrink-0 mt-0.5" />
                  <p className="text-sm text-white/70">Apenas a coluna "URL" é estritamente necessária. Se o ficheiro tiver colunas a mais, o sistema irá ignorá-las automaticamente.</p>
                </div>
              </div>
            </div>
          </div>

          {/* Passo 3 & 4 (Grid) */}
          <div className="grid gap-8 md:grid-cols-2">
            <div className="group relative overflow-hidden rounded-3xl border border-white/10 bg-white/5 p-8 transition-all hover:bg-white/10">
              <div className="relative z-10 space-y-6">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-fuchsia-500/20 text-fuchsia-300">
                  <Bot className="h-6 w-6" />
                </div>
                <div>
                  <h3 className="text-xl font-bold text-white mb-2">3. Otimização Mágica</h3>
                  <p className="text-white/60 leading-relaxed text-sm mb-4">
                    Arraste o seu CSV para a zona de upload. Selecione a aba do provedor na barra lateral esquerda, insira a API Key e clique em Otimizar.
                  </p>
                  <div className="space-y-3">
                    <div className="flex items-start gap-2 text-sm text-white/80">
                      <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
                      <span>Pode processar <strong>linhas individuais</strong> clicando nos botões da tabela.</span>
                    </div>
                    <div className="flex items-start gap-2 text-sm text-white/80">
                      <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
                      <span>Pode processar <strong>tudo em lote</strong> usando os botões no topo.</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="group relative overflow-hidden rounded-3xl border border-white/10 bg-white/5 p-8 transition-all hover:bg-white/10">
              <div className="absolute -right-20 -bottom-20 h-64 w-64 rounded-full bg-cyan-500/10 blur-3xl transition-all group-hover:bg-cyan-500/20" />
              <div className="relative z-10 space-y-6">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-cyan-500/20 text-cyan-300">
                  <Download className="h-6 w-6" />
                </div>
                <div>
                  <h3 className="text-xl font-bold text-white mb-2">4. Exportar Resultados</h3>
                  <p className="text-white/60 leading-relaxed text-sm">
                    Assim que a IA terminar o seu trabalho, basta clicar em Download. O ficheiro resultante será um CSV formatado que pode ser importado diretamente para o seu CMS favorito (como WordPress, Shopify, Magento, entre outros).
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Dica Extra */}
          <div className="group relative overflow-hidden rounded-3xl border border-fuchsia-500/20 bg-gradient-to-br from-indigo-500/5 to-fuchsia-500/5 p-8 transition-all hover:bg-white/10">
            <div className="relative z-10 space-y-6">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-fuchsia-500/20 text-fuchsia-400">
                <Sparkles className="h-6 w-6" />
              </div>
              <div>
                <h3 className="text-xl font-bold text-white mb-2">Como a IA sabe o que escrever?</h3>
                <p className="text-white/60 leading-relaxed mb-4">
                  A aplicação combina as informações extraídas <strong>através do texto da URL</strong> (ex: extrai palavras como "tenis", "masculino", "corrida" de <code className="text-fuchsia-300">loja.com/tenis-masculino-corrida</code>) com um <strong>Prompt de Sistema</strong> extremamente robusto e focado em SEO.
                </p>
                <p className="text-white/60 leading-relaxed">
                  Você tem controlo total sobre este processo! No Workspace, procure por <strong>Personalizar Prompts</strong> na barra lateral esquerda. Lá pode ajustar o tom de voz, adicionar regras para a sua marca, ou mudar completamente o foco das descrições e títulos gerados.
                </p>
              </div>
            </div>
          </div>

        </div>

        <div className="mt-16 text-center text-sm text-white/40 flex items-center justify-center gap-1.5 pb-8">
          criado por Gabriel Andrade <span className="text-rose-500">❤</span>
        </div>
      </div>
    </main>
  );
}
