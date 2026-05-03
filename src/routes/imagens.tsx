import { createFileRoute } from "@tanstack/react-router";
import React, { useState, useRef, useEffect } from "react";
import { UploadCloud, Image as ImageIcon, FileArchive, Copy, Download, Tag, Type, Loader2, CheckCircle2, AlertCircle, Lock } from "lucide-react";
import JSZip from "jszip";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { useSettings } from "../lib/store";
import { optimizeVision } from "../lib/vision";

export const Route = createFileRoute("/imagens")({
  component: ImagensHub,
});

interface ProcessedImage {
  id: string;
  originalFile: File;
  originalName: string;
  currentName: string;
  webpBlob: Blob;
  webpUrl: string;
  sizeKb: string;
  quality: number;
  altText: string;
  isLoadingTitle: boolean;
  isLoadingAlt: boolean;
  copied: boolean;
}

// Reusable Glass Card
function GlassCard({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-3xl border border-white/5 bg-white/[0.02] p-6 shadow-2xl backdrop-blur-2xl ${className}`}>
      {children}
    </div>
  );
}

function ImagensHub() {
  const { settings, dispatch } = useSettings();
  const [images, setImages] = useState<ProcessedImage[]>([]);
  const [isDragging, setIsDragging] = useState(false);

  // Provedores visuais (Oculta Cerebras)
  const allowedProviders = ["gemini", "groq"];
  const currentProvider = allowedProviders.includes(settings.provider) ? settings.provider : "gemini";

  const convertToWebp = (file: File, quality: number = 0.9): Promise<Blob> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);

      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext("2d");
        
        if (!ctx) return reject(new Error("Canvas não suportado."));

        // Preencher o fundo de branco (para PNGs transparentes)
        ctx.fillStyle = "#FFFFFF";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);

        canvas.toBlob(
          (blob) => {
            if (blob) resolve(blob);
            else reject(new Error("Falha ao gerar blob."));
            URL.revokeObjectURL(url);
          },
          "image/webp",
          quality
        );
      };

      img.onerror = () => reject(new Error("Erro ao carregar imagem no canvas."));
      img.src = url;
    });
  };

  const blobToBase64 = (blob: Blob): Promise<string> => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.readAsDataURL(blob);
    });
  };

  // Garante que o Base64 é menor que 3.5MB (limite seguro para Vercel)
  const compressToVercelLimits = async (blob: Blob, file: File, maxMb = 3.5): Promise<{ blob: Blob; base64: string }> => {
    let currentBlob = blob;
    let base64 = await blobToBase64(currentBlob);
    let sizeMb = base64.length / (1024 * 1024);
    let quality = 0.9;

    while (sizeMb > maxMb && quality > 0.1) {
      quality -= 0.15;
      currentBlob = await convertToWebp(file, quality);
      base64 = await blobToBase64(currentBlob);
      sizeMb = base64.length / (1024 * 1024);
    }

    if (sizeMb > maxMb) {
      throw new Error(`Não foi possível comprimir a imagem abaixo de ${maxMb}MB.`);
    }

    return { blob: currentBlob, base64 };
  };

  const processFiles = async (files: File[]) => {
    const validFiles = files.filter(f => f.type.startsWith("image/"));
    if (validFiles.length < files.length) {
      toast.error("Alguns ficheiros foram ignorados por não serem imagens válidas.");
    }

    const newImages: ProcessedImage[] = validFiles.map((file) => {
      const baseName = file.name.substring(0, file.name.lastIndexOf(".")) || file.name;
      return {
        id: Math.random().toString(36).substr(2, 9),
        originalFile: file,
        originalName: file.name,
        currentName: `${baseName.replace(/\s+/g, '-').toLowerCase()}.webp`,
        webpBlob: file, // Temporário: usa o ficheiro original
        webpUrl: URL.createObjectURL(file), // Mostra instantaneamente
        sizeKb: (file.size / 1024).toFixed(2),
        quality: 0.9,
        altText: "",
        isLoadingTitle: false,
        isLoadingAlt: false,
        copied: false,
      };
    });

    if (newImages.length > 0) {
      setImages((prev) => [...prev, ...newImages]);
      toast.success(`${newImages.length} imagens carregadas!`);

      // Conversão WebP em Background silenciosa
      newImages.forEach(async (img) => {
        try {
          const webpBlob = await convertToWebp(img.originalFile, 0.9);
          setImages((prev) =>
            prev.map((p) =>
              p.id === img.id
                ? {
                    ...p,
                    webpBlob,
                    webpUrl: URL.createObjectURL(webpBlob),
                    sizeKb: (webpBlob.size / 1024).toFixed(2),
                  }
                : p
            )
          );
        } catch (error) {
          console.error("Erro no Canvas WebP", error);
          // Falha silenciosa: a imagem continua a ser o ficheiro original no ecrã.
        }
      });
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files?.length) {
      processFiles(Array.from(e.dataTransfer.files));
    }
  };

  const handleCompressMore = async (id: string) => {
    const targetImg = images.find((img) => img.id === id);
    if (!targetImg) return;

    const newQuality = Math.max(0.1, targetImg.quality - 0.2);
    
    try {
      const newWebpBlob = await convertToWebp(targetImg.originalFile, newQuality);
      URL.revokeObjectURL(targetImg.webpUrl); // Limpar memória

      setImages((prev) =>
        prev.map((img) =>
          img.id === id
            ? {
                ...img,
                webpBlob: newWebpBlob,
                webpUrl: URL.createObjectURL(newWebpBlob),
                sizeKb: (newWebpBlob.size / 1024).toFixed(2),
                quality: newQuality,
              }
            : img
        )
      );
      toast.success("Imagem compactada com sucesso!");
    } catch (e) {
      toast.error("Erro ao compactar a imagem.");
    }
  };

  const callVisionServer = async (id: string, prompt: string, isTitle: boolean) => {
    const targetImg = images.find((img) => img.id === id);
    if (!targetImg) return;

    const apiKey = currentProvider === "gemini" ? settings.geminiKey : settings.groqKey;
    if (!apiKey) {
      toast.error(`A API Key do ${currentProvider} não está configurada! Vá ao Workspace configurar.`);
      return;
    }

    setImages((prev) =>
      prev.map((img) =>
        img.id === id ? { ...img, [isTitle ? "isLoadingTitle" : "isLoadingAlt"]: true } : img
      )
    );

    try {
      // 1. Validar e Comprimir Base64 para os limites da Vercel (<3.5MB)
      const { base64 } = await compressToVercelLimits(targetImg.webpBlob, targetImg.originalFile);

      // 2. Chamar Server Function de forma segura
      const response = await (optimizeVision as any)({
        data: {
          base64Image: base64,
          prompt,
          provider: currentProvider as "gemini" | "groq",
          apiKey,
        }
      });

      if (!response.success || !response.text) {
        throw new Error("A IA devolveu uma resposta vazia.");
      }

      const rawText = response.text;

      // 3. Atualizar Estado
      setImages((prev) =>
        prev.map((img) => {
          if (img.id === id) {
            if (isTitle) {
              const cleanTitle = rawText.trim().replace(/[^a-zA-Z0-9-]/g, "-").toLowerCase().replace(/-+/g, '-') + ".webp";
              return { ...img, currentName: cleanTitle, isLoadingTitle: false };
            } else {
              return { ...img, altText: rawText.replace(/["']/g, "").trim(), isLoadingAlt: false };
            }
          }
          return img;
        })
      );
      toast.success(isTitle ? "Nome Otimizado!" : "Alt Text gerado com sucesso!");

    } catch (error: any) {
      console.error(error);
      toast.error(error.message || "Falha na comunicação com a IA.");
      setImages((prev) =>
        prev.map((img) =>
          img.id === id ? { ...img, [isTitle ? "isLoadingTitle" : "isLoadingAlt"]: false } : img
        )
      );
    }
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setImages((prev) => prev.map((img) => (img.id === id ? { ...img, copied: true } : img)));
      toast.success("Copiado para a área de transferência!");
      setTimeout(() => {
        setImages((prev) => prev.map((img) => (img.id === id ? { ...img, copied: false } : img)));
      }, 2000);
    });
  };

  const handleDownloadZip = async () => {
    if (images.length === 0) return toast.error("Não há imagens para descarregar.");

    const zip = new JSZip();
    images.forEach((img) => {
      zip.file(img.currentName, img.webpBlob);
    });

    try {
      const content = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(content);
      const a = document.createElement("a");
      a.href = url;
      a.download = "imagens_seo_webp.zip";
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Download iniciado!");
    } catch (error) {
      toast.error("Ocorreu um erro ao criar o ficheiro ZIP.");
    }
  };

  const removeImage = (id: string) => {
    setImages((prev) => {
      const filtered = prev.filter((img) => img.id !== id);
      const removed = prev.find((img) => img.id === id);
      if (removed) URL.revokeObjectURL(removed.webpUrl);
      return filtered;
    });
  };

  return (
    <main className="min-h-screen pt-8 pb-20 px-4">
      <div className="mx-auto max-w-5xl space-y-8">
        
        <div className="text-center space-y-3">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-400 to-fuchsia-500 shadow-[0_0_30px_-5px_rgba(168,85,247,0.6)] mb-2">
            <ImageIcon className="h-6 w-6 text-white" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-white">Hub de Otimização Visual</h1>
          <p className="text-sm text-white/50 max-w-xl mx-auto">
            Arraste imagens JPG/PNG para convertê-las instantaneamente para WebP. 
            Utilize a visão da IA para gerar <b>Nomes de Ficheiro</b> otimizados e <b>Alt Texts</b> perfeitamente descritivos para SEO.
          </p>
        </div>

        {/* Selector de IA & Alerta de Cerebras */}
        <div className="space-y-4">
          {settings.provider === "cerebras" && (
            <GlassCard className="bg-amber-500/10 border-amber-500/20 py-4">
              <div className="flex items-center gap-3">
                <AlertCircle className="w-5 h-5 text-amber-400 shrink-0" />
                <p className="text-sm text-amber-200/90">
                  O modelo <b>Cerebras</b> não suporta visão. Selecione o Gemini ou Groq abaixo.
                </p>
              </div>
            </GlassCard>
          )}

          <GlassCard className="p-5 flex flex-col sm:flex-row gap-6 items-start sm:items-center">
            <div className="shrink-0">
              <h2 className="mb-3 text-sm font-semibold text-white/90">Selecione a Inteligência Artificial</h2>
              <div className="flex items-center gap-2">
                {[
                  { id: "gemini", label: "Gemini", img: "/google-gemini-icon.webp", color: "from-slate-800 to-slate-900" },
                  { id: "groq", label: "Groq", img: "/groq.png", color: "from-slate-800 to-slate-900" }
                ].map((opt) => {
                  const active = settings.provider === opt.id || (settings.provider === "cerebras" && opt.id === "gemini");
                  return (
                    <button
                      key={opt.id}
                      onClick={() => dispatch({ type: "SET_PROVIDER", payload: opt.id as "gemini" | "groq" })}
                      className={`group relative flex items-center gap-2 rounded-2xl border p-2 text-xs transition-all duration-300 ${
                        active
                          ? "border-white/30 bg-white/10 shadow-[0_0_20px_-5px_rgba(255,255,255,0.3)]"
                          : "border-white/10 bg-white/[0.03] hover:bg-white/[0.07]"
                      }`}
                    >
                      <div className={`flex h-6 w-6 items-center justify-center rounded-lg bg-gradient-to-br ${opt.color} border border-white/10 shadow-inner`}>
                        <img src={opt.img} alt={opt.label} className="h-4 w-4 object-contain drop-shadow-sm" />
                      </div>
                      <span className="font-medium text-white/90 pr-2">{opt.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex-1 w-full border-t border-white/5 pt-4 sm:border-t-0 sm:border-l sm:pl-6 sm:pt-0">
              {currentProvider === "gemini" && (
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-white/70">Chave Gemini (aistudio.google.com)</label>
                  <div className="relative">
                    <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
                    <input type="password" value={settings.geminiKey} onChange={(e) => dispatch({ type: "SET_GEMINI_KEY", payload: e.target.value })} placeholder="AIzaSy•••" className="w-full rounded-2xl border border-white/10 bg-white/5 py-2 pl-10 pr-3 text-sm text-white placeholder:text-white/30 outline-none backdrop-blur-xl transition-all duration-300 focus:border-white/30 focus:bg-white/10" />
                  </div>
                </div>
              )}
              {currentProvider === "groq" && (
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-white/70">Chave Groq (console.groq.com)</label>
                  <div className="relative">
                    <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
                    <input type="password" value={settings.groqKey} onChange={(e) => dispatch({ type: "SET_GROQ_KEY", payload: e.target.value })} placeholder="gsk_•••" className="w-full rounded-2xl border border-white/10 bg-white/5 py-2 pl-10 pr-3 text-sm text-white placeholder:text-white/30 outline-none backdrop-blur-xl transition-all duration-300 focus:border-white/30 focus:bg-white/10" />
                  </div>
                </div>
              )}
            </div>
          </GlassCard>
        </div>

        <label
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          className={`block relative overflow-hidden rounded-[32px] border-2 border-dashed p-12 text-center transition-all duration-300 cursor-pointer ${
            isDragging 
              ? "border-fuchsia-400 bg-fuchsia-400/10" 
              : "border-white/10 bg-white/[0.02] hover:bg-white/[0.04]"
          }`}
        >
          <div className="flex flex-col items-center justify-center space-y-4">
            <div className="rounded-full bg-white/5 p-4 shadow-inner">
              <UploadCloud className={`h-8 w-8 transition-colors ${isDragging ? 'text-fuchsia-400' : 'text-white/40'}`} />
            </div>
            <div>
              <p className="text-sm font-medium text-white/90">
                Arraste as suas imagens ou clique para procurar
              </p>
              <p className="mt-1 text-xs text-white/40">Suporta JPG, PNG. Conversão automática Client-Side (WebP).</p>
            </div>
          </div>
          <input
            type="file"
            multiple
            accept="image/png, image/jpeg, image/jpg, image/webp"
            className="hidden"
            onChange={(e) => {
              if (e.target.files) processFiles(Array.from(e.target.files));
              e.target.value = "";
            }}
          />
        </label>

        {images.length > 0 && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white/90 flex items-center gap-2">
                Imagens Prontas <span className="bg-white/10 px-2 py-0.5 rounded-full text-xs">{images.length}</span>
              </h2>
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={handleDownloadZip}
                className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-400 to-teal-500 px-4 py-2 text-sm font-semibold text-slate-950 shadow-[0_0_20px_-5px_rgba(52,211,153,0.5)] transition-all"
              >
                <FileArchive className="h-4 w-4" /> Descarregar (ZIP)
              </motion.button>
            </div>

            <div className="grid gap-4">
              <AnimatePresence>
                {images.map((img) => (
                  <motion.div
                    key={img.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className="relative"
                  >
                    <GlassCard className="flex flex-col sm:flex-row gap-5 p-5">
                      
                      {/* Image Preview */}
                      <div className="relative h-40 w-full sm:w-40 shrink-0 overflow-hidden rounded-2xl bg-black/40">
                        <img src={img.webpUrl} alt="Preview" className="h-full w-full object-cover" />
                        <button
                          onClick={() => removeImage(img.id)}
                          className="absolute right-2 top-2 rounded-full bg-black/60 p-1.5 text-white/70 backdrop-blur-md hover:bg-red-500/80 hover:text-white transition-colors"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                        </button>
                      </div>

                      {/* Content */}
                      <div className="flex flex-1 flex-col justify-between space-y-4">
                        <div>
                          <div className="flex justify-between items-start gap-4">
                            <div className="space-y-1 overflow-hidden">
                              <p className="text-xs text-white/40 uppercase tracking-wider">Nome do Ficheiro WebP</p>
                              <p className="truncate font-mono text-sm font-medium text-white/90" title={img.currentName}>
                                {img.currentName}
                              </p>
                            </div>
                            <div className="text-right shrink-0">
                              <span className="inline-block rounded-lg bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-400 border border-emerald-500/20">
                                {img.sizeKb} KB
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Actions */}
                        <div className="flex flex-wrap items-center gap-2">
                          <motion.button
                            whileHover={{ scale: 1.02 }}
                            whileTap={{ scale: 0.98 }}
                            onClick={() => callVisionServer(img.id, "Crie um nome curto de ficheiro, separado por hifens, altamente otimizado para SEO baseado nesta imagem. Retorne APENAS o nome sem extensão.", true)}
                            disabled={img.isLoadingTitle}
                            className="flex h-9 items-center gap-2 rounded-xl border border-indigo-500/30 bg-indigo-500/10 px-3 text-xs font-medium text-indigo-300 transition-colors hover:bg-indigo-500/20 disabled:opacity-50"
                          >
                            {img.isLoadingTitle ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Tag className="h-3.5 w-3.5" />}
                            Otimizar Nome
                          </motion.button>

                          <motion.button
                            whileHover={{ scale: 1.02 }}
                            whileTap={{ scale: 0.98 }}
                            onClick={() => callVisionServer(img.id, "Escreva um texto alternativo (alt text) descritivo e otimizado para SEO desta imagem. Máximo 120 caracteres. Apenas o texto.", false)}
                            disabled={img.isLoadingAlt}
                            className="flex h-9 items-center gap-2 rounded-xl border border-fuchsia-500/30 bg-fuchsia-500/10 px-3 text-xs font-medium text-fuchsia-300 transition-colors hover:bg-fuchsia-500/20 disabled:opacity-50"
                          >
                            {img.isLoadingAlt ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Type className="h-3.5 w-3.5" />}
                            Gerar Alt Text
                          </motion.button>

                          <div className="flex-1" />

                          <button
                            onClick={() => handleCompressMore(img.id)}
                            className="flex h-9 items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 text-xs font-medium text-white/60 transition-colors hover:bg-white/10 hover:text-white"
                          >
                            <Download className="h-3.5 w-3.5" />
                            Compressão Max
                          </button>
                        </div>

                        {/* Alt Text Output */}
                        <AnimatePresence>
                          {img.altText && (
                            <motion.div
                              initial={{ opacity: 0, height: 0 }}
                              animate={{ opacity: 1, height: 'auto' }}
                              className="relative overflow-hidden rounded-xl border border-white/5 bg-black/20 p-3"
                            >
                              <p className="text-[10px] uppercase tracking-wider text-white/40 mb-1">Alt Text Gerado</p>
                              <p className="text-sm text-white/80 pr-8">{img.altText}</p>
                              <button
                                onClick={() => copyToClipboard(img.altText, img.id)}
                                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-white/40 hover:bg-white/10 hover:text-white transition-colors"
                              >
                                {img.copied ? <CheckCircle2 className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                              </button>
                            </motion.div>
                          )}
                        </AnimatePresence>

                      </div>
                    </GlassCard>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
