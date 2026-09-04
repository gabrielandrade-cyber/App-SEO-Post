import { createFileRoute } from "@tanstack/react-router";
import { UploadCloud, FileArchive, Settings2, ShieldCheck, Tag, Type } from "lucide-react";
import { GlassCard, GlowOrb } from "@/components/ui/glass";
import { PROVIDER_META } from "@/lib/providers";

export const Route = createFileRoute("/como-usar-imagens")({
  head: () => ({
    meta: [
      { title: "Como usar o Image Optimizer | OPTMOS" },
      {
        name: "description",
        content:
          "Passo a passo do Image Optimizer: converter imagens para WebP no navegador e gerar nomes de arquivo e alt texts com IA de visao.",
      },
    ],
  }),
  component: ComoUsarImagens,
});

function ComoUsarImagens() {
  return (
    <main className="px-4 pb-20 pt-8">
      <div className="mx-auto max-w-4xl space-y-12">
        <div className="space-y-4 text-center">
          <div className="mb-2 inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-400 to-fuchsia-500 shadow-[0_0_30px_-5px_rgba(168,85,247,0.6)]">
            <Settings2 className="h-8 w-8 text-white" />
          </div>
          <h1 className="text-4xl font-extrabold tracking-tight text-white sm:text-5xl">
            Como usar o Image Optimizer
          </h1>
          <p className="mx-auto max-w-2xl text-lg text-white/60">
            Transforme imagens pesadas em WebP e use a visao da IA para gerar nomes de arquivo e alt
            texts descritivos.
          </p>
        </div>

        <div className="space-y-8">
          <GlassCard className="group overflow-hidden p-8" distort>
            <GlowOrb color="indigo" className="-right-20 -top-20" />
            <div className="relative z-10 space-y-6">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-500/20 text-indigo-300">
                <UploadCloud className="h-6 w-6" />
              </div>
              <div>
                <h3 className="mb-2 text-xl font-bold text-white">
                  1. Arraste as imagens (PNG, JPG ou WebP)
                </h3>
                <p className="leading-relaxed text-white/60">
                  No <b>Workspace</b>, arraste as imagens ou clique na area de upload. A conversao
                  para WebP acontece <b>no seu navegador</b>, sem upload: a transparencia de PNG e
                  preservada e a maior dimensao e limitada a 2048 px, o que ja resolve a maior parte
                  do peso em fotos de celular. Nada sai do computador nessa etapa.
                </p>
              </div>
            </div>
          </GlassCard>

          <GlassCard className="group overflow-hidden p-8">
            <GlowOrb color="fuchsia" className="-right-20 -top-20" />
            <div className="relative z-10 space-y-6">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-fuchsia-500/20 text-fuchsia-300">
                <ShieldCheck className="h-6 w-6" />
              </div>
              <div>
                <h3 className="mb-2 text-xl font-bold text-white">2. Escolha a IA de visao</h3>
                <p className="leading-relaxed text-white/60">
                  A IA de visao e uma escolha separada da IA do SERP Optimizer, entao trocar aqui
                  nao mexe na fila de SERP. Opcoes: <b>Gemini</b> (
                  {PROVIDER_META.gemini.visionModel}), <b>ChatGPT</b> (
                  {PROVIDER_META.openai.visionModel}) e <b>Groq</b> (
                  {PROVIDER_META.groq.visionModel}). A chave e a mesma que voce ja usa para esse
                  provedor.
                  <br />
                  <br />
                  <span className="text-amber-400">Privacidade:</span> os botoes{" "}
                  <b>Otimizar nome</b> e <b>Gerar alt text</b> enviam a imagem (ja convertida e
                  comprimida, no maximo 4 MB) para a API do provedor escolhido, com a sua chave. Se
                  o material for confidencial, use so a conversao para WebP.
                </p>
              </div>
            </div>
          </GlassCard>

          <div className="grid gap-8 md:grid-cols-2">
            <GlassCard className="group overflow-hidden p-8">
              <div className="relative z-10 space-y-6">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500/20 text-emerald-300">
                  <Tag className="h-6 w-6" />
                </div>
                <div>
                  <h3 className="mb-2 text-xl font-bold text-white">3. Otimizar nome</h3>
                  <p className="text-sm leading-relaxed text-white/60">
                    A IA olha para a imagem e sugere um nome de arquivo em minusculas, sem acentos e
                    separado por hifens (ex.: <i>sapato-couro-marrom.webp</i>). O nome passa por uma
                    limpeza final, entao nunca sai com hifen sobrando nem caractere invalido.
                  </p>
                </div>
              </div>
            </GlassCard>

            <GlassCard className="group overflow-hidden p-8">
              <div className="relative z-10 space-y-6">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-cyan-500/20 text-cyan-300">
                  <Type className="h-6 w-6" />
                </div>
                <div>
                  <h3 className="mb-2 text-xl font-bold text-white">4. Gerar alt text</h3>
                  <p className="text-sm leading-relaxed text-white/60">
                    O alt text e essencial para acessibilidade e SEO. A IA escreve uma descricao
                    objetiva do que aparece na imagem, limitada a 125 caracteres (o app corta o
                    excedente na ultima palavra inteira). Copie com um clique.
                  </p>
                </div>
              </div>
            </GlassCard>
          </div>

          <GlassCard className="group overflow-hidden p-8">
            <GlowOrb color="emerald" className="-left-20 -top-20" />
            <div className="relative z-10 space-y-6">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500/20 text-emerald-300">
                <FileArchive className="h-6 w-6" />
              </div>
              <div>
                <h3 className="mb-2 text-xl font-bold text-white">5. Baixar o ZIP</h3>
                <p className="leading-relaxed text-white/60">
                  Quando terminar (use <b>Compressao max</b> se precisar de arquivos menores),
                  clique em <b>Baixar ZIP</b>. So entram no pacote as imagens ja convertidas para
                  WebP; nomes repetidos ganham um sufixo numerico para nada ser sobrescrito. O ZIP e
                  montado no navegador e fica pronto para subir no CMS (WordPress, Shopify,
                  VTEX...).
                </p>
              </div>
            </div>
          </GlassCard>
        </div>
      </div>
    </main>
  );
}
