/**
 * Fila de otimizacao em lote do SERP Optimizer.
 *
 * Le as linhas do IndexedDB em janelas, envia cada lote para
 * `POST /api/optimize-batch` (ate `concurrency` lotes em voo por provedor,
 * ver `src/lib/providers.ts`), grava o retorno e persiste o indice corrente
 * para permitir pausa e retomada entre sessoes. A concorrencia e o commit em
 * ordem ficam em `src/lib/batch-scheduler.ts`.
 *
 * Garantias:
 *   - Pausar aborta as requisicoes em voo e a espera entre lancamentos.
 *     Retomar enquanto o loop anterior ainda esta saindo espera por ele.
 *   - Toda linha do lote recebe resultado ou erro: nada avanca em silencio.
 *   - 429/402/401/403 salvam o que ja veio, avancam o indice so pelas linhas
 *     que deram certo e pausam a fila com uma mensagem especifica.
 *   - Retomar nao reenvia linhas ja otimizadas (idempotente). "Rodar de novo"
 *     e a unica acao que reprocessa tudo.
 *   - Estado "running" preso de uma sessao anterior (F5 no meio) e convertido
 *     em "paused" ao recarregar.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { runBatchScheduler, type PostOutcome, type SchedulerHandle } from "@/lib/batch-scheduler";
import {
  countRowsOutOfRange,
  countRowsWithErrors,
  getBatchRows,
  getCsvMeta,
  getQueueState,
  getRowsOutOfRange,
  getRowsWithErrors,
  setQueueState,
  updateCsvRows,
  type QueueStatus,
} from "@/lib/db";
import { PROVIDER_META, type AIProvider } from "@/lib/providers";
import { accessTokenHeader } from "@/lib/server-auth";
import type { CsvRow } from "@/lib/store";

export type PauseKind = "quota" | "billing" | "auth" | "manual";

export interface UseBatchQueueOptions {
  apiKey: string;
  provider: AIProvider;
  brandPersona?: string;
  accessToken?: string;
  onRowsChanged?: () => void;
  onPaused?: (message: string, kind: PauseKind) => void;
}

interface BatchResponseBody {
  resultados?: Array<Partial<CsvRow> & Pick<CsvRow, "id">>;
  error?: string;
  modelUsed?: string;
}

export interface ActiveRange {
  start: number;
  end: number;
}

const PAUSE_STATUSES = [401, 402, 403, 429];
const ROW_MISSING_ERROR = "Sem resposta da IA para esta linha. Use Reprocessar erros.";

function pauseMessageFor(
  status: number,
  provider: AIProvider,
  detail?: string,
): { message: string; kind: PauseKind } {
  const label = PROVIDER_META[provider].label;
  if (status === 401 || status === 403) {
    return {
      kind: "auth",
      message:
        detail ||
        `A chave do ${label} foi recusada. Corrija a chave no painel e clique em Retomar para continuar de onde parou.`,
    };
  }
  if (status === 402) {
    return {
      kind: "billing",
      message:
        detail ||
        `A conta do ${label} esta sem saldo. Adicione creditos ou troque de provedor e clique em Retomar.`,
    };
  }
  return {
    kind: "quota",
    message:
      detail ||
      `O ${label} atingiu o limite de requisicoes ou a cota. Aguarde alguns minutos, ou troque a chave ou o provedor, e clique em Retomar.`,
  };
}

/** Linha que ja tem os dois textos e nenhum erro: nao precisa ser reenviada. */
function isRowComplete(row: CsvRow): boolean {
  return Boolean(row.newTitle && row.newDescription && !row.optimizationError);
}

