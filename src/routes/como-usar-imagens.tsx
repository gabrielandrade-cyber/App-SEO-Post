import { createFileRoute } from "@tanstack/react-router";
import { UploadCloud, FileArchive, Settings2, ShieldCheck, Tag, Type } from "lucide-react";

export const Route = createFileRoute("/como-usar-imagens")({
  component: ComoUsarImagens,
});

function ComoUsarImagens() {
  return (
    <main className="min-h-screen pt-8 pb-20 px-4">
      <div className="mx-auto max-w-4xl space-y-12">
        <div className="text-center space-y-4">
          <div className="inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-400 to-fuchsia-500 shadow-[0_0_30px_-5px_rgba(168,85,247,0.6)] mb-2">
            <Settings2 className="h-8 w-8 text-white" />
          </div>
          <h1 className="text-4xl font-extrabold tracking-tight text-white sm:text-5xl">
            Como usar o Image Optimizer
          </h1>
          <p className="mx-auto max-w-2xl text-lg text-white/60">
            Aprenda a transformar as suas imagens pesadas em WebP otimizados, utilizando a Visão da Inteligência Artificial para gerar Nomes de Ficheiro e Alt Texts de alta conversão.
          </p>
        </div>

        <div className="space-y-8">
          {/* Passo 1 */}
          <div className="group relative overflow-hidden rounded-3xl border border-white/10 bg-white/5 p-8 transition-all hover:bg-white/10">
            <div className="absolute -right-20 -top-20 h-64 w-64 rounded-full bg-indigo-500/10 blur-3xl transition-all group-hover:bg-indigo-500/20" />
            <div className="relative z-10 space-y-6">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-500/20 text-indigo-300">
                <UploadCloud className="h-6 w-6" />
              </div>
              <div>
                <h3 className="text-xl font-bold text-white mb-2">1. Arraste as suas imagens (PNG ou JPG)</h3>
                <p className="text-white/60 leading-relaxed">
                  Na aba <b>Workspace</b>, arraste as suas imagens ou clique na área de upload. A nossa tecnologia <b>converte automaticamente e instantaneamente as imagens para WebP no seu navegador</b>. Este processo é super rápido e nenhuma imagem pesada é enviada para servidores de terceiros, garantindo máxima privacidade e velocidade.
                </p>
              </div>
            </div>
          </div>

          {/* Passo 2 */}
          <div className="group relative overflow-hidden rounded-3xl border border-white/10 bg-white/5 p-8 transition-all hover:bg-white/10">
            <div className="absolute -right-20 -top-20 h-64 w-64 rounded-full bg-fuchsia-500/10 blur-3xl transition-all group-hover:bg-fuchsia-500/20" />
            <div className="relative z-10 space-y-6">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-fuchsia-500/20 text-fuchsia-300">
                <ShieldCheck className="h-6 w-6" />
              </div>
              <div>
                <h3 className="text-xl font-bold text-white mb-2">2. Valide as Configurações de IA</h3>
                <p className="text-white/60 leading-relaxed">
                  Para utilizar a Inteligência Artificial nas imagens, certifique-se que adicionou a chave do <b>Google Gemini</b> ou <b>Groq</b> na aba de opções. 
                  <br/><br/>
                  <span className="text-amber-400">Nota Importante:</span> O modelo <b>Cerebras</b> (disponível no Otimizador de SERP) não possui olhos virtuais (modelos multimodais). Se tiver o Cerebras ativado, a ferramenta de Imagens irá utilizar o Gemini automaticamente por segurança.
                </p>
              </div>
            </div>
          </div>

          {/* Passo 3 */}
          <div className="grid gap-8 md:grid-cols-2">
            <div className="group relative overflow-hidden rounded-3xl border border-white/10 bg-white/5 p-8 transition-all hover:bg-white/10">
              <div className="relative z-10 space-y-6">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500/20 text-emerald-300">
                  <Tag className="h-6 w-6" />
                </div>
                <div>
                  <h3 className="text-xl font-bold text-white mb-2">3. Otimizar Nomes</h3>
                  <p className="text-white/60 leading-relaxed text-sm">
                    Clique em <b>Otimizar Nome</b>. A IA vai "olhar" para a sua imagem e gerar um nome de ficheiro minúsculo, separado por hifens (ex: <i>sapato-pele-castanho.webp</i>), perfeito para os crawlers da Google.
                  </p>
                </div>
              </div>
            </div>

            <div className="group relative overflow-hidden rounded-3xl border border-white/10 bg-white/5 p-8 transition-all hover:bg-white/10">
              <div className="relative z-10 space-y-6">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-cyan-500/20 text-cyan-300">
                  <Type className="h-6 w-6" />
                </div>
                <div>
                  <h3 className="text-xl font-bold text-white mb-2">4. Gerar Alt Text</h3>
                  <p className="text-white/60 leading-relaxed text-sm">
                    O <b>Alt Text</b> é crucial para Acessibilidade e SEO. Clique no botão e a IA criará uma descrição concisa (máximo de 120 caracteres) detalhando o conteúdo visual da imagem. Pode copiar o texto com um único clique!
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Passo 4 */}
          <div className="group relative overflow-hidden rounded-3xl border border-white/10 bg-white/5 p-8 transition-all hover:bg-white/10">
            <div className="absolute -left-20 -top-20 h-64 w-64 rounded-full bg-emerald-500/10 blur-3xl transition-all group-hover:bg-emerald-500/20" />
            <div className="relative z-10 space-y-6">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500/20 text-emerald-300">
                <FileArchive className="h-6 w-6" />
              </div>
              <div>
                <h3 className="text-xl font-bold text-white mb-2">5. Exportação Global (ZIP)</h3>
                <p className="text-white/60 leading-relaxed">
                  Quando terminar de otimizar os nomes e os tamanhos (se quiser usar o botão Compressão Max), basta clicar no botão <b>Descarregar (ZIP)</b> no topo da lista. A aplicação irá compilar nativamente todas as imagens WebP num único pacote pronto a importar para o seu CMS (WordPress, Shopify, etc).
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
