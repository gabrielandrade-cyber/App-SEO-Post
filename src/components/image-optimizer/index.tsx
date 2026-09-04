import {
  ImageIcon,
  AlertCircle,
  Lock,
  UploadCloud,
  FileArchive,
  Loader2,
  Tag,
  Type,
  Minimize2,
  CheckCircle2,
  Copy,
  X,
} from "lucide-react";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import JSZip from "jszip";
import { toast } from "sonner";
import { GlassCard } from "@/components/ui/glass";
import { PROVIDER_META, VISION_PROVIDERS, type VisionProvider } from "@/lib/providers";
import { getVisionKey, keyFieldFor, useSettings } from "@/lib/store";
import { MAX_VISION_BASE64_BYTES, optimizeVision } from "@/lib/vision";
import { downloadBlob } from "@/components/serp-optimizer/utils";

type ConversionStatus = "converting" | "ready" | "failed";

export interface ProcessedImage {
  id: string;
  originalFile: File;
  originalName: string;
  currentName: string;
  webpBlob: Blob | null;
  webpUrl: string;
  sizeKb: string;
  quality: number;
  maxDimension: number;
  status: ConversionStatus;
  altText: string;
  isLoadingTitle: boolean;
  isLoadingAlt: boolean;
  copied: boolean;
}

const DEFAULT_QUALITY = 0.9;
const MIN_QUALITY = 0.3;
const DEFAULT_MAX_DIMENSION = 2048;
const VISION_TARGET_BYTES = MAX_VISION_BASE64_BYTES - 200 * 1024;
const ALT_TEXT_MAX_CHARS = 125;
const FILE_NAME_MAX_CHARS = 80;

const PROVIDER_ICONS: Record<VisionProvider, string> = {
  gemini: "/google-gemini-icon.webp",
  openai: "/chatgpt.svg",
  groq: "/groq.png",
};

const FILE_NAME_PROMPT =
  "Voce e um especialista em SEO. Olhe para esta imagem e crie um nome de arquivo curto (3 a 6 palavras) em portugues do Brasil, em minusculas, sem acentos, separado por hifens, descrevendo o que aparece na imagem. Retorne APENAS o nome, sem extensao, sem aspas e sem explicacao.";

const ALT_TEXT_PROMPT =
  "Voce e um especialista em SEO e acessibilidade. Escreva um alt text em portugues do Brasil para esta imagem: uma frase objetiva descrevendo o que aparece nela (objeto, cor, contexto), sem comecar com 'imagem de' ou 'foto de', com no maximo 120 caracteres. Retorne APENAS o texto, sem aspas.";

function roundQuality(value: number): number {
  return Math.round(value * 100) / 100;
}

function slugifyFileName(text: string): string {
  const slug = text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\.(webp|jpe?g|png)$/i, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, FILE_NAME_MAX_CHARS)
    .replace(/-+$/g, "");
  return slug || "imagem";
}

function trimAltText(text: string): string {
  const clean = text
    .replace(/["'\n]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (Array.from(clean).length <= ALT_TEXT_MAX_CHARS) return clean;
  const cut = Array.from(clean).slice(0, ALT_TEXT_MAX_CHARS).join("");
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 60 ? cut.slice(0, lastSpace) : cut).replace(/[,;:\s]+$/g, "");
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Nao foi possivel ler a imagem."));
    };
    img.src = url;
  });
}

/**
 * Converte para WebP no navegador, preservando transparencia e limitando a
 * maior dimensao a `maxDimension` (peso de LCP vem de pixels, nao so de bytes).
 */
async function convertToWebp(file: File, quality: number, maxDimension: number): Promise<Blob> {
  const img = await loadImage(file);
  const scale = Math.min(1, maxDimension / Math.max(img.width, img.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(img.width * scale));
  canvas.height = Math.max(1, Math.round(img.height * scale));

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas nao suportado neste navegador.");
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob && blob.type === "image/webp") resolve(blob);
        else reject(new Error("Este navegador nao consegue gerar WebP."));
      },
      "image/webp",
      quality,
    );
  });
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Falha ao ler a imagem."));
    reader.onabort = () => reject(new Error("Leitura da imagem interrompida."));
    reader.readAsDataURL(blob);
  });
}

