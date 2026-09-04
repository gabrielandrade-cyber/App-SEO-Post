/**
 * Escalonador de lotes com faixas paralelas e commit em ordem.
 *
 * Puro (sem React, sem IndexedDB): quem chama injeta como buscar as linhas,
 * como enviar um lote e o que fazer quando ele volta. Isso permite testar a
 * logica de concorrencia isoladamente.
 *
 * Regras:
 *   - Ate `concurrency` lotes em voo ao mesmo tempo, com `launchDelayMs`
 *     entre lancamentos para segurar o RPM do provedor.
 *   - Cada lote e uma invocacao separada do Worker, entao os limites do
 *     Cloudflare (CPU, subrequests) valem por lote, nao pelo total em voo.
 *   - Resultados sao gravados assim que o lote volta (`onLaneSettled`), mas o
 *     indice de progresso so avanca pelo prefixo contiguo de lotes concluidos
 *     (`onCommit`). Se o lote 3 termina antes do 2, o indice espera o 2.
 *   - Status de pausa (chave, saldo, cota) interrompe novos lancamentos, deixa
 *     os lotes em voo terminarem e avanca o indice so ate a primeira linha sem
 *     resposta. Retomar depois nao reenvia linhas ja otimizadas (`shouldSkip`).
 *   - `stop()` aborta tudo que esta em voo e cancela a espera entre lancamentos.
 */

export interface PostOutcome<Body = unknown> {
  aborted: boolean;
  status: number;
  ok: boolean;
  body: Body;
}

export interface LaneResult {
  /** Ids que voltaram com resposta (com texto ou com erro explicito). */
  returnedIds: Set<number>;
  /** Quantas linhas voltaram com erro explicito. */
  errors: number;
}

export interface SchedulerOptions<Row extends { id: number }, Body = unknown> {
  total: number;
  startIndex: number;
  batchSize: number;
  concurrency: number;
  launchDelayMs: number;
  /** Statuses HTTP que devem pausar a fila (chave, saldo, cota). */
  pauseStatuses: number[];
  fetchRows(start: number, limit: number): Promise<Row[]>;
  /** Linhas que ja estao prontas e nao precisam ser reenviadas. */
  shouldSkip?(row: Row): boolean;
  post(rows: Row[], signal: AbortSignal): Promise<PostOutcome<Body>>;
  /** Grava o retorno de um lote imediatamente, em qualquer ordem. */
  onLaneSettled(rows: Row[], outcome: PostOutcome<Body>): Promise<LaneResult>;
  /** Progresso confirmado em ordem: `currentIndex` linhas concluidas. */
  onCommit(currentIndex: number, errorsSoFar: number): Promise<void>;
  onActiveRanges?(ranges: Array<{ start: number; end: number }>): void;
}

export interface SchedulerResult<Body = unknown> {
  currentIndex: number;
  errors: number;
  /** true quando `stop()` interrompeu o processamento. */
  stopped: boolean;
  /** Preenchido quando um lote voltou com status de pausa. */
  pause?: { status: number; body: Body };
}

export interface SchedulerHandle<Body = unknown> {
  done: Promise<SchedulerResult<Body>>;
  stop(): void;
}

interface Settled<Body> {
  start: number;
  windowLength: number;
  outcome: PostOutcome<Body> | null;
  aborted: boolean;
  leading: number;
  errors: number;
  pause?: { status: number; body: Body };
}

