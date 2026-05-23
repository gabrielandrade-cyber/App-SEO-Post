import { useCallback, useEffect, useRef, useState } from "react";
import {
  getBatchRows,
  getCsvMeta,
  getQueueState,
  setQueueState,
  updateCsvRows,
  type QueueStatus,
} from "@/lib/db";
import type { CsvRow } from "@/lib/store";

const DEFAULT_BATCH_SIZE = 20;
const BATCH_DELAY_MS = 1000;

interface BatchResponse {
  resultados?: Array<Partial<CsvRow> & Pick<CsvRow, "id">>;
  error?: string;
}

interface UseBatchQueueOptions {
  apiKey: string;
  model: string;
  batchSize?: number;
  onRowsChanged?: () => void;
  onPaused?: (message: string) => void;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function toPayloadRow(row: CsvRow) {
  return {
    id: row.id,
    url: row.url,
    title: row.title,
    description: row.description,
  };
}

export function useBatchQueue({
  apiKey,
  model,
  batchSize = DEFAULT_BATCH_SIZE,
  onRowsChanged,
  onPaused,
}: UseBatchQueueOptions) {
  const [status, setStatus] = useState<QueueStatus>("idle");
  const [processed, setProcessed] = useState(0);
  const [total, setTotal] = useState(0);
  const [lastError, setLastError] = useState<string | null>(null);
  const stopRef = useRef(false);
  const runningRef = useRef(false);

  const refreshState = useCallback(async () => {
    const [meta, queue] = await Promise.all([getCsvMeta(), getQueueState()]);
    setTotal(meta.rowCount);
    setProcessed(queue.currentIndex);
    setStatus(queue.status);
    setLastError(queue.lastError ?? null);
  }, []);

  useEffect(() => {
    void refreshState();
  }, [refreshState]);

  const pause = useCallback(async () => {
    stopRef.current = true;
    const queue = await getQueueState();
    await setQueueState({ status: "paused", currentIndex: queue.currentIndex });
    setStatus("paused");
  }, []);

  const run = useCallback(async () => {
    if (runningRef.current) return;

    runningRef.current = true;
    stopRef.current = false;
    setLastError(null);

    try {
      const meta = await getCsvMeta();
      let queue = await getQueueState();
      let currentIndex = queue.status === "done" ? 0 : queue.currentIndex;

      setTotal(meta.rowCount);
      setProcessed(currentIndex);
      setStatus("running");
      await setQueueState({ status: "running", currentIndex, lastError: undefined });

      while (currentIndex < meta.rowCount) {
        if (stopRef.current) {
          await setQueueState({ status: "paused", currentIndex });
          setStatus("paused");
          return;
        }

        const batch = await getBatchRows(currentIndex, batchSize);
        if (batch.length === 0) break;

        const response = await fetch("/api/optimize-batch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            apiKey,
            model,
            batch: batch.map(toPayloadRow),
          }),
        });

        const data = (await response.json().catch(() => ({}))) as BatchResponse;

        if (response.status === 429 || response.status === 402) {
          const message =
            "A API atingiu o limite ou ficou sem saldo. A fila foi pausada. Insira uma nova Chave API ou aguarde e clique em 'Retomar'.";
          await setQueueState({ status: "paused", currentIndex, lastError: message });
          setLastError(message);
          setStatus("paused");
          onPaused?.(message);
          return;
        }

        if (!response.ok) {
          throw new Error(data.error || `Erro HTTP ${response.status}`);
        }

        await updateCsvRows(data.resultados ?? []);
        currentIndex += batch.length;
        queue = await setQueueState({ status: "running", currentIndex });
        setProcessed(queue.currentIndex);
        onRowsChanged?.();

        await sleep(BATCH_DELAY_MS);
      }

      await setQueueState({ status: "done", currentIndex: meta.rowCount });
      setProcessed(meta.rowCount);
      setStatus("done");
      onRowsChanged?.();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erro inesperado na fila.";
      const queue = await getQueueState();
      await setQueueState({ status: "error", currentIndex: queue.currentIndex, lastError: message });
      setLastError(message);
      setStatus("error");
    } finally {
      runningRef.current = false;
    }
  }, [apiKey, batchSize, model, onPaused, onRowsChanged]);

  const resume = useCallback(() => run(), [run]);

  return {
    status,
    processed,
    total,
    lastError,
    progress: total > 0 ? Math.round((processed / total) * 100) : 0,
    run,
    pause,
    resume,
    refreshState,
  };
}
