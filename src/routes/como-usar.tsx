import { createFileRoute } from "@tanstack/react-router";
import {
  Key,
  FileSpreadsheet,
  Bot,
  Download,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  Sparkles,
  Settings2,
} from "lucide-react";
import { GlassCard, GlowOrb } from "@/components/ui/glass";
import { AI_PROVIDERS, PROVIDER_META, SERP_LIMITS } from "@/lib/providers";

export const Route = createFileRoute("/como-usar")({
  head: () => ({
    meta: [
      { title: "Como usar o SERP Optimizer | OPTMOS" },
      {
        name: "description",
        content:
          "Passo a passo do SERP Optimizer: gerar a chave de IA, preparar o CSV de URLs, rodar a fila e exportar o CSV de controle.",
      },
    ],
  }),
  component: ComoUsar,
});

const PROVIDER_ACCENT = {
  openai: "text-emerald-400 hover:text-emerald-300",
  gemini: "text-sky-400 hover:text-sky-300",
  groq: "text-amber-400 hover:text-amber-300",
  cerebras: "text-indigo-400 hover:text-indigo-300",
} as const;

function ComoUsar() {
  return (
    <main className="px-4 pb-20 pt-8">
      <div className="mx-auto max-w-4xl space-y-12">
        <div className="space-y-4 text-center">
          <div className="mb-2 inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-400 to-fuchsia-500 shadow-[0_0_30px_-5px_rgba(168,85,247,0.6)]">
            <Bot className="h-8 w-8 text-white" />
          </div>
          <h1 className="text-4xl font-extrabold tracking-tight text-white sm:text-5xl">
            Como usar o SERP Optimizer
          </h1>
          <p className="mx-auto max-w-2xl text-lg text-white/60">
            Um guia rapido para gerar meta titles e descriptions em lote, com a sua propria chave de
            IA (Bring Your Own Key).
          </p>
        </div>

        <div className="space-y-8">
          <GlassCard className="group overflow-hidden p-8" distort>
            <GlowOrb color="indigo" className="-right-20 -top-20" />
            <div className="relative z-10 space-y-6">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-500/20 text-indigo-300">
                <Key className="h-6 w-6" />
              </div>
              <div>
                <h3 className="mb-2 text-xl font-bold text-white">1. Gerar a sua API Key</h3>
                <p className="mb-6 leading-relaxed text-white/60">
                  O OPTMOS nao cobra nada: voce usa a chave do provedor que escolher. Gemini, Groq e
                  Cerebras tem free tier; o ChatGPT (OpenAI) precisa de creditos, mas e o mais
                  rapido e consistente para lotes grandes.
                </p>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  {AI_PROVIDERS.map((id) => {
                    const meta = PROVIDER_META[id];
                    return (
                      <div
                        key={id}
                        className="rounded-2xl border border-white/5 bg-white/[0.02] p-4 transition-colors hover:bg-white/[0.04]"
                      >
                        <h4 className="mb-1 text-sm font-semibold text-white/80">
                          {meta.label}
                          {id === "openai" && <span className="text-white/40"> (recomendado)</span>}
                        </h4>
                        <p className="mb-2 text-[11px] text-white/50">{meta.hint}</p>
                        <p className="mb-3 font-mono text-[10px] text-white/35">{meta.textModel}</p>
                        <a
                          href={meta.keyUrl}
                          target="_blank"
                          rel="noreferrer"
                          className={`inline-flex items-center gap-1.5 text-[11px] font-medium ${PROVIDER_ACCENT[id]}`}
                        >
                          Gerar chave {meta.label} <ArrowRight className="h-3 w-3" />
                        </a>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </GlassCard>

          <GlassCard className="group overflow-hidden p-8">
            <GlowOrb color="emerald" className="-left-20 -top-20" />
            <div className="relative z-10 space-y-6">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500/20 text-emerald-300">
                <FileSpreadsheet className="h-6 w-6" />
              </div>
              <div>
                <h3 className="mb-2 text-xl font-bold text-white">2. Preparar o CSV</h3>
                <p className="mb-6 leading-relaxed text-white/60">
                  O app precisa de uma lista de URLs. Se a primeira linha for um cabecalho, as
                  colunas sao reconhecidas pelo nome (URL ou Address, Title ou Title 1, Description
                  ou Meta Description 1, tambem em portugues), entao o export "Internal - All" do
                  Screaming Frog entra direto. Sem cabecalho, vale a posicao: 1a coluna URL, 2a
                  title atual, 3a description atual.
                </p>

                <div className="rounded-2xl border border-white/10 bg-black/20 p-4 font-mono text-[11px] text-white/70">
                  <div className="mb-2 flex gap-4 border-b border-white/10 pb-2 text-white/40">
                    <span className="w-1/3">URL</span>
                    <span className="w-1/3">Title (opcional)</span>
                    <span className="w-1/3">Description (opcional)</span>
                  </div>
                  <div className="flex gap-4">
                    <span className="w-1/3 text-emerald-400">https://loja.com/tenis-corrida</span>
                    <span className="w-1/3 truncate">Tenis de corrida</span>
                    <span className="w-1/3 truncate">Compre tenis de corrida...</span>
                  </div>
                  <div className="mt-2 flex gap-4">
                    <span className="w-1/3 text-emerald-400">https://loja.com/tenis-casual</span>
                    <span className="w-1/3 truncate"></span>
                    <span className="w-1/3 truncate"></span>
                  </div>
                </div>
                <div className="mt-4 flex items-start gap-3 rounded-xl border border-indigo-500/20 bg-indigo-500/10 p-4">
                  <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-indigo-400" />
                  <p className="text-sm text-white/70">
                    So a URL e obrigatoria. Title e description atuais melhoram as justificativas,
                    porque a IA compara o antes e o depois. Colunas extras do cabecalho sao
                    ignoradas. Arquivos grandes (dezenas de milhares de linhas) sao lidos em blocos
                    e ficam no IndexedDB do seu navegador.
                  </p>
                </div>
              </div>
            </div>
          </GlassCard>

          <GlassCard className="group overflow-hidden p-8">
            <GlowOrb color="fuchsia" className="-right-20 -bottom-20" />
            <div className="relative z-10 space-y-6">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-fuchsia-500/20 text-fuchsia-300">
                <Settings2 className="h-6 w-6" />
              </div>
              <div>
                <h3 className="mb-2 text-xl font-bold text-white">3. Tom de voz da marca</h3>
                <p className="mb-4 leading-relaxed text-white/60">
                  No Workspace, o card <b>2. Tom de voz da marca</b> guarda as diretrizes que a IA
                  le antes de escrever cada linha: nome da marca (para nunca usar no title), o que
                  ela vende, quem e a persona, como a marca fala e como nao fala, palavras que usa e
                  evita, diferenciais que podem entrar na description. A IA explica na justificativa
                  de cada description como aplicou o tom.
                </p>
                <p className="text-sm leading-relaxed text-white/60">
                  O que o tom de voz <b>nao</b> muda: as faixas de caracteres (title de{" "}
                  {SERP_LIMITS.title.min} a {SERP_LIMITS.title.max}, description de{" "}
                  {SERP_LIMITS.description.min} a {SERP_LIMITS.description.max}, contando espacos),
                  a abertura no imperativo, o CTA final e a regra de nao citar a marca no title.
                  Essas sao as diretrizes de SERP da liveSEO e valem para todos os projetos.
                </p>
              </div>
            </div>
          </GlassCard>

          <div className="grid gap-8 md:grid-cols-2">
            <GlassCard className="group overflow-hidden p-8">
              <div className="relative z-10 space-y-6">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-fuchsia-500/20 text-fuchsia-300">
                  <Bot className="h-6 w-6" />
                </div>
                <div>
                  <h3 className="mb-2 text-xl font-bold text-white">4. Rodar a fila</h3>
                  <p className="mb-4 text-sm leading-relaxed text-white/60">
                    Escolha o provedor no painel da esquerda, cole a chave e clique em{" "}
                    <b>Iniciar fila</b>. Da para pausar, retomar de onde parou (mesmo depois de
                    fechar o navegador) e reprocessar so as linhas que voltaram com erro.
                  </p>
                  <div className="space-y-3">
                    <div className="flex items-start gap-2 text-sm text-white/80">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                      <span>
                        O icone de varinha em cada linha otimiza <strong>uma URL</strong> por vez.
                      </span>
                    </div>
                    <div className="flex items-start gap-2 text-sm text-white/80">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                      <span>
                        Se a chave for recusada ou a cota acabar, a fila pausa sozinha e avisa o
                        motivo.
                      </span>
                    </div>
                    <div className="flex items-start gap-2 text-sm text-white/80">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                      <span>Os textos gerados podem ser editados direto na tabela.</span>
                    </div>
                  </div>
                </div>
              </div>
            </GlassCard>

            <GlassCard className="group overflow-hidden p-8">
              <GlowOrb color="cyan" className="-right-20 -bottom-20" />
              <div className="relative z-10 space-y-6">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-cyan-500/20 text-cyan-300">
                  <Download className="h-6 w-6" />
                </div>
                <div>
                  <h3 className="mb-2 text-xl font-bold text-white">5. Exportar</h3>
                  <p className="text-sm leading-relaxed text-white/60">
                    <b>Exportar para controle</b> gera o CSV no layout de upload da liveSEO: 7
                    colunas, sem cabecalho, separadas por virgula e em UTF-8 com BOM (abre certo no
                    Excel). Ordem: URL, novo title, nova description, justificativa do title,
                    justificativa da description, title atual e description atual.
                  </p>
                </div>
              </div>
            </GlassCard>
          </div>

          <GlassCard className="group overflow-hidden border-fuchsia-500/20 bg-gradient-to-br from-indigo-500/5 to-fuchsia-500/5 p-8">
            <div className="relative z-10 space-y-6">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-fuchsia-500/20 text-fuchsia-400">
                <Sparkles className="h-6 w-6" />
              </div>
              <div>
                <h3 className="mb-2 text-xl font-bold text-white">
                  Como a IA sabe o que escrever?
                </h3>
                <p className="mb-4 leading-relaxed text-white/60">
                  Ela nao adivinha pelo link. Antes de escrever, o servidor entra em cada URL, le o
                  HTML real da pagina (title, H1, subtitulos, meta description, primeiros paragrafos
                  e o texto do corpo) e manda esse contexto para a IA junto com as regras de SERP e
                  o tom de voz.
                </p>
                <p className="leading-relaxed text-white/60">
                  Depois da primeira resposta, os textos fora da faixa de caracteres voltam para a
                  IA numa rodada de ajuste. Mesmo assim, confira o contador de cada celula: verde
                  esta na faixa, ambar esta perto, vermelho passou.
                </p>
              </div>
            </div>
          </GlassCard>
        </div>

        <div className="mt-16 flex items-center justify-center gap-1.5 pb-8 text-center text-sm text-white/40">
          criado por Gabriel Andrade <span className="text-rose-500">&hearts;</span>
        </div>
      </div>
    </main>
  );
}
