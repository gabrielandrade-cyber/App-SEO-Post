import { createFileRoute } from "@tanstack/react-router";
import { useReducer, useState, useRef, useCallback } from "react";
import { toast } from "sonner";
import {
  Sparkles, Lock, Upload, Wand2, Loader2, X, FileText,
  RotateCcw, Gem, Zap, Inbox, Settings2, Download, Check,
  Cpu,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import {
  useSettings, getActiveKey, DEFAULT_TITLE_PROMPT,
  DEFAULT_DESC_PROMPT, type CsvRow, type AIProvider,
} from "@/lib/store";
import { parseCSV } from "@/lib/csv-parser";
import { optimizeField, delay, BULK_DELAY_MS } from "@/lib/ai-service";

export const Route = createFileRoute("/")({ component: Index });

function GlassCard({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-3xl border border-white/5 bg-white/[0.02] p-6 shadow-2xl backdrop-blur-2xl ${className}`}>
      {children}
    </div>
  );
}

function CharCount({ value, max }: { value: string; max: number }) {
  const len = value.length;
  const ratio = len / max;
  const color = ratio > 1 ? "text-rose-400" : ratio > 0.9 ? "text-amber-400" : "text-emerald-400";
  return <span className={`ml-2 text-[10px] font-mono ${color}`}>{len}/{max}</span>;
}

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
  { id: "gemini", label: "Gemini", img: "/google-gemini-icon.webp", color: "from-slate-800 to-slate-900" },
  { id: "groq", label: "Groq", img: "/groq.png", color: "from-slate-800 to-slate-900" },
  { id: "cerebras", label: "Cerebras", img: "/cerebras-color.png", color: "from-slate-800 to-slate-900" },
  { id: "openai", label: "ChatGPT", Icon: Sparkles, color: "from-emerald-700 to-slate-900" },
];

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
    .map((row) => [
      row.url,
      row.newTitle ?? "",
      row.newDescription ?? "",
      row.titleJustification ?? "",
      row.descriptionJustification ?? "",
      row.title,
      row.description,
    ].map(escapeCsvValue).join(","))
    .join("\n");
}

function Index() {
  const { settings, dispatch } = useSettings();
  const [fileName, setFileName] = useState<string | null>(null);
  const [rows, setRows] = useState<CsvRow[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ─── Pre-flight: check API key before any AI call ─────────────────
  const preflight = useCallback((): boolean => {
    if (!getActiveKey(settings).trim()) {
      toast.error("API Key ausente", { description: `Defina a sua chave de API ${PROVIDER_LABELS[settings.provider]} no painel lateral antes de otimizar.` });
      return false;
    }
    return true;
  }, [settings]);

  // ─── CSV Upload handler ───────────────────────────────────────────
  const handleFile = useCallback(async (file: File) => {
    const result = await parseCSV(file);
    if (result.errors.length > 0) {
      result.errors.forEach((e) => toast.error("Erro no CSV", { description: e }));
      return;
    }
    setRows(result.rows);
    setFileName(file.name);
    toast.success(`${result.rows.length} URLs carregadas com sucesso!`);
  }, []);

  const onFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) handleFile(f);
    e.target.value = "";
  }, [handleFile]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  }, [handleFile]);

  const clearFile = useCallback(() => { setRows([]); setFileName(null); }, []);

  // ─── Single-row optimize ──────────────────────────────────────────
  const optimizeRow = useCallback(async (rowId: number, field: "title" | "description") => {
    if (!preflight()) return;
    const loadKey = field === "title" ? "loadingTitle" : "loadingDesc";
    const doneKey = field === "title" ? "optimizedTitle" : "optimizedDesc";
    const resultKey = field === "title" ? "newTitle" : "newDescription";
    setRows((prev) => prev.map((r) => r.id === rowId ? { ...r, [loadKey]: true } : r));

    const row = rows.find((r) => r.id === rowId);
    if (!row) {
      setRows((prev) => prev.map((r) => r.id === rowId ? { ...r, [loadKey]: false } : r));
      return;
    }

    const prompt = field === "title" ? settings.titlePrompt : settings.descPrompt;
    const res = await (optimizeField as any)({
      data: {
        provider: settings.provider,
        apiKey: getActiveKey(settings),
        systemPrompt: prompt,
        targetUrl: row.url,
        field,
      },
    });

    if (res.error) {
      toast.error("Erro da IA", {
        description: res.error,
        duration: res.retryAfter ? res.retryAfter + 2000 : 5000,
      });
      setRows((prev) => prev.map((r) => r.id === rowId ? { ...r, [loadKey]: false } : r));
      return;
    }
    setRows((prev) => prev.map((r) => r.id === rowId ? { ...r, [resultKey]: res.text, [loadKey]: false, [doneKey]: true } : r));
    toast.success(`${field === "title" ? "Title" : "Description"} otimizado!`);
  }, [rows, settings, preflight]);

  // ─── Bulk optimize with rate-limit delay ──────────────────────────
  const optimizeAll = useCallback(async (field: "title" | "description") => {
    if (!preflight()) return;
    const loadKey = field === "title" ? "loadingTitle" : "loadingDesc";
    const doneKey = field === "title" ? "optimizedTitle" : "optimizedDesc";
    const resultKey = field === "title" ? "newTitle" : "newDescription";
    setRows((prev) => prev.map((r) => ({ ...r, [loadKey]: true })));

    const prompt = field === "title" ? settings.titlePrompt : settings.descPrompt;
    const activeKey = getActiveKey(settings);
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];

      // Rate-limit protection: 2s delay between requests
      if (i > 0) await delay(BULK_DELAY_MS);

      const res = await (optimizeField as any)({
        data: {
          provider: settings.provider,
          apiKey: activeKey,
          systemPrompt: prompt,
          targetUrl: row.url,
          field,
        },
      });
      if (res.error) {
        toast.error(`Erro na linha ${row.id}`, {
          description: res.error,
          duration: res.retryAfter ? res.retryAfter + 2000 : 5000,
        });
        setRows((prev) => prev.map((r) => r.id === row.id ? { ...r, [loadKey]: false } : r));
      } else {
        setRows((prev) => prev.map((r) => r.id === row.id ? { ...r, [resultKey]: res.text, [loadKey]: false, [doneKey]: true } : r));
      }
    }
    toast.success(`Todos os ${field === "title" ? "Titles" : "Descriptions"} foram processados!`);
  }, [rows, settings, preflight]);

  // ─── Download CSV ─────────────────────────────────────────────────
  const downloadCsv = useCallback(() => {
    if (rows.length === 0) {
      toast.error("Nao ha dados para exportar.");
      return;
    }

    const csv = buildControlCsv(rows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${sanitizeCsvFileName(fileName ?? "serp-optimized")}-controle.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Exportacao para controle iniciada.");
  }, [rows, fileName]);

  return (
    <>
      <main className="mx-auto grid max-w-7xl grid-cols-1 gap-6 px-6 py-8 lg:grid-cols-[320px_1fr]">
        {/* Sidebar */}
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
                    <div className={`flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br ${opt.color} border border-white/10 shadow-inner`}>
                      {opt.img ? (
                        <img src={opt.img} alt={opt.label} className="h-5 w-5 object-contain drop-shadow-sm" />
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
                  <label className="mb-1.5 block text-xs font-medium text-white/70">Chave Gemini (aistudio.google.com)</label>
                  <div className="relative">
                    <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
                    <input type="password" value={settings.geminiKey} onChange={(e) => dispatch({ type: "SET_GEMINI_KEY", payload: e.target.value })} placeholder="AIzaSy•••" className="w-full rounded-2xl border border-white/10 bg-white/5 py-2.5 pl-10 pr-3 text-sm text-white placeholder:text-white/30 outline-none backdrop-blur-xl transition-all duration-300 focus:border-white/30 focus:bg-white/10" />
                  </div>
                </div>
              )}
              {settings.provider === "groq" && (
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-white/70">Chave Groq (console.groq.com)</label>
                  <div className="relative">
                    <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
                    <input type="password" value={settings.groqKey} onChange={(e) => dispatch({ type: "SET_GROQ_KEY", payload: e.target.value })} placeholder="gsk_•••" className="w-full rounded-2xl border border-white/10 bg-white/5 py-2.5 pl-10 pr-3 text-sm text-white placeholder:text-white/30 outline-none backdrop-blur-xl transition-all duration-300 focus:border-white/30 focus:bg-white/10" />
                  </div>
                </div>
              )}
              {settings.provider === "openai" && (
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-white/70">Chave ChatGPT/OpenAI (platform.openai.com)</label>
                  <div className="relative">
                    <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
                    <input type="password" value={settings.openaiKey} onChange={(e) => dispatch({ type: "SET_OPENAI_KEY", payload: e.target.value })} placeholder="sk-..." className="w-full rounded-2xl border border-white/10 bg-white/5 py-2.5 pl-10 pr-3 text-sm text-white placeholder:text-white/30 outline-none backdrop-blur-xl transition-all duration-300 focus:border-white/30 focus:bg-white/10" />
                  </div>
                  <p className="mt-1 text-[10px] text-white/40">Modelo: gpt-4o-mini</p>
                </div>
              )}
              {settings.provider === "cerebras" && (
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-white/70">Chave Cerebras (cerebras.ai)</label>
                  <div className="relative">
                    <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
                    <input type="password" value={settings.cerebrasKey} onChange={(e) => dispatch({ type: "SET_CEREBRAS_KEY", payload: e.target.value })} placeholder="csk-•••" className="w-full rounded-2xl border border-white/10 bg-white/5 py-2.5 pl-10 pr-3 text-sm text-white placeholder:text-white/30 outline-none backdrop-blur-xl transition-all duration-300 focus:border-white/30 focus:bg-white/10" />
                  </div>
                  <p className="mt-1 text-[10px] text-white/40">Free Tier: 30 RPM • 60k TPM</p>
                </div>
              )}

            </div>
          </GlassCard>

          <Dialog>
            <DialogTrigger asChild>
              <button className="group relative w-full overflow-hidden rounded-3xl border border-white/15 bg-gradient-to-br from-indigo-500/20 via-fuchsia-500/15 to-rose-500/20 p-5 text-left backdrop-blur-2xl transition-all duration-300 hover:border-white/30 hover:shadow-[0_0_40px_-10px_rgba(168,85,247,0.6)]">
                <div className="absolute -right-8 -top-8 h-24 w-24 rounded-full bg-fuchsia-500/30 blur-2xl transition-all duration-500 group-hover:scale-125" />
                <div className="relative flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-400 to-fuchsia-500 shadow-[0_0_20px_-5px_rgba(168,85,247,0.8)]">
                    <Settings2 className="h-5 w-5 text-white" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-white">Configurar Prompts da IA</p>
                    <p className="text-xs text-white/60">Personalize as instruções de otimização</p>
                  </div>
                  <Wand2 className="h-4 w-4 text-white/60 transition-transform duration-300 group-hover:rotate-12 group-hover:text-white" />
                </div>
              </button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl border border-white/10 bg-slate-900/80 backdrop-blur-2xl text-white sm:rounded-[28px] shadow-[0_20px_80px_-20px_rgba(0,0,0,0.8)]">
              <div className="pointer-events-none absolute inset-0 rounded-[28px] bg-[radial-gradient(ellipse_at_top,rgba(99,102,241,0.25),transparent_60%),radial-gradient(ellipse_at_bottom_right,rgba(236,72,153,0.18),transparent_60%)]" />
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-white">
                  <Wand2 className="h-4 w-4 text-fuchsia-300" />
                  Engenharia de Prompts
                </DialogTitle>
                <DialogDescription className="text-white/60">
                  Defina como a IA deve reescrever os seus títulos e descrições.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-white/70">Prompt — Title</label>
                  <textarea
                    value={settings.titlePrompt}
                    onChange={(e) => dispatch({ type: "SET_TITLE_PROMPT", payload: e.target.value })}
                    rows={4}
                    className="w-full resize-none rounded-2xl border border-white/10 bg-white/5 p-3 text-xs text-white/90 outline-none backdrop-blur-xl transition-all duration-300 focus:border-white/30 focus:bg-white/10"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-white/70">Prompt — Description</label>
                  <textarea
                    value={settings.descPrompt}
                    onChange={(e) => dispatch({ type: "SET_DESC_PROMPT", payload: e.target.value })}
                    rows={4}
                    className="w-full resize-none rounded-2xl border border-white/10 bg-white/5 p-3 text-xs text-white/90 outline-none backdrop-blur-xl transition-all duration-300 focus:border-white/30 focus:bg-white/10"
                  />
                </div>
              </div>
              <DialogFooter className="gap-2 sm:gap-2">
                <button
                  onClick={() => dispatch({ type: "RESET_PROMPTS" })}
                  className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-medium text-white/80 backdrop-blur-xl transition-all duration-300 hover:bg-white/10"
                >
                  <RotateCcw className="h-3 w-3" />
                  Restaurar padrão
                </button>
                <DialogTrigger asChild>
                  <button className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-gradient-to-br from-indigo-400 to-fuchsia-500 px-5 py-2 text-xs font-semibold text-white shadow-[0_0_25px_-5px_rgba(168,85,247,0.7)] transition-all duration-300 hover:shadow-[0_0_35px_-5px_rgba(168,85,247,0.9)]">
                    Guardar prompts
                  </button>
                </DialogTrigger>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </aside>

        {/* Main */}
        <section className="space-y-6">
          {/* Upload zone */}
          <GlassCard className="p-6">
            <input ref={fileInputRef} type="file" accept=".csv" className="hidden" onChange={onFileChange} />
            {!fileName ? (
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={onDrop}
                className="group relative flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-white/15 bg-white/[0.02] px-6 py-12 text-center transition-all duration-300 hover:border-white/30 hover:bg-white/[0.05]"
              >
                <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-400/30 to-fuchsia-500/30 backdrop-blur-xl">
                  <Upload className="h-6 w-6 text-white" />
                </div>
                <p className="text-sm font-medium text-white/90">Arraste o seu ficheiro CSV ou clique para procurar</p>
                <p className="mt-1 text-xs text-white/50">Suporta ficheiros .csv até 10 MB</p>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="mt-5 rounded-full bg-white/10 px-4 py-2 text-xs font-medium text-white backdrop-blur-xl transition-all duration-300 hover:bg-white/20"
                >
                  Selecionar ficheiro
                </button>
              </div>
            ) : (
              <div className="flex items-center justify-between rounded-2xl border border-emerald-400/20 bg-emerald-400/5 px-4 py-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-400/20">
                    <FileText className="h-5 w-5 text-emerald-300" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-white">{fileName}</p>
                    <p className="text-xs text-white/50">{rows.length} URLs</p>
                  </div>
                </div>
                <button
                  onClick={clearFile}
                  className="flex h-8 w-8 items-center justify-center rounded-full bg-white/5 text-white/60 transition-all duration-300 hover:bg-white/10 hover:text-white"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            )}
          </GlassCard>

          {/* Data Grid */}
          <GlassCard className="overflow-hidden">
            <div className="flex flex-col gap-3 border-b border-white/5 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-sm font-semibold text-white/90">SERP DataGrid</h2>
                <p className="text-xs text-white/50">{fileName ? `${rows.length} linhas carregadas` : "Sem dados"}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {fileName && (
                  <>
                    <button
                      onClick={() => optimizeAll("title")}
                      className="liquid-glass-button inline-flex items-center gap-1.5 rounded-full border border-white/15 px-3.5 py-1.5 text-[11px] font-medium text-white"
                    >
                      <Wand2 className="h-3 w-3 text-fuchsia-200" />
                      Otimizar todos os Titles
                    </button>
                    <button
                      onClick={() => optimizeAll("description")}
                      className="liquid-glass-button inline-flex items-center gap-1.5 rounded-full border border-white/15 px-3.5 py-1.5 text-[11px] font-medium text-white"
                    >
                      <Wand2 className="h-3 w-3 text-indigo-200" />
                      Otimizar todas as Descriptions
                    </button>
                  </>
                )}
                <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[10px] uppercase tracking-wider text-white/60">
                  {PROVIDER_LABELS[settings.provider]}
                </span>
              </div>
            </div>

            {fileName ? (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="sticky top-0 bg-white/[0.04] backdrop-blur-2xl">
                      <tr className="text-[11px] uppercase tracking-wider text-white/50">
                        <th className="px-6 py-3 font-medium">URL</th>
                        <th className="px-6 py-3 font-medium">Titulo atual</th>
                        <th className="px-6 py-3 font-medium">Novo titulo</th>
                        <th className="px-6 py-3 font-medium">Descricao atual</th>
                        <th className="px-6 py-3 font-medium">Nova descricao</th>
                        <th className="px-6 py-3 text-right font-medium">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row, i) => (
                        <tr
                          key={row.id}
                          className={`border-t border-white/5 transition-colors duration-200 hover:bg-white/[0.03] ${i % 2 === 1 ? "bg-white/[0.015]" : ""}`}
                        >
                          <td className="max-w-[220px] px-6 py-4">
                            <span className="block truncate font-mono text-xs text-white/70">
                              {row.url.replace("https://", "")}
                            </span>
                          </td>
                          <td className="max-w-[220px] px-6 py-4">
                            <p className="line-clamp-2 text-xs text-white/70">{row.title}</p>
                            <CharCount value={row.title} max={60} />
                          </td>
                          <td className="max-w-[240px] px-6 py-4">
                            <p className={`line-clamp-2 text-xs ${row.newTitle ? "text-white/90" : "text-white/30"}`}>
                              {row.newTitle || "Ainda nao gerado"}
                            </p>
                            <CharCount value={row.newTitle ?? ""} max={60} />
                          </td>
                          <td className="max-w-[280px] px-6 py-4">
                            <p className="line-clamp-2 text-xs text-white/70">{row.description}</p>
                            <CharCount value={row.description} max={155} />
                          </td>
                          <td className="max-w-[300px] px-6 py-4">
                            <p className={`line-clamp-2 text-xs ${row.newDescription ? "text-white/90" : "text-white/30"}`}>
                              {row.newDescription || "Ainda nao gerada"}
                            </p>
                            <CharCount value={row.newDescription ?? ""} max={155} />
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex justify-end gap-1.5">
                              {/* Title optimize button — shows ✓ if already optimized */}
                              <button
                                disabled={row.loadingTitle}
                                onClick={() => optimizeRow(row.id, "title")}
                                title={row.optimizedTitle ? "Title otimizado ✓ (clique para re-otimizar)" : "Otimizar Title"}
                                className={`liquid-glass-button inline-flex h-7 w-7 items-center justify-center rounded-full border text-white disabled:opacity-70 ${
                                  row.optimizedTitle
                                    ? "border-emerald-400/30 bg-emerald-400/10"
                                    : "border-white/15"
                                }`}
                              >
                                {row.loadingTitle
                                  ? <Loader2 className="h-3 w-3 animate-spin" />
                                  : row.optimizedTitle
                                    ? <Check className="h-3 w-3 text-emerald-400" />
                                    : <Wand2 className="h-3 w-3 text-fuchsia-200" />
                                }
                              </button>
                              {/* Description optimize button — shows ✓ if already optimized */}
                              <button
                                disabled={row.loadingDesc}
                                onClick={() => optimizeRow(row.id, "description")}
                                title={row.optimizedDesc ? "Description otimizada ✓ (clique para re-otimizar)" : "Otimizar Description"}
                                className={`liquid-glass-button inline-flex h-7 w-7 items-center justify-center rounded-full border text-white disabled:opacity-70 ${
                                  row.optimizedDesc
                                    ? "border-emerald-400/30 bg-emerald-400/10"
                                    : "border-white/15"
                                }`}
                              >
                                {row.loadingDesc
                                  ? <Loader2 className="h-3 w-3 animate-spin" />
                                  : row.optimizedDesc
                                    ? <Check className="h-3 w-3 text-emerald-400" />
                                    : <Wand2 className="h-3 w-3 text-indigo-200" />
                                }
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex items-center justify-between border-t border-white/5 px-6 py-4">
                  <p className="text-xs text-white/50">
                    Pronto para exportar {rows.length} resultado{rows.length !== 1 ? "s" : ""}
                  </p>
                  <button
                    onClick={downloadCsv}
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
                  Importe um ficheiro CSV com os seus URLs para começar a otimizar os títulos e descrições.
                </p>
              </div>
            )}
          </GlassCard>
        </section>
      </main>
    </>
  );
}
