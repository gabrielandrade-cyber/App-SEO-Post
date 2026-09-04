import { useVirtualizer } from "@tanstack/react-virtual";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Download,
  Inbox,
  KeyRound,
  Loader2,
  Lock,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  Settings2,
  Upload,
  Volume2,
  VolumeX,
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
import { GlassCard } from "@/components/ui/glass";
import { Textarea } from "@/components/ui/textarea";
import { useBatchQueue, type PauseKind } from "@/hooks/use-batch-queue";
import {
  clearCsvData,
  getCsvMeta,
  getCsvRow,
  getRowsWindow,
  iterateCsvRows,
  updateCsvRows,
} from "@/lib/db";
import { importCSVToIndexedDB } from "@/lib/csv-parser";
import { AI_PROVIDERS, PROVIDER_META, SERP_LIMITS, type AIProvider } from "@/lib/providers";
import { accessTokenHeader } from "@/lib/server-auth";
import {
  isSoundEnabled,
  playAttention,
  playQueueDone,
  playRowDone,
  primeAudio,
  setSoundEnabled,
} from "@/lib/sounds";
import { getActiveKey, keyFieldFor, useSettings, type CsvRow } from "@/lib/store";
import {
  CSV_BOM,
  SERP_GRID_TEMPLATE,
  buildControlCsvLines,
  downloadBlob,
  isAcceptedCsvFile,
  sanitizeCsvFileName,
} from "./utils";

const PROVIDER_ICONS: Record<AIProvider, string> = {
  openai: "/chatgpt.svg",
  gemini: "/google-gemini-icon.webp",
  groq: "/groq.png",
  cerebras: "/cerebras-color.png",
};

const BRAND_PERSONA_TEMPLATE = `Nome da marca:
O que vende e como se posiciona:
Persona (quem compra, o que valoriza, qual e a dor):
Tom de voz (como a marca fala e como NAO fala):
Palavras que a marca usa:
Palavras que a marca evita:
Diferenciais que podem entrar na description (frete, parcelamento, variedade, garantia, marcas):
Apelo comercial permitido? (sim / nao, sem preco, oferta ou urgencia): `;

function CharCount({ value, min, max }: { value: string; min: number; max: number }) {
  const len = Array.from(value.normalize("NFC")).length;
  const nearMin = Math.max(0, min - 10);
  const color =
    len > max
      ? "text-rose-400"
      : len >= min
        ? "text-emerald-400"
        : len >= nearMin
          ? "text-amber-400"
          : "text-white/45";

  return (
    <span className={`mt-1 block text-right font-mono text-[10px] ${color}`}>
      {len} / {min}-{max}
    </span>
  );
}

function EditableMetaCell({
  value,
  placeholder,
  isEditing,
  minHeight,
  min,
  max,
  onFocus,
  onCommit,
  onMeasure,
}: {
  value: string;
  placeholder: string;
  isEditing: boolean;
  minHeight: number;
  min: number;
  max: number;
  onFocus: () => void;
  onCommit: (value: string) => void;
  onMeasure: () => void;
}) {
  const [draft, setDraft] = useState(value);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const onMeasureRef = useRef(onMeasure);
  const focusedRef = useRef(false);

  useEffect(() => {
    onMeasureRef.current = onMeasure;
  }, [onMeasure]);

  const resize = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    textarea.style.height = `${minHeight}px`;
    const nextHeight = Math.max(minHeight, Math.min(textarea.scrollHeight, 220));
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = textarea.scrollHeight > 220 ? "auto" : "hidden";
    window.requestAnimationFrame(() => onMeasureRef.current());
  }, [minHeight]);

  // O valor vindo do banco so substitui o rascunho quando a celula NAO esta em edicao.
  useEffect(() => {
    if (!focusedRef.current) setDraft(value);
  }, [value]);

  useLayoutEffect(() => {
    resize();
  }, [draft, isEditing, resize]);

  return (
    <div className="min-w-0">
      <textarea
        ref={textareaRef}
        value={draft}
        onFocus={() => {
          focusedRef.current = true;
          onFocus();
        }}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          focusedRef.current = false;
          onCommit(draft);
        }}
        className={`w-full resize-none rounded-md p-2 text-sm leading-relaxed outline-none transition-colors duration-200 ${
          isEditing
            ? "bg-slate-900/95 text-white shadow-2xl ring-1 ring-indigo-400/70"
            : "bg-white/[0.025] text-white/85 hover:bg-white/5"
        }`}
        placeholder={placeholder}
        style={{ minHeight }}
      />
      <CharCount value={draft} min={min} max={max} />
    </div>
  );
}

