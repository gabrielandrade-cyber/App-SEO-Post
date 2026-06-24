import { createFileRoute } from "@tanstack/react-router";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  Check,
  Download,
  Inbox,
  Loader2,
  Lock,
  Pause,
  Play,
  Settings2,
  Sparkles,
  Upload,
  Wand2,
  X,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useBatchQueue } from "@/hooks/use-batch-queue";
import {
  clearCsvData,
  getAllCsvRows,
  getCsvMeta,
  getCsvRow,
  getRowsWindow,
  updateCsvRows,
} from "@/lib/db";
import { importCSVToIndexedDB } from "@/lib/csv-parser";
import { getActiveKey, useSettings, type AIProvider, type CsvRow } from "@/lib/store";

export const Route = createFileRoute("/")({ component: Index });

const SERP_GRID_TEMPLATE =
  "minmax(0, 0.8fr) minmax(0, 0.9fr) minmax(0, 1.3fr) minmax(0, 1.1fr) minmax(0, 1.45fr) 58px";

const PROVIDER_LABELS: Record<AIProvider, string> = {
  gemini: "Gemini",
  groq: "Groq",
  cerebras: "Cerebras",
  openai: "ChatGPT",
};

const AI_PROVIDER_OPTIONS: Array<{
  id: AIProvider;
  label: string;
  img?: string;
  Icon?: typeof Sparkles;
  color: string;
}> = [
  {
    id: "gemini",
    label: "Gemini",
    img: "/google-gemini-icon.webp",
    color: "from-slate-800 to-slate-900",
  },
  { id: "groq", label: "Groq", img: "/groq.png", color: "from-slate-800 to-slate-900" },
  {
    id: "cerebras",
    label: "Cerebras",
    img: "/cerebras-color.png",
    color: "from-slate-800 to-slate-900",
  },
  { id: "openai", label: "ChatGPT", img: "/chatgpt.svg", color: "from-emerald-700 to-slate-900" },
];