export function runBatchScheduler<Row extends { id: number }, Body = unknown>(
  options: SchedulerOptions<Row, Body>,
): SchedulerHandle<Body> {
  const {
    total,
    batchSize,
    concurrency,
    launchDelayMs,
    pauseStatuses,
    fetchRows,
    shouldSkip,
    post,
    onLaneSettled,
    onCommit,
    onActiveRanges,
  } = options;

  const controllers = new Set<AbortController>();
  const inFlight = new Map<number, Promise<void>>();
  const settled = new Map<number, Settled<Body>>();
  let stopped = false;
  let cancelSleep: (() => void) | null = null;

  const sleep = (ms: number) =>
    new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        cancelSleep = null;
        resolve();
      }, ms);
      cancelSleep = () => {
        clearTimeout(timer);
        cancelSleep = null;
        resolve();
      };
    });

  const publishRanges = () => {
    onActiveRanges?.(
      Array.from(inFlight.keys())
        .sort((a, b) => a - b)
        .map((start) => ({ start, end: Math.min(total, start + batchSize) })),
    );
  };

  const stop = () => {
    stopped = true;
    for (const controller of controllers) controller.abort();
    cancelSleep?.();
  };

  const runLane = async (start: number, signal: AbortSignal): Promise<Settled<Body>> => {
    const window = await fetchRows(start, batchSize);
    const skipped = new Set<number>();
    const rows = window.filter((row) => {
      const skip = Boolean(shouldSkip?.(row));
      if (skip) skipped.add(row.id);
      return !skip;
    });

    const base = { start, windowLength: window.length, aborted: false, errors: 0 };
    if (window.length === 0) return { ...base, outcome: null, leading: 0 };
    if (rows.length === 0) return { ...base, outcome: null, leading: window.length };
    if (signal.aborted) return { ...base, outcome: null, aborted: true, leading: 0 };

    const outcome = await post(rows, signal);
    if (outcome.aborted) return { ...base, outcome, aborted: true, leading: 0 };

    const result = await onLaneSettled(rows, outcome);
    let leading = 0;
    for (const row of window) {
      if (!skipped.has(row.id) && !result.returnedIds.has(row.id)) break;
      leading += 1;
    }

    const pause = pauseStatuses.includes(outcome.status)
      ? { status: outcome.status, body: outcome.body }
      : undefined;

    return { ...base, outcome, leading, errors: result.errors, pause };
  };

  /**
   * O resultado e registrado em `settled` dentro da propria promessa da faixa,
   * nao pelo `Promise.race` do loop principal: assim nada se perde quando
   * duas faixas terminam enquanto o loop dorme entre lancamentos.
   */
  const launch = (start: number) => {
    const controller = new AbortController();
    controllers.add(controller);

    const tracked = runLane(start, controller.signal)
      .then((lane) => {
        settled.set(start, lane);
      })
      .finally(() => {
        inFlight.delete(start);
        controllers.delete(controller);
        publishRanges();
      });

    inFlight.set(start, tracked);
    publishRanges();
  };

  const done = (async (): Promise<SchedulerResult<Body>> => {
    let currentIndex = options.startIndex;
    let nextStart = options.startIndex;
    let errors = 0;
    let pause: { status: number; body: Body } | undefined;

    const canLaunch = () => !stopped && !pause && nextStart < total && inFlight.size < concurrency;

    const commitContiguous = async () => {
      while (settled.has(currentIndex)) {
        const current = settled.get(currentIndex)!;
        settled.delete(currentIndex);

        if (current.windowLength === 0) {
          currentIndex = total;
          return;
        }
        if (current.aborted) {
          stopped = true;
          return;
        }
        if (current.pause) {
          currentIndex += current.leading;
          pause = current.pause;
          await onCommit(currentIndex, errors);
          return;
        }
        if (current.outcome && !current.outcome.ok) {
          const body = current.outcome.body as { error?: string } | null;
          throw new Error(
            body?.error || `Erro HTTP ${current.outcome.status} ao chamar o servidor.`,
          );
        }

        errors += current.errors;
        currentIndex += current.windowLength;
        await onCommit(currentIndex, errors);
      }
    };

    try {
      while (true) {
        while (canLaunch()) {
          launch(nextStart);
          nextStart += batchSize;
          if (canLaunch() && launchDelayMs > 0) await sleep(launchDelayMs);
        }

        await commitContiguous();

        if ((stopped || pause) && inFlight.size === 0) break;
        if (currentIndex >= total && inFlight.size === 0) break;
        if (settled.has(currentIndex)) continue;
        if (inFlight.size === 0) {
          if (canLaunch()) continue;
          break;
        }

        // Despertador: alguma faixa terminou. O resultado ja esta em `settled`.
        await Promise.race(inFlight.values());
      }
    } catch (err) {
      stop();
      await Promise.allSettled(inFlight.values());
      throw err;
    }

    return { currentIndex, errors, stopped, pause };
  })();

  return { done, stop };
}