export function useBatchQueue(options: UseBatchQueueOptions) {
  const [status, setStatus] = useState<QueueStatus>("idle");
  const [processed, setProcessed] = useState(0);
  const [total, setTotal] = useState(0);
  const [lastError, setLastError] = useState<string | null>(null);
  const [errorCount, setErrorCount] = useState(0);
  const [outOfRangeCount, setOutOfRangeCount] = useState(0);
  const [activeRanges, setActiveRanges] = useState<ActiveRange[]>([]);
  const [isRetrying, setIsRetrying] = useState(false);

  const optionsRef = useRef(options);
  optionsRef.current = options;

  const schedulerRef = useRef<SchedulerHandle<BatchResponseBody> | null>(null);
  const loopRef = useRef<Promise<void> | null>(null);

  const refreshState = useCallback(async () => {
    const [meta, queue] = await Promise.all([getCsvMeta(), getQueueState()]);
    let effective = queue;

    // "running" salvo por uma sessao que morreu no meio de um lote.
    if (queue.status === "running" && !loopRef.current) {
      effective = await setQueueState({ status: "paused" });
    }

    setTotal(meta.rowCount);
    setProcessed(effective.currentIndex);
    setStatus(effective.status);
    setLastError(effective.lastError ?? null);
    setErrorCount(effective.errorCount ?? (await countRowsWithErrors()));
    setOutOfRangeCount(await countRowsOutOfRange());
  }, []);

  useEffect(() => {
    void refreshState();
  }, [refreshState]);

  const postBatch = useCallback(
    async (rows: CsvRow[], signal: AbortSignal): Promise<PostOutcome<BatchResponseBody>> => {
      const { apiKey, provider, brandPersona, accessToken } = optionsRef.current;

      try {
        const response = await fetch("/api/optimize-batch", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...accessTokenHeader(accessToken) },
          signal,
          body: JSON.stringify({
            apiKey,
            provider,
            brandPersona,
            batch: rows.map((row) => ({
              id: row.id,
              url: row.url,
              title: row.title,
              description: row.description,
            })),
          }),
        });
        const body = (await response.json().catch(() => ({}))) as BatchResponseBody;
        return { aborted: false, status: response.status, ok: response.ok, body };
      } catch (err) {
        if (signal.aborted) return { aborted: true, status: 0, ok: false, body: {} };
        throw err;
      }
    },
    [],
  );

  /**
   * Grava o retorno de um lote assim que ele chega. Linhas sem resposta so
   * sao marcadas com erro quando o lote foi aceito (200); num status de pausa
   * elas ficam intactas para a retomada.
   */
  const applyLane = useCallback(async (rows: CsvRow[], outcome: PostOutcome<BatchResponseBody>) => {
    const resultados = outcome.body.resultados ?? [];
    const returnedIds = new Set(resultados.map((item) => item.id));
    const missing = rows.filter((row) => !returnedIds.has(row.id));
    const markMissing = outcome.ok;

    const updates = [...resultados];
    if (markMissing) {
      updates.push(...missing.map((row) => ({ id: row.id, optimizationError: ROW_MISSING_ERROR })));
    }
    if (updates.length > 0) await updateCsvRows(updates);
    if (markMissing) for (const row of missing) returnedIds.add(row.id);

    const errors =
      resultados.filter((item) => item.optimizationError).length +
      (markMissing ? missing.length : 0);

    optionsRef.current.onRowsChanged?.();
    return { returnedIds, errors };
  }, []);

  const loop = useCallback(
    async (restart: boolean) => {
      setLastError(null);
      const provider = optionsRef.current.provider;
      const meta = PROVIDER_META[provider];

      try {
        const csvMeta = await getCsvMeta();
        const queue = await getQueueState();
        const startIndex = restart || queue.status === "done" ? 0 : queue.currentIndex;
        const baseErrors = restart ? 0 : (queue.errorCount ?? 0);

        setTotal(csvMeta.rowCount);
        setProcessed(startIndex);
        setStatus("running");
        await setQueueState({
          status: "running",
          currentIndex: startIndex,
          lastError: undefined,
          errorCount: baseErrors,
        });

        const handle = runBatchScheduler<CsvRow, BatchResponseBody>({
          total: csvMeta.rowCount,
          startIndex,
          batchSize: meta.batchSize,
          concurrency: meta.concurrency,
          launchDelayMs: meta.batchDelayMs,
          pauseStatuses: PAUSE_STATUSES,
          fetchRows: getBatchRows,
          shouldSkip: restart ? undefined : isRowComplete,
          post: postBatch,
          onLaneSettled: applyLane,
          onCommit: async (currentIndex, errorsSoFar) => {
            const totalErrors = baseErrors + errorsSoFar;
            await setQueueState({ status: "running", currentIndex, errorCount: totalErrors });
            setProcessed(currentIndex);
            setErrorCount(totalErrors);
          },
          onActiveRanges: setActiveRanges,
        });
        schedulerRef.current = handle;

        const result = await handle.done;
        const totalErrors = baseErrors + result.errors;

        if (result.pause) {
          const { message, kind } = pauseMessageFor(
            result.pause.status,
            provider,
            result.pause.body.error,
          );
          await setQueueState({
            status: "paused",
            currentIndex: result.currentIndex,
            lastError: message,
            errorCount: totalErrors,
          });
          setProcessed(result.currentIndex);
          setLastError(message);
          setStatus("paused");
          optionsRef.current.onPaused?.(message, kind);
          return;
        }

        if (result.stopped || result.currentIndex < csvMeta.rowCount) {
          await setQueueState({
            status: "paused",
            currentIndex: result.currentIndex,
            errorCount: totalErrors,
          });
          setProcessed(result.currentIndex);
          setStatus("paused");
          return;
        }

        const note =
          totalErrors > 0 ? `${totalErrors} linha(s) com erro. Use Reprocessar erros.` : undefined;
        await setQueueState({
          status: "done",
          currentIndex: csvMeta.rowCount,
          errorCount: totalErrors,
          lastError: note,
        });
        setProcessed(csvMeta.rowCount);
        setLastError(note ?? null);
        setStatus("done");
        setOutOfRangeCount(await countRowsOutOfRange());
      } catch (err) {
        const message = err instanceof Error ? err.message : "Erro inesperado na fila.";
        const queue = await getQueueState();
        await setQueueState({
          status: "error",
          currentIndex: queue.currentIndex,
          lastError: message,
        });
        setLastError(message);
        setStatus("error");
      } finally {
        schedulerRef.current = null;
        setActiveRanges([]);
        optionsRef.current.onRowsChanged?.();
      }
    },
    [applyLane, postBatch],
  );

  const run = useCallback(
    async (opts: { restart?: boolean } = {}) => {
      if (loopRef.current) {
        // Um loop anterior ainda esta terminando (pausa em voo): espera por ele.
        schedulerRef.current?.stop();
        await loopRef.current;
      }

      const promise = loop(Boolean(opts.restart));
      loopRef.current = promise;
      try {
        await promise;
      } finally {
        if (loopRef.current === promise) loopRef.current = null;
      }
    },
    [loop],
  );

  const pause = useCallback(async () => {
    schedulerRef.current?.stop();
    setStatus("paused");
    if (loopRef.current) await loopRef.current;
    else await setQueueState({ status: "paused" });
  }, []);

  const resume = useCallback(() => run(), [run]);

  /**
   * Reprocessa um subconjunto de linhas (com erro, ou fora da faixa de
   * caracteres) sem mexer no indice da fila. Devolve quantas continuam
   * pendentes depois da rodada.
   */
  const retryRows = useCallback(
    async (kind: "errors" | "out-of-range") => {
      if (loopRef.current || isRetrying) return;
      const rows = kind === "errors" ? await getRowsWithErrors() : await getRowsOutOfRange();
      if (rows.length === 0) return 0;

      const provider = optionsRef.current.provider;
      const meta = PROVIDER_META[provider];
      const previousStatus = (await getQueueState()).status;

      setIsRetrying(true);
      setStatus("running");

      try {
        const handle = runBatchScheduler<CsvRow, BatchResponseBody>({
          total: rows.length,
          startIndex: 0,
          batchSize: meta.batchSize,
          concurrency: meta.concurrency,
          launchDelayMs: meta.batchDelayMs,
          pauseStatuses: PAUSE_STATUSES,
          fetchRows: async (start, limit) => rows.slice(start, start + limit),
          post: postBatch,
          onLaneSettled: applyLane,
          onCommit: async () => {},
          onActiveRanges: (ranges) =>
            setActiveRanges(
              ranges.map(({ start, end }) => ({
                start: rows[start].id - 1,
                end: rows[Math.min(end, rows.length) - 1].id,
              })),
            ),
        });
        schedulerRef.current = handle;

        const result = await handle.done;
        if (result.pause) {
          const { message, kind: pauseKind } = pauseMessageFor(
            result.pause.status,
            provider,
            result.pause.body.error,
          );
          setLastError(message);
          optionsRef.current.onPaused?.(message, pauseKind);
        }
      } catch (err) {
        setLastError(err instanceof Error ? err.message : "Erro inesperado ao reprocessar.");
      } finally {
        schedulerRef.current = null;
        const errors = await countRowsWithErrors();
        const outOfRange = await countRowsOutOfRange();
        const restored = previousStatus === "running" ? "paused" : previousStatus;
        await setQueueState({ status: restored, errorCount: errors });
        setErrorCount(errors);
        setOutOfRangeCount(outOfRange);
        setStatus(restored);
        setActiveRanges([]);
        setIsRetrying(false);
        if (errors === 0) setLastError(null);
        optionsRef.current.onRowsChanged?.();
      }

      return kind === "errors" ? countRowsWithErrors() : countRowsOutOfRange();
    },
    [applyLane, isRetrying, postBatch],
  );

  const retryErrors = useCallback(() => retryRows("errors"), [retryRows]);
  const retryOutOfRange = useCallback(() => retryRows("out-of-range"), [retryRows]);

  return useMemo(
    () => ({
      status,
      processed,
      total,
      lastError,
      errorCount,
      outOfRangeCount,
      activeRanges,
      isRetrying,
      progress: total > 0 ? Math.round((processed / total) * 100) : 0,
      run,
      pause,
      resume,
      retryErrors,
      retryOutOfRange,
      refreshState,
    }),
    [
      status,
      processed,
      total,
      lastError,
      errorCount,
      outOfRangeCount,
      activeRanges,
      isRetrying,
      run,
      pause,
      resume,
      retryErrors,
      retryOutOfRange,
      refreshState,
    ],
  );
}

export type BatchQueue = ReturnType<typeof useBatchQueue>;