function QueueBadge({ status }: { status: string }) {
  const label =
    {
      idle: "Pronta",
      running: "Processando",
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

const PILL_BUTTON =
  "liquid-glass-button inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[11px] font-medium text-white disabled:cursor-not-allowed disabled:opacity-50";

export function SerpOptimizer() {
  const { settings, dispatch, hydrated } = useSettings();
  const [fileName, setFileName] = useState<string | null>(null);
  const [rowCount, setRowCount] = useState(0);
  const [isImporting, setIsImporting] = useState(false);
  const [importedRows, setImportedRows] = useState(0);
  const [rowCache, setRowCache] = useState<Map<number, CsvRow>>(() => new Map());
  const [refreshKey, setRefreshKey] = useState(0);
  const [pauseModal, setPauseModal] = useState<{
    open: boolean;
    message: string;
    kind: PauseKind;
    canResume: boolean;
  }>({ open: false, message: "", kind: "quota", canResume: true });
  const [restartConfirmOpen, setRestartConfirmOpen] = useState(false);
  const [optimizingRowId, setOptimizingRowId] = useState<number | null>(null);
  const [brandPersonaModalOpen, setBrandPersonaModalOpen] = useState(false);
  const [brandPersonaDraft, setBrandPersonaDraft] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [editingCell, setEditingCell] = useState<{
    id: number;
    field: "newTitle" | "newDescription";
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const tableScrollRef = useRef<HTMLDivElement>(null);
  const [soundOn, setSoundOn] = useState(true);

  useEffect(() => {
    setSoundOn(isSoundEnabled());
  }, []);

  const toggleSound = useCallback(() => {
    setSoundOn((current) => {
      const next = !current;
      setSoundEnabled(next);
      if (next) {
        primeAudio();
        playQueueDone();
      }
      return next;
    });
  }, []);

  const activeKey = getActiveKey(settings);
  const providerMeta = PROVIDER_META[settings.provider];
  const refreshRows = useCallback(() => setRefreshKey((value) => value + 1), []);

  const onPaused = useCallback((message: string, kind: PauseKind) => {
    setPauseModal({ open: true, message, kind, canResume: true });
    toast.error("Fila pausada", { description: message });
    playAttention();
  }, []);

  const queue = useBatchQueue({
    apiKey: activeKey,
    provider: settings.provider,
    brandPersona: settings.brandPersona,
    accessToken: settings.accessToken,
    onRowsChanged: refreshRows,
    onPaused,
  });
  const { refreshState } = queue;

  // Barulhinho ao terminar: a fila inteira ou um reprocessamento de erros.
  const previousStatusRef = useRef(queue.status);
  const previousRetryingRef = useRef(queue.isRetrying);
  useEffect(() => {
    const wasRunning = previousStatusRef.current === "running";
    if (wasRunning && queue.status === "done") playQueueDone();
    if (previousRetryingRef.current && !queue.isRetrying && queue.status !== "error") {
      playQueueDone();
    }
    previousStatusRef.current = queue.status;
    previousRetryingRef.current = queue.isRetrying;
  }, [queue.status, queue.isRetrying]);

  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => tableScrollRef.current,
    estimateSize: () => 118,
    overscan: 12,
  });

  const measureRow = useCallback(
    (index: number) => {
      window.requestAnimationFrame(() => {
        const rowElement = tableScrollRef.current?.querySelector<HTMLElement>(
          `[data-index="${index}"]`,
        );
        if (rowElement) rowVirtualizer.measureElement(rowElement);
      });
    },
    [rowVirtualizer],
  );

  const virtualRows = rowVirtualizer.getVirtualItems();
  const firstVirtualIndex = virtualRows[0]?.index ?? 0;
  const lastVirtualIndex = virtualRows[virtualRows.length - 1]?.index ?? -1;

  useLayoutEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      for (const virtualRow of rowVirtualizer.getVirtualItems()) {
        const rowElement = tableScrollRef.current?.querySelector<HTMLElement>(
          `[data-index="${virtualRow.index}"]`,
        );
        if (rowElement) rowVirtualizer.measureElement(rowElement);
      }
    });

    return () => window.cancelAnimationFrame(frame);
  }, [editingCell, rowCache, rowVirtualizer]);

  // Carga inicial: uma vez, na montagem.
  useEffect(() => {
    let cancelled = false;

    getCsvMeta().then((meta) => {
      if (cancelled) return;
      setFileName(meta.fileName);
      setRowCount(meta.rowCount);
      void refreshState();
    });

    return () => {
      cancelled = true;
    };
  }, [refreshState]);

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
    if (!hydrated) {
      toast.message("Um instante", { description: "Carregando as configuracoes salvas." });
      return false;
    }
    if (!activeKey.trim()) {
      toast.error("API Key ausente", {
        description: `Cole a chave ${providerMeta.label} no painel antes de otimizar.`,
      });
      return false;
    }
    return true;
  }, [activeKey, hydrated, providerMeta.label]);

  const handleFile = useCallback(
    async (file: File) => {
      if (!isAcceptedCsvFile(file)) {
        toast.error("Arquivo nao suportado", {
          description:
            "Envie um arquivo .csv (exportado do Screaming Frog, Search Console ou planilha).",
        });
        return;
      }

      await queue.pause();
      setIsImporting(true);
      setImportedRows(0);
      setRowCache(new Map());

      try {
        const result = await importCSVToIndexedDB(file, ({ imported }) =>
          setImportedRows(imported),
        );

        if (result.errors.length > 0) {
          if (result.rowsImported > 0) {
            // Importacao parcial: nao deixa um dataset incompleto para tras.
            await clearCsvData();
            setFileName(null);
            setRowCount(0);
          }
          result.errors.forEach((error) => toast.error("Erro no CSV", { description: error }));
        } else {
          const meta = await getCsvMeta();
          setFileName(meta.fileName);
          setRowCount(meta.rowCount);
          setImportedRows(meta.rowCount);
          refreshRows();
          await queue.refreshState();

          const mappingNote = result.mapping?.byName
            ? "Colunas reconhecidas pelo cabecalho."
            : "Colunas lidas por posicao: URL, title, description.";
          toast.success(`${meta.rowCount} URLs carregadas.`, { description: mappingNote });
        }

        result.warnings.forEach((warning) =>
          toast.warning("Aviso do CSV", { description: warning }),
        );
      } catch (err) {
        toast.error("Falha na importacao", {
          description: err instanceof Error ? err.message : "Erro inesperado ao ler o arquivo.",
        });
      } finally {
        setIsImporting(false);
      }
    },
    [queue, refreshRows],
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
    await queue.pause();
    await clearCsvData();
    setFileName(null);
    setRowCount(0);
    setImportedRows(0);
    setRowCache(new Map());
    refreshRows();
    await queue.refreshState();
  }, [queue, refreshRows]);

  const startQueue = useCallback(() => {
    primeAudio();
    if (!preflight() || rowCount === 0) return;
    if (queue.status === "done") {
      setRestartConfirmOpen(true);
      return;
    }
    void queue.run();
  }, [preflight, queue, rowCount]);

  const confirmRestart = useCallback(() => {
    setRestartConfirmOpen(false);
    void queue.run({ restart: true });
  }, [queue]);

  const resumeQueue = useCallback(() => {
    primeAudio();
    if (!preflight() || rowCount === 0) return;
    void queue.resume();
  }, [preflight, queue, rowCount]);

  const pauseQueue = useCallback(() => {
    void queue.pause();
  }, [queue]);

  const retryErrors = useCallback(() => {
    primeAudio();
    if (!preflight()) return;
    void queue.retryErrors().then((remaining) => {
      if (remaining === 0) toast.success("Todas as linhas com erro foram reprocessadas.");
    });
  }, [preflight, queue]);

  const retryOutOfRange = useCallback(() => {
    primeAudio();
    if (!preflight()) return;
    void queue.retryOutOfRange().then((remaining) => {
      if (remaining === 0) toast.success("Todos os textos estao dentro da faixa de caracteres.");
      else if (remaining !== undefined) {
        toast.warning(
          `${remaining} linha(s) continuam fora da faixa. Ajuste manualmente ou rode de novo.`,
        );
      }
    });
  }, [preflight, queue]);

  const openBrandPersonaModal = useCallback(() => {
    setBrandPersonaDraft(settings.brandPersona || "");
    setBrandPersonaModalOpen(true);
  }, [settings.brandPersona]);

  const saveBrandPersona = useCallback(() => {
    dispatch({ type: "SET_BRAND_PERSONA", payload: brandPersonaDraft.trim() });
    setBrandPersonaModalOpen(false);
    toast.success("Tom de voz salvo.");
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

      try {
        await updateCsvRows([{ id, [field]: value }]);
      } catch {
        toast.error("Nao foi possivel salvar a edicao.");
        refreshRows();
      }
    },
    [refreshRows],
  );

  const optimizeRow = useCallback(
    async (rowId: number) => {
      primeAudio();
      if (!preflight()) return;

      const row = await getCsvRow(rowId);
      if (!row) return;

      setOptimizingRowId(rowId);

      try {
        const response = await fetch("/api/optimize-batch", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...accessTokenHeader(settings.accessToken),
          },
          body: JSON.stringify({
            apiKey: activeKey,
            provider: settings.provider,
            brandPersona: settings.brandPersona,
            batch: [{ id: row.id, url: row.url, title: row.title, description: row.description }],
          }),
        });

        const data = (await response.json().catch(() => ({}))) as {
          resultados?: Array<Partial<CsvRow> & Pick<CsvRow, "id">>;
          error?: string;
        };

        if ([401, 402, 403, 429].includes(response.status)) {
          const kind: PauseKind =
            response.status === 402 ? "billing" : response.status === 429 ? "quota" : "auth";
          setPauseModal({
            open: true,
            kind,
            canResume: false,
            message: data.error || "O provedor recusou a requisicao. Confira a chave ou aguarde.",
          });
          return;
        }

        if (!response.ok) throw new Error(data.error || `Erro HTTP ${response.status}`);

        const resultados = data.resultados ?? [];
        const result = resultados.find((item) => item.id === row.id);
        if (!result) throw new Error("A IA nao devolveu resultado para esta linha.");

        await updateCsvRows([result]);
        refreshRows();

        if (result.optimizationError) {
          toast.error("A linha voltou com erro", { description: result.optimizationError });
        } else {
          playRowDone();
          toast.success("Linha otimizada.");
        }
      } catch (err) {
        toast.error("Erro da IA", {
          description: err instanceof Error ? err.message : "Erro inesperado.",
        });
      } finally {
        setOptimizingRowId(null);
      }
    },
    [
      activeKey,
      preflight,
      refreshRows,
      settings.accessToken,
      settings.brandPersona,
      settings.provider,
    ],
  );

  const downloadCsv = useCallback(async () => {
    const parts: string[] = [CSV_BOM];
    const total = await iterateCsvRows((rows) => {
      parts.push(buildControlCsvLines(rows), "\r\n");
    });

    if (total === 0) {
      toast.error("Nao ha dados para exportar.");
      return;
    }

    parts.pop();
    downloadBlob(
      new Blob(parts, { type: "text/csv;charset=utf-8" }),
      `${sanitizeCsvFileName(fileName ?? "serp-optimized")}-controle.csv`,
    );
    toast.success(`Exportacao iniciada: ${total} linhas.`);
  }, [fileName]);

  const progressLabel = useMemo(() => {
    if (!fileName) return "Sem dados";
    if (isImporting) return `${importedRows} linhas importadas`;
    return `${rowCount} linhas carregadas`;
  }, [fileName, importedRows, isImporting, rowCount]);

  const keyField = keyFieldFor(settings.provider);
  const securityNote =
    settings.keySecurity.status === "locked" ||
    settings.keySecurity.status === "session-only" ||
    settings.keySecurity.status === "unavailable"
      ? settings.keySecurity.message
      : null;

  const isRunning = queue.status === "running";
  const activeRanges = isRunning ? queue.activeRanges : [];

  return (
    <>
      <Dialog
        open={pauseModal.open}
        onOpenChange={(open) => setPauseModal((prev) => ({ ...prev, open }))}
      >
        <DialogContent className="border border-amber-300/20 bg-slate-900/95 text-white sm:rounded-[24px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-white">
              {pauseModal.kind === "auth" ? (
                <KeyRound className="h-5 w-5 text-amber-300" />
              ) : (
                <AlertTriangle className="h-5 w-5 text-amber-300" />
              )}
              {pauseModal.kind === "auth"
                ? "Chave recusada"
                : pauseModal.kind === "billing"
                  ? "Conta sem saldo"
                  : pauseModal.canResume
                    ? "Fila pausada"
                    : "Limite atingido"}
            </DialogTitle>
            <DialogDescription className="text-white/65">{pauseModal.message}</DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-2">
            <button
              onClick={() => setPauseModal((prev) => ({ ...prev, open: false }))}
              className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-medium text-white/80"
            >
              Fechar
            </button>
            {pauseModal.canResume && (
              <button
                onClick={() => {
                  setPauseModal((prev) => ({ ...prev, open: false }));
                  resumeQueue();
                }}
                className={`${PILL_BUTTON} border-emerald-300/30 px-4 py-2 text-xs font-semibold`}
              >
                <Play className="h-3.5 w-3.5 text-emerald-300" />
                Retomar fila
              </button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={restartConfirmOpen} onOpenChange={setRestartConfirmOpen}>
        <DialogContent className="border border-white/10 bg-slate-900/95 text-white sm:rounded-[24px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-white">
              <RotateCcw className="h-5 w-5 text-indigo-300" />
              Processar tudo de novo?
            </DialogTitle>
            <DialogDescription className="text-white/65">
              A fila ja foi concluida. Rodar de novo substitui todos os titles e descriptions
              gerados, inclusive os que voce editou a mao. Para corrigir so as linhas com erro, use
              Reprocessar erros.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-2">
            <button
              onClick={() => setRestartConfirmOpen(false)}
              className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-medium text-white/80"
            >
              Cancelar
            </button>
            <button
              onClick={confirmRestart}
              className={`${PILL_BUTTON} border-indigo-300/30 px-4 py-2 text-xs font-semibold`}
            >
              <Play className="h-3.5 w-3.5 text-indigo-300" />
              Rodar do inicio
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={brandPersonaModalOpen} onOpenChange={setBrandPersonaModalOpen}>
        <DialogContent className="max-h-[88vh] max-w-2xl overflow-y-auto border border-white/10 bg-slate-950/95 text-white backdrop-blur-2xl sm:rounded-[28px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-white">
              <Settings2 className="h-4 w-4 text-fuchsia-300" />
              Tom de voz da marca
            </DialogTitle>
            <DialogDescription className="text-white/60">
              A IA le estas diretrizes antes de escrever cada title e description e explica, na
              justificativa, como as aplicou. Quanto mais concreto, melhor: nome da marca (para nao
              usar no title), o que vende, persona, tom, palavras que usa e evita, diferenciais.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={brandPersonaDraft}
            onChange={(event) => setBrandPersonaDraft(event.target.value)}
            placeholder={BRAND_PERSONA_TEMPLATE}
            className="h-[260px] max-h-[45vh] resize-none overflow-y-auto rounded-2xl border-white/10 bg-black/30 p-4 font-mono text-[13px] leading-relaxed text-white placeholder:text-white/30"
          />
          <DialogFooter className="gap-2 sm:gap-2">
            {!brandPersonaDraft.trim() && (
              <button
                onClick={() => setBrandPersonaDraft(BRAND_PERSONA_TEMPLATE)}
                className="mr-auto rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-medium text-white/80"
              >
                Usar modelo de preenchimento
              </button>
            )}
            <button
              onClick={() => setBrandPersonaModalOpen(false)}
              className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-medium text-white/80"
            >
              Cancelar
            </button>
            <button
              onClick={saveBrandPersona}
              className="liquid-glass-button inline-flex items-center gap-2 rounded-full border border-fuchsia-300/30 bg-fuchsia-500/20 px-5 py-2 text-xs font-semibold text-white shadow-[0_0_20px_-8px_rgba(217,70,239,0.9)]"
            >
              <Wand2 className="h-3.5 w-3.5 text-fuchsia-200" />
              Salvar tom de voz
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="mx-auto grid w-full max-w-[1760px] grid-cols-1 gap-6 px-4 py-6 lg:grid-cols-[300px_minmax(0,1fr)] xl:px-6">
        <aside className="space-y-6">
          <GlassCard className="p-5" variant="control">
            <h2 className="mb-4 text-sm font-semibold text-white/90">Provedor de IA</h2>
            <div className="grid grid-cols-2 gap-2">
              {AI_PROVIDERS.map((id) => {
                const meta = PROVIDER_META[id];
                const active = settings.provider === id;

                return (
                  <button
                    key={id}
                    type="button"
                    title={meta.hint}
                    onClick={() => dispatch({ type: "SET_PROVIDER", payload: id })}
                    className={`group relative flex flex-col items-center gap-1.5 rounded-2xl border p-2.5 text-xs transition-all duration-300 ${
                      active
                        ? "border-white/30 bg-white/10 shadow-[0_0_20px_-5px_rgba(255,255,255,0.3)]"
                        : "border-white/10 bg-white/[0.03] hover:bg-white/[0.07]"
                    }`}
                  >
                    <div
                      className={`flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-gradient-to-br shadow-inner ${
                        id === "openai"
                          ? "from-emerald-700 to-slate-900"
                          : "from-slate-800 to-slate-900"
                      }`}
                    >
                      <img
                        src={PROVIDER_ICONS[id]}
                        alt=""
                        className="h-5 w-5 object-contain drop-shadow-sm"
                      />
                    </div>
                    <span className="font-medium text-white/90">{meta.label}</span>
                  </button>
                );
              })}
            </div>

            <div className="mt-5 space-y-3">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-white/70">
                  Chave {providerMeta.label}
                </label>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
                  <input
                    type="password"
                    autoComplete="off"
                    value={settings[keyField]}
                    onChange={(event) =>
                      dispatch({
                        type: "SET_SECRET",
                        field: keyField,
                        payload: event.target.value.trim(),
                      })
                    }
                    placeholder={hydrated ? providerMeta.keyPlaceholder : "Carregando..."}
                    className="w-full rounded-2xl border border-white/10 bg-white/5 py-2.5 pl-10 pr-3 text-sm text-white outline-none backdrop-blur-xl transition-all duration-300 placeholder:text-white/30 focus:border-white/30 focus:bg-white/10"
                  />
                </div>
              </div>

              {securityNote && (
                <div className="flex items-start gap-2 rounded-xl border border-amber-300/20 bg-amber-400/10 p-3 text-[11px] leading-relaxed text-amber-100/90">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300" />
                  <span>{securityNote}</span>
                </div>
              )}
              <button
                type="button"
                onClick={() => setAdvancedOpen((open) => !open)}
                className="flex w-full items-center justify-between rounded-xl px-1 py-1 text-[11px] font-medium text-white/50 transition-colors hover:text-white/80"
              >
                Avancado
                <ChevronDown
                  className={`h-3.5 w-3.5 transition-transform duration-300 ${advancedOpen ? "rotate-180" : ""}`}
                />
              </button>
              {advancedOpen && (
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-white/70">
                    Token de acesso do Worker (opcional)
                  </label>
                  <input
                    type="password"
                    autoComplete="off"
                    value={settings.accessToken}
                    onChange={(event) =>
                      dispatch({
                        type: "SET_SECRET",
                        field: "accessToken",
                        payload: event.target.value.trim(),
                      })
                    }
                    placeholder="so se OPTMOS_ACCESS_TOKEN estiver definido"
                    className="w-full rounded-2xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white outline-none backdrop-blur-xl transition-all duration-300 placeholder:text-white/30 focus:border-white/30 focus:bg-white/10"
                  />
                  <p className="mt-2 text-[11px] leading-relaxed text-white/45">
                    Protege o endpoint publicado contra uso por terceiros. Defina o secret no
                    Cloudflare e cole o mesmo valor aqui.
                  </p>
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
                accept=".csv,.txt,.tsv,text/csv,text/plain"
                className="hidden"
                onChange={onFileChange}
              />
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-white/90">1. Base de dados (CSV)</h2>
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
                    ? `Importando ${importedRows} linhas...`
                    : fileName
                      ? fileName
                      : "Arraste o CSV ou clique para procurar"}
                </p>
                <p className="mt-1 text-[11px] text-white/45">
                  Colunas URL, title e description, por nome no cabecalho ou por posicao.
                </p>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isImporting}
                  className="liquid-glass-button mt-5 rounded-full border border-white/15 px-4 py-2 text-xs font-medium text-white disabled:opacity-50"
                >
                  {fileName ? "Substituir arquivo" : "Selecionar arquivo"}
                </button>
              </div>
            </GlassCard>

            <GlassCard className="flex min-h-[220px] flex-col p-5">
              <div className="mb-4">
                <h2 className="text-sm font-semibold text-white/90">
                  2. Tom de voz da marca (opcional)
                </h2>
                <p className="mt-1 text-xs text-white/50">
                  Se vazio, a IA usa um tom neutro e comercial com base no conteudo rastreado.
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
                  <span className="mt-1 line-clamp-2 break-words text-xs leading-relaxed text-white/60">
                    {settings.brandPersona ||
                      "Nome da marca, persona, tom, palavras que usa e evita, diferenciais."}
                  </span>
                </span>
                <Wand2 className="h-4 w-4 shrink-0 text-white/65 transition-transform duration-300 group-hover:rotate-12" />
              </button>
            </GlassCard>
          </div>
        </section>

        <section className="min-w-0 lg:col-span-2">
          <GlassCard className="overflow-hidden !p-4 md:!p-5" variant="content">
            <div className="flex flex-col gap-3 border-b border-white/5 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-sm font-semibold text-white/90">SERP DataGrid</h2>
                <p className="text-xs text-white/50">{progressLabel}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {fileName && (
                  <>
                    {!isRunning && (
                      <button
                        onClick={
                          queue.status === "paused" || queue.status === "error"
                            ? resumeQueue
                            : startQueue
                        }
                        disabled={queue.isRetrying}
                        className={`${PILL_BUTTON} border-emerald-300/30`}
                      >
                        <Play className="h-3 w-3 text-emerald-300" />
                        {queue.status === "paused" || queue.status === "error"
                          ? "Retomar fila"
                          : queue.status === "done"
                            ? "Rodar de novo"
                            : "Iniciar fila"}
                      </button>
                    )}
                    {isRunning && (
                      <button onClick={pauseQueue} className={`${PILL_BUTTON} border-amber-300/30`}>
                        <Pause className="h-3 w-3 text-amber-300" />
                        Pausar fila
                      </button>
                    )}
                    {queue.errorCount > 0 && !isRunning && (
                      <button
                        onClick={retryErrors}
                        disabled={queue.isRetrying}
                        className={`${PILL_BUTTON} border-rose-300/30`}
                      >
                        <RefreshCw
                          className={`h-3 w-3 text-rose-300 ${queue.isRetrying ? "animate-spin" : ""}`}
                        />
                        Reprocessar {queue.errorCount} erro{queue.errorCount !== 1 ? "s" : ""}
                      </button>
                    )}
                    {queue.outOfRangeCount > 0 && !isRunning && (
                      <button
                        onClick={retryOutOfRange}
                        disabled={queue.isRetrying}
                        title="Reescreve so as linhas cujo title ou description ficou fora de 50 a 58 / 150 a 160 caracteres"
                        className={`${PILL_BUTTON} border-amber-300/30`}
                      >
                        <RefreshCw
                          className={`h-3 w-3 text-amber-300 ${queue.isRetrying ? "animate-spin" : ""}`}
                        />
                        Ajustar {queue.outOfRangeCount} fora da faixa
                      </button>
                    )}
                    <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[10px] uppercase tracking-wider text-white/60">
                      {queue.processed}/{rowCount}
                    </span>
                    <QueueBadge status={queue.status} />
                  </>
                )}
                <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[10px] uppercase tracking-wider text-white/60">
                  {providerMeta.label}
                </span>
                <button
                  type="button"
                  onClick={toggleSound}
                  title={soundOn ? "Som ao concluir: ligado" : "Som ao concluir: desligado"}
                  aria-label={soundOn ? "Desligar som de conclusao" : "Ligar som de conclusao"}
                  className="liquid-glass-button inline-flex h-7 w-7 items-center justify-center rounded-full border border-white/15 text-white/70"
                >
                  {soundOn ? (
                    <Volume2 className="h-3.5 w-3.5" />
                  ) : (
                    <VolumeX className="h-3.5 w-3.5" />
                  )}
                </button>
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
                      <div className="px-4 py-3 font-medium">Title atual</div>
                      <div className="px-4 py-3 font-medium">Novo title</div>
                      <div className="px-4 py-3 font-medium">Description atual</div>
                      <div className="px-4 py-3 font-medium">Nova description</div>
                      <div className="px-4 py-3 text-right font-medium">Acoes</div>
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
                          const isActiveRow = activeRanges.some(
                            (range) =>
                              virtualRow.index >= range.start && virtualRow.index < range.end,
                          );
                          const isDone = Boolean(row?.optimizedTitle && row?.optimizedDesc);

                          return (
                            <div
                              key={virtualRow.key}
                              data-index={virtualRow.index}
                              ref={rowVirtualizer.measureElement}
                              className={`absolute left-0 top-0 grid min-h-[118px] w-full items-start border-t border-white/5 transition-colors duration-200 ${
                                isEditingRow
                                  ? "z-20 bg-slate-950/90 shadow-2xl"
                                  : isActiveRow
                                    ? "optmos-row-active z-0"
                                    : `z-0 hover:bg-white/[0.03] ${virtualRow.index % 2 === 1 ? "bg-white/[0.015]" : ""}`
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
                                    <CharCount
                                      value={row.title}
                                      min={SERP_LIMITS.title.min}
                                      max={SERP_LIMITS.title.max}
                                    />
                                  </div>
                                  <div className="min-w-0 px-4 py-3">
                                    <EditableMetaCell
                                      value={row.newTitle ?? ""}
                                      isEditing={isEditingTitle}
                                      minHeight={40}
                                      min={SERP_LIMITS.title.min}
                                      max={SERP_LIMITS.title.max}
                                      onFocus={() =>
                                        setEditingCell({ id: row.id, field: "newTitle" })
                                      }
                                      onCommit={(value) => {
                                        void handleCellEdit(row.id, "newTitle", value);
                                        setEditingCell(null);
                                      }}
                                      onMeasure={() => measureRow(virtualRow.index)}
                                      placeholder="O title gerado aparece aqui..."
                                    />
                                    {row.titleJustification && (
                                      <p
                                        className="mt-1 line-clamp-2 text-[10px] leading-relaxed text-white/40"
                                        title={row.titleJustification}
                                      >
                                        {row.titleJustification}
                                      </p>
                                    )}
                                  </div>
                                  <div className="min-w-0 px-4 py-3">
                                    <p className="line-clamp-2 text-xs text-white/70">
                                      {row.description}
                                    </p>
                                    <CharCount
                                      value={row.description}
                                      min={SERP_LIMITS.description.min}
                                      max={SERP_LIMITS.description.max}
                                    />
                                  </div>
                                  <div className="min-w-0 px-4 py-3">
                                    <EditableMetaCell
                                      value={row.newDescription ?? ""}
                                      isEditing={isEditingDescription}
                                      minHeight={48}
                                      min={SERP_LIMITS.description.min}
                                      max={SERP_LIMITS.description.max}
                                      onMeasure={() => measureRow(virtualRow.index)}
                                      onFocus={() =>
                                        setEditingCell({ id: row.id, field: "newDescription" })
                                      }
                                      onCommit={(value) => {
                                        void handleCellEdit(row.id, "newDescription", value);
                                        setEditingCell(null);
                                      }}
                                      placeholder="A description gerada aparece aqui..."
                                    />
                                    {row.descriptionJustification && (
                                      <p
                                        className="mt-1 line-clamp-2 text-[10px] leading-relaxed text-white/40"
                                        title={row.descriptionJustification}
                                      >
                                        {row.descriptionJustification}
                                      </p>
                                    )}
                                  </div>
                                  <div className="px-3 py-3">
                                    <div className="flex items-center justify-end gap-1.5">
                                      {row.optimizationError && (
                                        <span
                                          title={row.optimizationError}
                                          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-amber-300/25 bg-amber-400/10"
                                        >
                                          <AlertTriangle className="h-3 w-3 text-amber-300" />
                                        </span>
                                      )}
                                      <button
                                        disabled={
                                          optimizingRowId === row.id ||
                                          isRunning ||
                                          queue.isRetrying
                                        }
                                        onClick={() => void optimizeRow(row.id)}
                                        title={isDone ? "Gerar de novo" : "Otimizar esta linha"}
                                        className={`liquid-glass-button inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-white disabled:opacity-60 ${
                                          isDone
                                            ? "border-emerald-400/30 bg-emerald-400/10"
                                            : "border-white/15"
                                        }`}
                                      >
                                        {optimizingRowId === row.id || isActiveRow ? (
                                          <Loader2 className="h-3 w-3 animate-spin" />
                                        ) : isDone ? (
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
                                  Carregando linha...
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
                    Exporta {rowCount} linha{rowCount !== 1 ? "s" : ""} no layout de upload (7
                    colunas, sem cabecalho, UTF-8 com BOM)
                  </p>
                  <button
                    onClick={() => void downloadCsv()}
                    className="liquid-glass-button inline-flex items-center gap-2 rounded-full border border-emerald-300/30 px-4 py-2 text-xs font-semibold text-white"
                  >
                    <Download className="h-3.5 w-3.5 text-emerald-300" />
                    Exportar para controle
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
                  Importe um CSV para iniciar a fila.
                </p>
              </div>
            )}
          </GlassCard>
        </section>
      </div>
    </>
  );
}
