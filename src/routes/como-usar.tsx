import { createFileRoute } from "@tanstack/react-router";
import { 
  Key, FileSpreadsheet, Bot, Download,
  CheckCircle2, AlertCircle, ArrowRight, Sparkles
} from "lucide-react";

export const Route = createFileRoute("/como-usar")({
  component: ComoUsar,
});

function GlassCard({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`liquid-glass-card border border-white/10 bg-white/[0.04] p-6 shadow-[0_8px_40px_-12px_rgba(0,0,0,0.5)] ${className}`}>
      {children}
    </div>
  );
}

function Step({ number, title, description, icon: Icon, children }: any) {
  return (
    <div className="relative pl-12 pb-12 last:pb-0">
      {/* Timeline line */}
      <div className="absolute left-[19px] top-[36px] bottom-0 w-[2px] bg-white/10 last:hidden" />
      
      {/* Icon node */}
      <div className="absolute left-0 top-1 flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500/20 to-fuchsia-500/20 border border-white/20 backdrop-blur-xl shadow-[0_0_20px_-5px_rgba(168,85,247,0.4)]">
        <Icon className="h-5 w-5 text-white" />
      </div>
      
      <div>
        <div className="flex items-center gap-3 mb-2">
          <span className="text-[10px] font-bold uppercase tracking-widest text-fuchsia-400/80">Passo {number}</span>
          <h3 className="text-lg font-semibold text-white/90">{title}</h3>
        </div>
        <p className="text-sm text-white/60 mb-4">{description}</p>
        {children && (
          <div className="mt-4">
            {children}
          </div>
        )}
      </div>
    </div>
  );
}

function ComoUsar() {
  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <div className="mb-12 text-center">
        <h1 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
          Como usar o SERP Optimizer AI
        </h1>
        <p className="mt-4 text-sm text-white/60 sm:text-base">
          Um guia rápido para automatizar a criação de Meta Titles e Descriptions de alta conversão usando inteligência artificial gratuita.
        </p>
      </div>

      <div className="space-y-8">
        <GlassCard className="rounded-[32px]">
          <div className="py-4">
            <Step 
              number="1" 
              title="Obter a sua API Key" 
              description="Para usar a inteligência artificial gratuitamente, precisa de gerar uma chave (API Key) num dos fornecedores suportados."
              icon={Key}
            >
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
            </Step>

            <Step 
              number="2" 
              title="Preparar o seu Ficheiro CSV" 
              description="A aplicação precisa de uma lista de URLs para saber o que otimizar. Pode exportar isto do Google Search Console, Screaming Frog ou Shopify."
              icon={FileSpreadsheet}
            >
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
              <div className="mt-3 flex items-start gap-2 rounded-xl bg-indigo-500/10 border border-indigo-500/20 p-3">
                <AlertCircle className="h-4 w-4 text-indigo-400 shrink-0 mt-0.5" />
                <p className="text-xs text-white/70">Apenas a coluna "URL" é estritamente necessária. Se o ficheiro tiver colunas a mais, o sistema irá ignorá-las automaticamente.</p>
              </div>
            </Step>

            <Step 
              number="3" 
              title="Otimização Mágica" 
              description="Arraste o seu CSV para a zona de upload. Selecione a aba do provedor (ex: Cerebras) na barra lateral esquerda, insira a API Key e clique em Otimizar."
              icon={Bot}
            >
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm text-white/80">
                  <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                  <span>Pode processar <strong>linhas individuais</strong> clicando nos botões da tabela.</span>
                </div>
                <div className="flex items-center gap-2 text-sm text-white/80">
                  <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                  <span>Pode processar <strong>tudo em lote</strong> usando os botões "Otimizar todos" no topo da tabela.</span>
                </div>
                <div className="flex items-center gap-2 text-sm text-white/80">
                  <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                  <span>O sistema respeita automaticamente os "Rate Limits" para não exceder as quotas gratuitas.</span>
                </div>
              </div>
            </Step>

            <Step 
              number="4" 
              title="Exportar Resultados" 
              description="Assim que a IA terminar o seu trabalho, basta clicar em Download. O ficheiro resultante pode ser importado diretamente para o seu CMS."
              icon={Download}
            />
          </div>
        </GlassCard>

        {/* Custom Prompts Alert */}
        <GlassCard className="rounded-[32px] bg-gradient-to-br from-indigo-500/5 to-fuchsia-500/5 border-fuchsia-500/20">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-fuchsia-500/20">
              <Sparkles className="h-6 w-6 text-fuchsia-400" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-white/90">Como a IA sabe o que escrever?</h3>
              <p className="mt-2 text-sm text-white/60">
                A aplicação combina as informações extraídas <strong>através do texto da URL</strong> (ex: extrai palavras como "tenis", "masculino", "corrida" de `loja.com/tenis-masculino-corrida`) com um <strong>Prompt de Sistema</strong> extremamente robusto e focado em SEO.
              </p>
              <p className="mt-2 text-sm text-white/60">
                Você tem controlo total sobre este processo! No Workspace, procure por <strong>Personalizar Prompts</strong> na barra lateral esquerda. Lá pode ajustar o tom de voz, adicionar regras para a sua marca, ou mudar completamente o foco das descrições e títulos gerados.
              </p>
            </div>
          </div>
        </GlassCard>
      </div>

      <div className="mt-16 text-center text-sm text-white/40 flex items-center justify-center gap-1.5 pb-8">
        criado por Gabriel Andrade <span className="text-rose-500">❤</span>
      </div>
    </main>
  );
}