/**
 * Prepara o base64 para a API de visao: parte do WebP ja convertido e so
 * recomprime (reduzindo qualidade e depois dimensao) se passar do limite.
 */
async function prepareForVision(image: ProcessedImage): Promise<string> {
  let blob =
    image.webpBlob ?? (await convertToWebp(image.originalFile, image.quality, image.maxDimension));
  let base64 = await blobToBase64(blob);
  let quality = image.quality;
  let maxDimension = image.maxDimension;

  while (base64.length > VISION_TARGET_BYTES) {
    if (quality > MIN_QUALITY) {
      quality = roundQuality(Math.max(MIN_QUALITY, quality - 0.15));
    } else if (maxDimension > 800) {
      maxDimension = Math.round(maxDimension * 0.75);
    } else {
      throw new Error("Nao foi possivel reduzir a imagem para o limite da API de visao.");
    }
    blob = await convertToWebp(image.originalFile, quality, maxDimension);
    base64 = await blobToBase64(blob);
  }

  return base64;
}

function uniqueFileName(name: string, used: Set<string>): string {
  if (!used.has(name)) {
    used.add(name);
    return name;
  }
  const base = name.replace(/\.webp$/i, "");
  let index = 2;
  while (used.has(`${base}-${index}.webp`)) index += 1;
  const unique = `${base}-${index}.webp`;
  used.add(unique);
  return unique;
}