function GlassCard({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-3xl border border-white/5 bg-white/[0.02] p-6 shadow-2xl backdrop-blur-2xl ${className}`}
    >
      {children}
    </div>
  );
}

function CharCount({ value, max }: { value: string; max: number }) {
  const len = value.length;
  const ratio = len / max;
  const color = ratio > 1 ? "text-rose-400" : ratio > 0.9 ? "text-amber-400" : "text-emerald-400";
  return (
    <span className={`mt-1 block text-right font-mono text-[10px] ${color}`}>
      {len}/{max}
    </span>
  );
}

export function sanitizeCsvFileName(name: string): string {
  const withoutExtension = name.replace(/\.[^/.]+$/, "");
  const cleaned = withoutExtension
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "");

  return cleaned || "serp-controle";
}

function escapeCsvValue(value?: string): string {
  const text = (value ?? "").trim();
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function buildControlCsv(rows: CsvRow[]): string {
  return rows
    .map((row) =>
      [
        row.url,
        row.newTitle ?? "",
        row.newDescription ?? "",
        row.titleJustification ?? "",
        row.descriptionJustification ?? "",
        row.title,
        row.description,
      ]
        .map(escapeCsvValue)
        .join(","),
    )
    .join("\n");
}

function QueueBadge({ status }: { status: string }) {
  const label =
    {
      idle: "Pronta",
      running: "A processar",
      paused: "Pausada",
      done: "Concluida",
      error: "Erro",
    }[status] ?? status;

  const color =
    {
      idle: "border-white/10 bg-white/5 text-white/60",
      running: "border-indigo-300/30 bg-indigo-400/10 text-indigo-100",
      paused: "border-amber-300/30 bg-amber-400/10 text-amber-100",
      done: "border-emerald-300/30 bg-emerald-400/10 text-emerald-100",
      error: "border-rose-300/30 bg-rose-400/10 text-rose-100",
    }[status] ?? "border-white/10 bg-white/5 text-white/60";

  return (
    <span className={`rounded-full border px-3 py-1 text-[10px] uppercase tracking-wider ${color}`}>
      {label}
    </span>
  );
}

function Index() {
  const { settings, dispatch } = useSettings();
  const [fileName, setFileName] = useState<string | null>(null);
  const [rowCount, setRowCount] = useState(0);
  const [isImporting, setIsImporting] = useState(false);
  const [importedRows, setImportedRows] = useState(0);
  const [rowCache, setRowCache] = useState<Map<number, CsvRow>>(() => new Map());
  const [refreshKey, setRefreshKey] = useState(0);
  const [quotaModalOpen, setQuotaModalOpen] = useState(false);
  const [quotaMessage, setQuotaMessage] = useState("");
  const [optimizingRowId, setOptimizingRowId] = useState<number | null>(null);
  const [brandPersonaModalOpen, setBrandPersonaModalOpen] = useState(false);
  const [brandPersonaDraft, setBrandPersonaDraft] = useState(settings.brandPersona || "");
  const [editingCell, setEditingCell] = useState<{
    id: number;
    field: "newTitle" | "newDescription";
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const tableScrollRef = useRef<HTMLDivElement>(null);

  const activeKey = getActiveKey(settings);
  const refreshRows = useCallback(() => setRefreshKey((value) => value + 1), []);

  const queue = useBatchQueue({
    apiKey: activeKey,
    provider: settings.provider,
    brandPersona: settings.brandPersona,
    onRowsChanged: refreshRows,
    onPaused: (message) => {
      setQuotaMessage(message);
      setQuotaModalOpen(true);
      toast.error("Fila pausada", { description: message });
    },
  });

  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => tableScrollRef.current,
    estimateSize: () => 92,
    overscan: 12,
  });

  const virtualRows = rowVirtualizer.getVirtualItems();
  const firstVirtualIndex = virtualRows[0]?.index ?? 0;
  const lastVirtualIndex = virtualRows[virtualRows.length - 1]?.index ?? -1;

  useEffect(() => {
    let cancelled = false;

    getCsvMeta().then((meta) => {
      if (cancelled) return;
      setFileName(meta.fileName);
      setRowCount(meta.rowCount);
      void queue.refreshState();
    });

    return () => {
      cancelled = true;
    };
  }, [queue.refreshState]);

  useEffect(() => {
    if (!fileName || rowCount === 0 || lastVirtualIndex < firstVirtualIndex) {
      setRowCache(new Map());
      return;
    }

    let cancelled = false;
    const startIndex = Math.max(0, firstVirtualIndex - 12);
    const limit = Math.min(rowCount - startIndex, lastVirtualIndex - firstVirtualIndex + 25);

    getRowsWindow(startIndex, limit).then((rows) => {
      if (cancelled) return;
      setRowCache(new Map(rows.map((row) => [row.id, row])));
    });

    return () => {
      cancelled = true;
    };
  }, [fileName, firstVirtualIndex, lastVirtualIndex, refreshKey, rowCount]);

  const preflight = useCallback((): boolean => {
    if (!activeKey.trim()) {
      toast.error("API Key ausente", {
        description: `Defina a chave ${PROVIDER_LABELS[settings.provider]} antes de otimizar.`,
      });
      return false;
    }

    return true;
  }, [activeKey, settings.provider]);

  const handleFile = useCallback(
    async (file: File) => {
      setIsImporting(true);
      setImportedRows(0);
      setRowCache(new Map());

      const result = await importCSVToIndexedDB(file, ({ imported }) => {
        setImportedRows(imported);
      });

      if (result.errors.length > 0) {
        result.errors.forEach((error) => toast.error("Erro no CSV", { description: error }));
        setFileName(null);
        setRowCount(0);
      } else {
        const meta = await getCsvMeta();
        setFileName(meta.fileName);
        setRowCount(meta.rowCount);
        setImportedRows(meta.rowCount);
        refreshRows();
        await queue.refreshState();
        toast.success(`${meta.rowCount} URLs carregadas com sucesso.`);
      }

      setIsImporting(false);
    },
    [queue.refreshState, refreshRows],
  );

  const onFileChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (file) void handleFile(file);
      event.target.value = "";
    },
    [handleFile],
  );

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const file = event.dataTransfer.files[0];
      if (file) void handleFile(file);
    },
    [handleFile],
  );

  const clearFile = useCallback(async () => {
    await clearCsvData();
    setFileName(null);
    setRowCount(0);
    setImportedRows(0);
    setRowCache(new Map());
    refreshRows();
    await queue.refreshState();
  }, [queue.refreshState, refreshRows]);

  const startQueue = useCallback(() => {
    if (!preflight() || rowCount === 0) return;
    void queue.run();
  }, [preflight, queue.run, rowCount]);

  const resumeQueue = useCallback(() => {
    if (!preflight() || rowCount === 0) return;
    void queue.resume();
  }, [preflight, queue.resume, rowCount]);

  const pauseQueue = useCallback(() => {
    void queue.pause();
  }, [queue.pause]);

  const openBrandPersonaModal = useCallback(() => {
    setBrandPersonaDraft(settings.brandPersona || "");
    setBrandPersonaModalOpen(true);
  }, [settings.brandPersona]);

  const saveBrandPersona = useCallback(() => {
    dispatch({ type: "SET_BRAND_PERSONA", payload: brandPersonaDraft });
    setBrandPersonaModalOpen(false);
    toast.success("Tom de voz guardado.");
  }, [brandPersonaDraft, dispatch]);

  const handleCellEdit = useCallback(
    async (id: number, field: "newTitle" | "newDescription", value: string) => {
      setRowCache((prev) => {
        const current = prev.get(id);
        if (!current) return prev;

        const next = new Map(prev);
        next.set(id, { ...current, [field]: value });
        return next;
      });

      const update: Partial<CsvRow> & Pick<CsvRow, "id"> = { id };
      update[field] = value;

      try {
        await updateCsvRows([update]);
      } catch {
        toast.error("Nao foi possivel guardar a edicao.");
        refreshRows();
      }
    },
    [refreshRows],
  );

  const optimizeRow = useCallback(
    async (rowId: number) => {
      if (!preflight()) return;

      const row = await getCsvRow(rowId);
      if (!row) return;

      setOptimizingRowId(rowId);

      try {
        const response = await fetch("/api/optimize-batch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            apiKey: activeKey,
            provider: settings.provider,
            brandPersona: settings.brandPersona,
            batch: [{ id: row.id, url: row.url, title: row.title, description: row.description }],
          }),
        });

        const data = await response.json().catch(() => ({}));

        if (response.status === 429 || response.status === 402) {
          const message =
            "A API atingiu o limite ou ficou sem saldo. A fila foi pausada. Insira uma nova Chave API ou aguarde e clique em 'Retomar'.";
          setQuotaMessage(message);
          setQuotaModalOpen(true);
          return;
        }

        if (!response.ok) {
          throw new Error(data.error || `Erro HTTP ${response.status}`);
        }

        await updateCsvRows(data.resultados ?? []);
        refreshRows();
        toast.success("Linha otimizada.");
      } catch (err) {
        toast.error("Erro da IA", {
          description: err instanceof Error ? err.message : "Erro inesperado.",
        });
      } finally {
        setOptimizingRowId(null);
      }
    },
    [activeKey, preflight, refreshRows, settings.brandPersona, settings.provider],
  );

  const downloadCsv = useCallback(async () => {
    const rows = await getAllCsvRows();
    if (rows.length === 0) {
      toast.error("Nao ha dados para exportar.");
      return;
    }

    const csv = buildControlCsv(rows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${sanitizeCsvFileName(fileName ?? "serp-optimized")}-controle.csv`;
    link.click();
    URL.revokeObjectURL(url);
    toast.success("Exportacao para controle iniciada.");
  }, [fileName]);

  const progressLabel = useMemo(() => {
    if (!fileName) return "Sem dados";
    if (isImporting) return `${importedRows} linhas importadas`;
    return `${rowCount} linhas carregadas`;
  }, [fileName, importedRows, isImporting, rowCount]);

  return (
    <>
      <Dialog open={quotaModalOpen} onOpenChange={setQuotaModalOpen}>
        <DialogContent className="border border-amber-300/20 bg-slate-900/95 text-white sm:rounded-[24px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-white">
              <AlertTriangle className="h-5 w-5 text-amber-300" />
              Fila pausada
            </DialogTitle>
            <DialogDescription className="text-white/65">{quotaMessage}</DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-2">
            <button
              onClick={() => setQuotaModalOpen(false)}
              className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-medium text-white/80"
            >
              Fechar
            </button>
            <button
              onClick={() => {
                setQuotaModalOpen(false);
                resumeQueue();
              }}
              className="inline-flex items-center gap-2 rounded-full border border-emerald-300/30 bg-emerald-400/10 px-4 py-2 text-xs font-semibold text-white"
            >
              <Play className="h-3.5 w-3.5 text-emerald-300" />
              Retomar
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={brandPersonaModalOpen} onOpenChange={setBrandPersonaModalOpen}>
        <DialogContent className="max-w-2xl border border-white/10 bg-slate-950/95 text-white backdrop-blur-2xl sm:rounded-[28px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-white">
              <Settings2 className="h-4 w-4 text-fuchsia-300" />
              Tom de Voz da Marca
            </DialogTitle>
            <DialogDescription className="text-white/60">
              Guarde aqui a persona e as diretrizes de linguagem usadas pela IA.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={brandPersonaDraft}
            onChange={(e) => setBrandPersonaDraft(e.target.value)}
            placeholder="Ex: A persona da marca é amigável, acessível e focada na Classe C. O tom é íntimo e otimista."
            className="min-h-[220px] resize-none rounded-2xl border-white/10 bg-black/30 p-4 text-sm text-white placeholder:text-white/30"
          />
          <DialogFooter className="gap-2 sm:gap-2">
            <button
              onClick={() => setBrandPersonaModalOpen(false)}
              className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-medium text-white/80"
            >
              Cancelar
            </button>
            <button
              onClick={saveBrandPersona}
              className="inline-flex items-center gap-2 rounded-full border border-fuchsia-300/30 bg-fuchsia-500/20 px-5 py-2 text-xs font-semibold text-white shadow-[0_0_20px_-8px_rgba(217,70,239,0.9)]"
            >
              <Wand2 className="h-3.5 w-3.5 text-fuchsia-200" />
              Guardar tom de voz
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <main className="mx-auto grid w-full max-w-[1760px] grid-cols-1 gap-6 px-4 py-6 lg:grid-cols-[300px_minmax(0,1fr)] xl:px-6">
        <aside className="space-y-6">
          <GlassCard className="p-5">
            <h2 className="mb-4 text-sm font-semibold text-white/90">AI Provider</h2>
            <div className="grid grid-cols-2 gap-2">
              {AI_PROVIDER_OPTIONS.map((opt) => {
                const active = settings.provider === opt.id;
                const Icon = opt.Icon;

                return (
                  <button
                    key={opt.id}
                    onClick={() => dispatch({ type: "SET_PROVIDER", payload: opt.id })}
                    className={`group relative flex flex-col items-center gap-1.5 rounded-2xl border p-2.5 text-xs transition-all duration-300 ${
                      active
                        ? "border-white/30 bg-white/10 shadow-[0_0_20px_-5px_rgba(255,255,255,0.3)]"
                        : "border-white/10 bg-white/[0.03] hover:bg-white/[0.07]"
                    }`}
                  >
                    <div
                      className={`flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br ${opt.color} border border-white/10 shadow-inner`}
                    >
                      {opt.img ? (
                        <img
                          src={opt.img}
                          alt={opt.label}
                          className="h-5 w-5 object-contain drop-shadow-sm"
                        />
                      ) : Icon ? (
                        <Icon className="h-5 w-5 text-emerald-100 drop-shadow-sm" />
                      ) : null}
                    </div>
                    <span className="font-medium text-white/90">{opt.label}</span>
                  </button>
                );
              })}
            </div>

            <div className="mt-5 space-y-3">
              {settings.provider === "gemini" && (
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-white/70">
                    Chave Gemini
                  </label>
                  <div className="relative">
                    <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
                    <input
                      type="password"
                      value={settings.geminiKey}
                      onChange={(event) =>
                        dispatch({ type: "SET_GEMINI_KEY", payload: event.target.value })
                      }
                      placeholder="AIzaSy..."
                      className="w-full rounded-2xl border border-white/10 bg-white/5 py-2.5 pl-10 pr-3 text-sm text-white placeholder:text-white/30 outline-none backdrop-blur-xl transition-all duration-300 focus:border-white/30 focus:bg-white/10"
                    />
                  </div>
                </div>
              )}

              {settings.provider === "groq" && (
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-white/70">
                    Chave Groq
                  </label>
                  <div className="relative">
                    <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
                    <input
                      type="password"
                      value={settings.groqKey}
                      onChange={(event) =>
                        dispatch({ type: "SET_GROQ_KEY", payload: event.target.value })
                      }
                      placeholder="gsk_..."
                      className="w-full rounded-2xl border border-white/10 bg-white/5 py-2.5 pl-10 pr-3 text-sm text-white placeholder:text-white/30 outline-none backdrop-blur-xl transition-all duration-300 focus:border-white/30 focus:bg-white/10"
                    />
                  </div>
                </div>
              )}

              {settings.provider === "openai" && (
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-white/70">
                    Chave ChatGPT/OpenAI
                  </label>
                  <div className="relative">
                    <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
                    <input
                      type="password"
                      value={settings.openaiKey}
                      onChange={(event) =>
                        dispatch({ type: "SET_OPENAI_KEY", payload: event.target.value })
                      }
                      placeholder="sk-..."
                      className="w-full rounded-2xl border border-white/10 bg-white/5 py-2.5 pl-10 pr-3 text-sm text-white placeholder:text-white/30 outline-none backdrop-blur-xl transition-all duration-300 focus:border-white/30 focus:bg-white/10"
                    />
                  </div>
                </div>
              )}

              {settings.provider === "cerebras" && (
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-white/70">
                    Chave Cerebras
                  </label>
                  <div className="relative">
                    <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
                    <input
                      type="password"
                      value={settings.cerebrasKey}
                      onChange={(event) =>
                        dispatch({ type: "SET_CEREBRAS_KEY", payload: event.target.value })
                      }
                      placeholder="csk-..."
                      className="w-full rounded-2xl border border-white/10 bg-white/5 py-2.5 pl-10 pr-3 text-sm text-white placeholder:text-white/30 outline-none backdrop-blur-xl transition-all duration-300 focus:border-white/30 focus:bg-white/10"
                    />
                  </div>
                </div>
              )}
            </div>
          </GlassCard>
        </aside>

        <section className="min-w-0">
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <GlassCard className="flex min-h-[220px] flex-col p-5">
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                className="hidden"
                onChange={onFileChange}
              />
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-white/90">1. Base de Dados (CSV)</h2>
                  <p className="mt-1 text-xs text-white/50">{progressLabel}</p>
                </div>
                {fileName && (
                  <button
                    onClick={() => void clearFile()}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/5 text-white/60 transition-all duration-300 hover:bg-white/10 hover:text-white"
                    title="Remover CSV"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
              <div
                onDragOver={(event) => event.preventDefault()}
                onDrop={onDrop}
                className="group relative flex flex-1 flex-col items-center justify-center rounded-2xl border-2 border-dashed border-indigo-300/20 bg-indigo-400/[0.04] px-6 py-8 text-center transition-all duration-300 hover:border-indigo-200/40 hover:bg-indigo-400/[0.08]"
              >
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-400/30 to-fuchsia-500/30 backdrop-blur-xl">
                  {isImporting ? (
                    <Loader2 className="h-6 w-6 animate-spin text-white" />
                  ) : (
                    <Upload className="h-6 w-6 text-white" />
                  )}
                </div>
                <p className="text-sm font-medium text-white/90">
                  {isImporting
                    ? `A importar ${importedRows} linhas...`
                    : fileName
                      ? fileName
                      : "Arraste o CSV ou clique para procurar"}
                </p>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isImporting}
                  className="mt-5 rounded-full bg-white/10 px-4 py-2 text-xs font-medium text-white backdrop-blur-xl transition-all duration-300 hover:bg-white/20 disabled:opacity-50"
                >
                  {fileName ? "Substituir ficheiro" : "Selecionar ficheiro"}
                </button>
              </div>
            </GlassCard>

            <GlassCard className="flex min-h-[220px] flex-col p-5">
              <div className="mb-4">
                <h2 className="text-sm font-semibold text-white/90">
                  2. Tom de Voz da Marca (Opcional)
                </h2>
                <p className="mt-1 text-xs text-white/50">
                  Se vazio, a IA usa um tom neutro e comercial com base no conteúdo rastreado.
                </p>
              </div>
              <button
                onClick={openBrandPersonaModal}
                className="group relative flex min-h-[96px] items-center gap-3 overflow-hidden rounded-2xl border border-fuchsia-300/25 bg-gradient-to-br from-indigo-500/20 via-fuchsia-500/20 to-rose-500/20 p-4 text-left shadow-[0_0_28px_-12px_rgba(217,70,239,0.95)] transition-all duration-300 hover:border-white/35 hover:from-indigo-500/28 hover:via-fuchsia-500/28 hover:to-rose-500/28"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-400 to-fuchsia-500 shadow-[0_0_22px_-6px_rgba(168,85,247,0.9)]">
                  <Settings2 className="h-4 w-4 text-white" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-white">
                    {settings.brandPersona ? "Editar tom de voz" : "Configurar tom de voz"}
                  </span>
                  <span className="mt-1 line-clamp-2 block text-xs leading-relaxed text-white/60">
                    {settings.brandPersona ||
                      "Adicione persona, linguagem e diretrizes para a IA usar nas otimizações."}
                  </span>
                </span>
                <Wand2 className="h-4 w-4 shrink-0 text-white/65 transition-transform duration-300 group-hover:rotate-12" />
              </button>
            </GlassCard>
          </div>
        </section>

        <section className="min-w-0 lg:col-span-2">
          <GlassCard className="overflow-hidden !p-4 md:!p-5">
            <div className="flex flex-col gap-3 border-b border-white/5 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-sm font-semibold text-white/90">SERP DataGrid</h2>
                <p className="text-xs text-white/50">{progressLabel}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {fileName && (
                  <>
                    {queue.status !== "running" && (
                      <button
                        onClick={
                          queue.status === "paused" || queue.status === "error"
                            ? resumeQueue
                            : startQueue
                        }
                        className="liquid-glass-button inline-flex items-center gap-1.5 rounded-full border border-emerald-300/30 px-3.5 py-1.5 text-[11px] font-medium text-white"
                      >
                        <Play className="h-3 w-3 text-emerald-300" />
                        {queue.status === "paused" || queue.status === "error"
                          ? "Retomar fila"
                          : "Iniciar fila"}
                      </button>
                    )}
                    {queue.status === "running" && (
                      <button
                        onClick={pauseQueue}
                        className="liquid-glass-button inline-flex items-center gap-1.5 rounded-full border border-amber-300/30 px-3.5 py-1.5 text-[11px] font-medium text-white"
                      >
                        <Pause className="h-3 w-3 text-amber-300" />
                        Pausar fila
                      </button>
                    )}
                    <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[10px] uppercase tracking-wider text-white/60">
                      {queue.processed}/{rowCount}
                    </span>
                    <QueueBadge status={queue.status} />
                  </>
                )}
                <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[10px] uppercase tracking-wider text-white/60">
                  {PROVIDER_LABELS[settings.provider]}
                </span>
              </div>
            </div>

            {fileName ? (
              <>
                <div className="border-b border-white/5 px-4 py-3">
                  <div className="h-1.5 overflow-hidden rounded-full bg-white/5">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-emerald-300 to-indigo-300 transition-all duration-300"
                      style={{ width: `${queue.progress}%` }}
                    />
                  </div>
                  {queue.lastError && (
                    <p className="mt-2 text-xs text-rose-200">{queue.lastError}</p>
                  )}
                </div>

                <div className="overflow-hidden">
                  <div className="min-w-0">
                    <div
                      className="grid bg-white/[0.04] text-[11px] uppercase tracking-wider text-white/50"
                      style={{ gridTemplateColumns: SERP_GRID_TEMPLATE }}
                    >
                      <div className="px-4 py-3 font-medium">URL</div>
                      <div className="px-4 py-3 font-medium">Titulo atual</div>
                      <div className="px-4 py-3 font-medium">Novo titulo</div>
                      <div className="px-4 py-3 font-medium">Descricao atual</div>
                      <div className="px-4 py-3 font-medium">Nova descricao</div>
                      <div className="px-4 py-3 text-right font-medium">Ações</div>
                    </div>

                    <div
                      ref={tableScrollRef}
                      className="h-[calc(100vh-430px)] min-h-[360px] overflow-y-auto overflow-x-hidden"
                    >
                      <div
                        className="relative"
                        style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
                      >
                        {virtualRows.map((virtualRow) => {
                          const row = rowCache.get(virtualRow.index + 1);
                          const isEditingTitle = Boolean(
                            row && editingCell?.id === row.id && editingCell.field === "newTitle",
                          );
                          const isEditingDescription = Boolean(
                            row &&
                            editingCell?.id === row.id &&
                            editingCell.field === "newDescription",
                          );
                          const isEditingRow = isEditingTitle || isEditingDescription;

                          return (
                            <div
                              key={virtualRow.key}
                              data-index={virtualRow.index}
                              ref={rowVirtualizer.measureElement}
                              className={`absolute left-0 top-0 grid w-full border-t border-white/5 transition-colors duration-200 ${
                                isEditingRow
                                  ? "z-20 bg-slate-950/90 shadow-2xl"
                                  : `z-0 hover:bg-white/[0.03] ${
                                      virtualRow.index % 2 === 1 ? "bg-white/[0.015]" : ""
                                    }`
                              }`}
                              style={{
                                gridTemplateColumns: SERP_GRID_TEMPLATE,
                                transform: `translateY(${virtualRow.start}px)`,
                              }}
                            >
                              {row ? (
                                <>
                                  <div className="min-w-0 px-4 py-3">
                                    <span className="block truncate font-mono text-xs text-white/70">
                                      {row.url.replace(/^https?:\/\//, "")}
                                    </span>
                                  </div>
                                  <div className="min-w-0 px-4 py-3">
                                    <p className="line-clamp-2 text-xs text-white/70">
                                      {row.title}
                                    </p>
                                    <CharCount value={row.title} max={60} />
                                  </div>
                                  <div className="min-w-0 px-4 py-3">
                                    <div className="relative min-h-10 w-full">
                                      <textarea
                                        key={`title-${row.id}-${row.newTitle ?? ""}`}
                                        defaultValue={row.newTitle || ""}
                                        onFocus={() => {
                                          setEditingCell({ id: row.id, field: "newTitle" });
                                          window.setTimeout(() => rowVirtualizer.measure(), 0);
                                          window.setTimeout(() => rowVirtualizer.measure(), 220);
                                        }}
                                        onBlur={(e) => {
                                          void handleCellEdit(row.id, "newTitle", e.target.value);
                                          setEditingCell(null);
                                          window.setTimeout(() => rowVirtualizer.measure(), 0);
                                          window.setTimeout(() => rowVirtualizer.measure(), 220);
                                        }}
                                        className={`w-full resize-none overflow-y-auto rounded-md p-2 text-sm text-white/90 outline-none transition-all duration-200 ${
                                          isEditingTitle
                                            ? "h-28 bg-slate-900 shadow-2xl ring-1 ring-indigo-500"
                                            : "h-10 bg-transparent hover:bg-white/5"
                                        }`}
                                        placeholder="O título gerado aparecerá aqui..."
                                      />
                                    </div>
                                    <CharCount value={row.newTitle ?? ""} max={60} />
                                  </div>
                                  <div className="min-w-0 px-4 py-3">
                                    <p className="line-clamp-2 text-xs text-white/70">
                                      {row.description}
                                    </p>
                                    <CharCount value={row.description} max={155} />
                                  </div>
                                  <div className="min-w-0 px-4 py-3">
                                    <div className="relative min-h-12 w-full">
                                      <textarea
                                        key={`description-${row.id}-${row.newDescription ?? ""}`}
                                        defaultValue={row.newDescription || ""}
                                        onFocus={() => {
                                          setEditingCell({ id: row.id, field: "newDescription" });
                                          window.setTimeout(() => rowVirtualizer.measure(), 0);
                                          window.setTimeout(() => rowVirtualizer.measure(), 220);
                                        }}
                                        onBlur={(e) => {
                                          void handleCellEdit(
                                            row.id,
                                            "newDescription",
                                            e.target.value,
                                          );
                                          setEditingCell(null);
                                          window.setTimeout(() => rowVirtualizer.measure(), 0);
                                          window.setTimeout(() => rowVirtualizer.measure(), 220);
                                        }}
                                        className={`w-full resize-none overflow-y-auto rounded-md p-2 text-sm text-white/80 outline-none transition-all duration-200 ${
                                          isEditingDescription
                                            ? "h-40 bg-slate-900 shadow-2xl ring-1 ring-indigo-500"
                                            : "h-12 bg-transparent hover:bg-white/5"
                                        }`}
                                        placeholder="A descrição gerada aparecerá aqui..."
                                      />
                                    </div>
                                    <CharCount value={row.newDescription ?? ""} max={155} />
                                  </div>
                                  <div className="px-4 py-3">
                                    <div className="flex justify-end gap-1.5">
                                      <button
                                        disabled={
                                          optimizingRowId === row.id || queue.status === "running"
                                        }
                                        onClick={() => void optimizeRow(row.id)}
                                        title="Otimizar linha"
                                        className={`liquid-glass-button inline-flex h-7 w-7 items-center justify-center rounded-full border text-white disabled:opacity-60 ${
                                          row.optimizedTitle && row.optimizedDesc
                                            ? "border-emerald-400/30 bg-emerald-400/10"
                                            : "border-white/15"
                                        }`}
                                      >
                                        {optimizingRowId === row.id ? (
                                          <Loader2 className="h-3 w-3 animate-spin" />
                                        ) : row.optimizedTitle && row.optimizedDesc ? (
                                          <Check className="h-3 w-3 text-emerald-400" />
                                        ) : (
                                          <Wand2 className="h-3 w-3 text-fuchsia-200" />
                                        )}
                                      </button>
                                    </div>
                                  </div>
                                </>
                              ) : (
                                <div className="col-span-6 px-6 py-4 text-xs text-white/35">
                                  A carregar linha...
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between border-t border-white/5 px-4 py-4">
                  <p className="text-xs text-white/50">
                    Pronto para exportar {rowCount} resultado{rowCount !== 1 ? "s" : ""}
                  </p>
                  <button
                    onClick={() => void downloadCsv()}
                    className="liquid-glass-button inline-flex items-center gap-2 rounded-full border border-emerald-300/30 px-4 py-2 text-xs font-semibold text-white"
                  >
                    <Download className="h-3.5 w-3.5 text-emerald-300" />
                    Exportar para Controle
                  </button>
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center px-6 py-20 text-center">
                <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-white/5 backdrop-blur-xl">
                  <Inbox className="h-7 w-7 text-white/40" />
                </div>
                <p className="text-sm font-medium text-white/80">Nenhum dado para mostrar</p>
                <p className="mt-1 max-w-xs text-xs text-white/50">
                  Importe um CSV para iniciar a fila batch.
                </p>
              </div>
            )}
          </GlassCard>
        </section>
      </main>
    </>
  );
}