export function ImageOptimizer() {
  const { settings, dispatch, hydrated } = useSettings();
  const [images, setImages] = useState<ProcessedImage[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const imagesRef = useRef(images);
  imagesRef.current = images;
  const conversionsRef = useRef(new Map<string, Promise<void>>());

  const visionProvider = settings.visionProvider;
  const visionMeta = PROVIDER_META[visionProvider];
  const visionKey = getVisionKey(settings);
  const visionKeyField = keyFieldFor(visionProvider);

  // Libera todas as object URLs ao sair da tela.
  useEffect(() => {
    return () => {
      for (const image of imagesRef.current) URL.revokeObjectURL(image.webpUrl);
    };
  }, []);

  const patchImage = useCallback(
    (
      id: string,
      patch: Partial<ProcessedImage> | ((img: ProcessedImage) => Partial<ProcessedImage>),
    ) => {
      setImages((prev) =>
        prev.map((img) =>
          img.id === id ? { ...img, ...(typeof patch === "function" ? patch(img) : patch) } : img,
        ),
      );
    },
    [],
  );

  const swapBlob = useCallback((id: string, blob: Blob, quality: number, maxDimension: number) => {
    setImages((prev) =>
      prev.map((img) => {
        if (img.id !== id) return img;
        URL.revokeObjectURL(img.webpUrl);
        return {
          ...img,
          webpBlob: blob,
          webpUrl: URL.createObjectURL(blob),
          sizeKb: (blob.size / 1024).toFixed(1),
          quality,
          maxDimension,
          status: "ready",
        };
      }),
    );
  }, []);

  const processFiles = useCallback(
    (files: File[]) => {
      const validFiles = files.filter((file) => /^image\/(png|jpe?g|webp)$/i.test(file.type));
      if (validFiles.length < files.length) {
        toast.error("Alguns arquivos foram ignorados: envie PNG, JPG ou WebP.");
      }
      if (validFiles.length === 0) return;

      const newImages: ProcessedImage[] = validFiles.map((file) => {
        const baseName = file.name.replace(/\.[^/.]+$/, "") || file.name;
        return {
          id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`,
          originalFile: file,
          originalName: file.name,
          currentName: `${slugifyFileName(baseName)}.webp`,
          webpBlob: null,
          webpUrl: URL.createObjectURL(file),
          sizeKb: (file.size / 1024).toFixed(1),
          quality: DEFAULT_QUALITY,
          maxDimension: DEFAULT_MAX_DIMENSION,
          status: "converting",
          altText: "",
          isLoadingTitle: false,
          isLoadingAlt: false,
          copied: false,
        };
      });

      setImages((prev) => [...prev, ...newImages]);
      toast.success(
        `${newImages.length} imagem${newImages.length > 1 ? "s" : ""} carregada${newImages.length > 1 ? "s" : ""}. Convertendo para WebP...`,
      );

      for (const img of newImages) {
        const conversion = convertToWebp(img.originalFile, DEFAULT_QUALITY, DEFAULT_MAX_DIMENSION)
          .then((blob) => swapBlob(img.id, blob, DEFAULT_QUALITY, DEFAULT_MAX_DIMENSION))
          .catch((err) => {
            patchImage(img.id, { status: "failed" });
            toast.error(`Falha ao converter ${img.originalName}`, {
              description: err instanceof Error ? err.message : "Erro no canvas.",
            });
          })
          .finally(() => conversionsRef.current.delete(img.id));
        conversionsRef.current.set(img.id, conversion);
      }
    },
    [patchImage, swapBlob],
  );

  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault();
    setIsDragging(false);
    if (event.dataTransfer.files?.length) processFiles(Array.from(event.dataTransfer.files));
  };

  const handleCompressMore = async (id: string) => {
    const target = images.find((img) => img.id === id);
    if (!target) return;

    const nextQuality = roundQuality(Math.max(MIN_QUALITY, target.quality - 0.2));
    if (nextQuality === target.quality) {
      toast.message("Ja esta na compressao maxima.");
      return;
    }

    try {
      const blob = await convertToWebp(target.originalFile, nextQuality, target.maxDimension);
      swapBlob(id, blob, nextQuality, target.maxDimension);
      toast.success(`Recomprimida em qualidade ${Math.round(nextQuality * 100)}%.`);
    } catch (err) {
      toast.error("Erro ao comprimir a imagem.", {
        description: err instanceof Error ? err.message : undefined,
      });
    }
  };

  const callVisionServer = async (id: string, kind: "name" | "alt") => {
    const target = images.find((img) => img.id === id);
    if (!target) return;

    if (!hydrated) {
      toast.message("Um instante", { description: "Carregando as configuracoes salvas." });
      return;
    }
    if (!visionKey) {
      toast.error(`Cole a chave ${visionMeta.label} no painel acima antes de usar a IA.`);
      return;
    }
    if (target.status === "failed") {
      toast.error("Esta imagem nao pode ser convertida, entao nao da para envia-la a IA.");
      return;
    }

    const loadingField = kind === "name" ? "isLoadingTitle" : "isLoadingAlt";
    patchImage(id, { [loadingField]: true });

    try {
      await conversionsRef.current.get(id);
      const latest = imagesRef.current.find((img) => img.id === id) ?? target;
      const base64Image = await prepareForVision(latest);

      const response = await optimizeVision({
        data: {
          base64Image,
          prompt: kind === "name" ? FILE_NAME_PROMPT : ALT_TEXT_PROMPT,
          provider: visionProvider,
          apiKey: visionKey,
        },
      });

      if (!response.success || !response.text) throw new Error("A IA devolveu uma resposta vazia.");

      if (kind === "name") {
        patchImage(id, {
          currentName: `${slugifyFileName(response.text)}.webp`,
          isLoadingTitle: false,
        });
        toast.success("Nome otimizado.");
      } else {
        patchImage(id, { altText: trimAltText(response.text), isLoadingAlt: false });
        toast.success("Alt text gerado.");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha na comunicacao com a IA.");
      patchImage(id, { [loadingField]: false });
    }
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard
      .writeText(text)
      .then(() => {
        patchImage(id, { copied: true });
        toast.success("Copiado.");
        window.setTimeout(() => patchImage(id, { copied: false }), 2000);
      })
      .catch(() => toast.error("Nao foi possivel copiar."));
  };

  const handleDownloadZip = async () => {
    if (images.length === 0) {
      toast.error("Nao ha imagens para baixar.");
      return;
    }

    await Promise.all(conversionsRef.current.values());
    const current = imagesRef.current;
    const ready = current.filter(
      (img) => img.status === "ready" && img.webpBlob?.type === "image/webp",
    );
    const skipped = current.length - ready.length;

    if (ready.length === 0) {
      toast.error("Nenhuma imagem convertida para WebP ainda.");
      return;
    }

    const zip = new JSZip();
    const used = new Set<string>();
    for (const img of ready) zip.file(uniqueFileName(img.currentName, used), img.webpBlob!);

    try {
      const content = await zip.generateAsync({ type: "blob" });
      downloadBlob(content, "imagens_seo_webp.zip");
      toast.success(`Download iniciado: ${ready.length} imagem${ready.length > 1 ? "s" : ""}.`, {
        description:
          skipped > 0 ? `${skipped} imagem(ns) ficaram de fora por falha na conversao.` : undefined,
      });
    } catch {
      toast.error("Ocorreu um erro ao criar o ZIP.");
    }
  };

  const removeImage = (id: string) => {
    setImages((prev) => {
      const removed = prev.find((img) => img.id === id);
      if (removed) URL.revokeObjectURL(removed.webpUrl);
      return prev.filter((img) => img.id !== id);
    });
  };

  return (
    <main className="px-4 pb-20 pt-8">
      <div className="mx-auto max-w-5xl space-y-8">
        <div className="space-y-3 text-center">
          <div className="mb-2 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-400 to-fuchsia-500 shadow-[0_0_30px_-5px_rgba(168,85,247,0.6)]">
            <ImageIcon className="h-6 w-6 text-white" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-white">Hub de otimizacao visual</h1>
          <p className="mx-auto max-w-xl text-sm text-white/50">
            Arraste imagens JPG, PNG ou WebP: a conversao para WebP acontece no seu navegador, com
            transparencia preservada e no maximo 2048 px. A IA de visao gera <b>nomes de arquivo</b>{" "}
            e <b>alt texts</b> otimizados para SEO.
          </p>
        </div>

        <GlassCard
          className="flex flex-col items-start gap-6 p-5 sm:flex-row sm:items-center"
          distort
        >
          <div className="shrink-0">
            <h2 className="mb-3 text-sm font-semibold text-white/90">IA de visao</h2>
            <div className="flex items-center gap-2">
              {VISION_PROVIDERS.map((id) => {
                const meta = PROVIDER_META[id];
                const active = visionProvider === id;
                return (
                  <button
                    key={id}
                    type="button"
                    title={`${meta.label}: ${meta.visionModel}`}
                    onClick={() => dispatch({ type: "SET_VISION_PROVIDER", payload: id })}
                    className={`group relative flex items-center gap-2 rounded-2xl border p-2 text-xs transition-all duration-300 ${
                      active
                        ? "border-white/30 bg-white/10 shadow-[0_0_20px_-5px_rgba(255,255,255,0.3)]"
                        : "border-white/10 bg-white/[0.03] hover:bg-white/[0.07]"
                    }`}
                  >
                    <div className="flex h-6 w-6 items-center justify-center rounded-lg border border-white/10 bg-gradient-to-br from-slate-800 to-slate-900 shadow-inner">
                      <img
                        src={PROVIDER_ICONS[id]}
                        alt=""
                        className="h-4 w-4 object-contain drop-shadow-sm"
                      />
                    </div>
                    <span className="pr-2 font-medium text-white/90">{meta.label}</span>
                  </button>
                );
              })}
            </div>
            <p className="mt-2 font-mono text-[10px] text-white/35">
              modelo: {visionMeta.visionModel}
            </p>
          </div>

          <div className="w-full flex-1 border-t border-white/5 pt-4 sm:border-l sm:border-t-0 sm:pl-6 sm:pt-0">
            <label className="mb-1.5 block text-xs font-medium text-white/70">
              Chave {visionMeta.label}
              <span className="text-white/40"> (a mesma usada no SERP Optimizer)</span>
            </label>
            <div className="relative">
              <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
              <input
                type="password"
                autoComplete="off"
                value={settings[visionKeyField]}
                onChange={(event) =>
                  dispatch({
                    type: "SET_SECRET",
                    field: visionKeyField,
                    payload: event.target.value.trim(),
                  })
                }
                placeholder={hydrated ? visionMeta.keyPlaceholder : "Carregando..."}
                className="w-full rounded-2xl border border-white/10 bg-white/5 py-2 pl-10 pr-3 text-sm text-white outline-none backdrop-blur-xl transition-all duration-300 placeholder:text-white/30 focus:border-white/30 focus:bg-white/10"
              />
            </div>
            <div className="mt-3 flex items-start gap-2 text-[11px] leading-relaxed text-white/45">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300/80" />
              <span>
                A conversao para WebP e 100% local. So os botoes de IA enviam a imagem (ja
                comprimida) para o provedor escolhido, com a sua chave.
              </span>
            </div>
          </div>
        </GlassCard>

        <label
          onDragOver={(event) => {
            event.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          className={`relative block cursor-pointer overflow-hidden rounded-[32px] border-2 border-dashed p-12 text-center transition-all duration-300 ${
            isDragging
              ? "border-fuchsia-400 bg-fuchsia-400/10"
              : "border-white/10 bg-white/[0.02] hover:bg-white/[0.04]"
          }`}
        >
          <div className="flex flex-col items-center justify-center space-y-4">
            <div className="rounded-full bg-white/5 p-4 shadow-inner">
              <UploadCloud
                className={`h-8 w-8 transition-colors ${isDragging ? "text-fuchsia-400" : "text-white/40"}`}
              />
            </div>
            <div>
              <p className="text-sm font-medium text-white/90">
                Arraste as suas imagens ou clique para procurar
              </p>
              <p className="mt-1 text-xs text-white/40">
                JPG, PNG e WebP. Conversao automatica no navegador.
              </p>
            </div>
          </div>
          <input
            type="file"
            multiple
            accept="image/png, image/jpeg, image/jpg, image/webp"
            className="hidden"
            onChange={(event) => {
              if (event.target.files) processFiles(Array.from(event.target.files));
              event.target.value = "";
            }}
          />
        </label>

        {images.length > 0 && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-lg font-semibold text-white/90">
                Imagens{" "}
                <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs">
                  {images.length}
                </span>
              </h2>
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={handleDownloadZip}
                className="flex items-center gap-2 rounded-full bg-gradient-to-r from-emerald-400 to-teal-500 px-4 py-2 text-sm font-semibold text-slate-950 shadow-[0_0_20px_-5px_rgba(52,211,153,0.5)]"
              >
                <FileArchive className="h-4 w-4" /> Baixar ZIP
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
                    <GlassCard className="flex flex-col gap-5 p-5 sm:flex-row">
                      <div className="relative h-40 w-full shrink-0 overflow-hidden rounded-2xl bg-black/40 sm:w-40">
                        <img src={img.webpUrl} alt="" className="h-full w-full object-cover" />
                        <button
                          onClick={() => removeImage(img.id)}
                          title="Remover"
                          className="absolute right-2 top-2 rounded-full bg-black/60 p-1.5 text-white/70 backdrop-blur-md transition-colors hover:bg-red-500/80 hover:text-white"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                        <span
                          className={`absolute bottom-2 left-2 rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider backdrop-blur-md ${
                            img.status === "ready"
                              ? "border-emerald-300/30 bg-emerald-400/15 text-emerald-100"
                              : img.status === "failed"
                                ? "border-rose-300/30 bg-rose-400/15 text-rose-100"
                                : "border-indigo-300/30 bg-indigo-400/15 text-indigo-100"
                          }`}
                        >
                          {img.status === "ready"
                            ? "WebP pronto"
                            : img.status === "failed"
                              ? "Falhou"
                              : "Convertendo"}
                        </span>
                      </div>

                      <div className="flex flex-1 flex-col justify-between space-y-4">
                        <div className="flex items-start justify-between gap-4">
                          <div className="space-y-1 overflow-hidden">
                            <p className="text-xs uppercase tracking-wider text-white/40">
                              Nome do arquivo WebP
                            </p>
                            <p
                              className="truncate font-mono text-sm font-medium text-white/90"
                              title={img.currentName}
                            >
                              {img.currentName}
                            </p>
                            <p
                              className="truncate text-[11px] text-white/35"
                              title={img.originalName}
                            >
                              original: {img.originalName}
                            </p>
                          </div>
                          <div className="shrink-0 text-right">
                            <span className="inline-block rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-400">
                              {img.sizeKb} KB
                            </span>
                            <p className="mt-1 text-[10px] text-white/35">
                              qualidade {Math.round(img.quality * 100)}%
                            </p>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          <motion.button
                            whileHover={{ scale: 1.02 }}
                            whileTap={{ scale: 0.98 }}
                            onClick={() => callVisionServer(img.id, "name")}
                            disabled={img.isLoadingTitle || img.status === "failed"}
                            className="flex h-9 items-center gap-2 rounded-xl border border-indigo-500/30 bg-indigo-500/10 px-3 text-xs font-medium text-indigo-300 transition-colors hover:bg-indigo-500/20 disabled:opacity-50"
                          >
                            {img.isLoadingTitle ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Tag className="h-3.5 w-3.5" />
                            )}
                            Otimizar nome
                          </motion.button>

                          <motion.button
                            whileHover={{ scale: 1.02 }}
                            whileTap={{ scale: 0.98 }}
                            onClick={() => callVisionServer(img.id, "alt")}
                            disabled={img.isLoadingAlt || img.status === "failed"}
                            className="flex h-9 items-center gap-2 rounded-xl border border-fuchsia-500/30 bg-fuchsia-500/10 px-3 text-xs font-medium text-fuchsia-300 transition-colors hover:bg-fuchsia-500/20 disabled:opacity-50"
                          >
                            {img.isLoadingAlt ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Type className="h-3.5 w-3.5" />
                            )}
                            Gerar alt text
                          </motion.button>

                          <div className="flex-1" />

                          <button
                            onClick={() => handleCompressMore(img.id)}
                            disabled={img.status !== "ready" || img.quality <= MIN_QUALITY}
                            className="flex h-9 items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 text-xs font-medium text-white/60 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-40"
                          >
                            <Minimize2 className="h-3.5 w-3.5" />
                            Compressao max
                          </button>
                        </div>

                        <AnimatePresence>
                          {img.altText && (
                            <motion.div
                              initial={{ opacity: 0, height: 0 }}
                              animate={{ opacity: 1, height: "auto" }}
                              className="relative overflow-hidden rounded-xl border border-white/5 bg-black/20 p-3"
                            >
                              <p className="mb-1 text-[10px] uppercase tracking-wider text-white/40">
                                Alt text ({Array.from(img.altText).length} caracteres)
                              </p>
                              <p className="pr-8 text-sm text-white/80">{img.altText}</p>
                              <button
                                onClick={() => copyToClipboard(img.altText, img.id)}
                                title="Copiar"
                                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-white/40 transition-colors hover:bg-white/10 hover:text-white"
                              >
                                {img.copied ? (
                                  <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                                ) : (
                                  <Copy className="h-4 w-4" />
                                )}
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
