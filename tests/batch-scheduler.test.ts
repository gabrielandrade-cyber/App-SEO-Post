import { runBatchScheduler, type PostOutcome } from "../src/lib/batch-scheduler";

type Row = { id: number; done?: boolean };
const rows = (n: number): Row[] => Array.from({ length: n }, (_, i) => ({ id: i + 1 }));
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

function fetchFrom(all: Row[]) {
  return async (start: number, limit: number) => all.slice(start, start + limit);
}

let failures = 0;
function assert(cond: unknown, msg: string) {
  if (!cond) {
    failures += 1;
    console.log("  FALHOU:", msg);
  } else console.log("  ok:", msg);
}

async function test1() {
  console.log("1) 100 linhas, lote 20, 3 faixas, tudo certo");
  const all = rows(100);
  const commits: number[] = [];
  let maxInFlight = 0;
  let inFlight = 0;
  const h = runBatchScheduler<Row, { resultados: { id: number }[] }>({
    total: 100,
    startIndex: 0,
    batchSize: 20,
    concurrency: 3,
    launchDelayMs: 5,
    pauseStatuses: [401, 402, 403, 429],
    fetchRows: fetchFrom(all),
    post: async (batch) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await delay(10 + Math.random() * 40);
      inFlight -= 1;
      return {
        aborted: false,
        status: 200,
        ok: true,
        body: { resultados: batch.map((r) => ({ id: r.id })) },
      };
    },
    onLaneSettled: async (batch, outcome) => ({
      returnedIds: new Set(outcome.body.resultados.map((r) => r.id)),
      errors: 0,
    }),
    onCommit: async (idx) => {
      commits.push(idx);
    },
  });
  const r = await h.done;
  assert(r.currentIndex === 100, `indice final 100 (veio ${r.currentIndex})`);
  assert(maxInFlight === 3, `3 faixas em voo (max ${maxInFlight})`);
  assert(commits.join(",") === "20,40,60,80,100", `commits em ordem (${commits.join(",")})`);
  assert(!r.stopped && !r.pause, "sem parada nem pausa");
}

async function test2() {
  console.log(
    "2) lote que comeca em 40 volta 429 com 5 resultados; lotes seguintes ja em voo terminam",
  );
  const all = rows(100);
  const applied: number[] = [];
  let commitsAfterPause = 0;
  const h = runBatchScheduler<Row, { resultados: { id: number }[]; error?: string }>({
    total: 100,
    startIndex: 0,
    batchSize: 20,
    concurrency: 3,
    launchDelayMs: 0,
    pauseStatuses: [401, 402, 403, 429],
    fetchRows: fetchFrom(all),
    post: async (batch) => {
      await delay(batch[0].id === 41 ? 30 : 10);
      if (batch[0].id === 41) {
        return {
          aborted: false,
          status: 429,
          ok: false,
          body: { resultados: batch.slice(0, 5).map((r) => ({ id: r.id })), error: "cota" },
        };
      }
      return {
        aborted: false,
        status: 200,
        ok: true,
        body: { resultados: batch.map((r) => ({ id: r.id })) },
      };
    },
    onLaneSettled: async (batch, outcome) => {
      applied.push(batch[0].id);
      return { returnedIds: new Set(outcome.body.resultados.map((r) => r.id)), errors: 0 };
    },
    onCommit: async (idx) => {
      if (idx > 45) commitsAfterPause += 1;
    },
  });
  const r = await h.done;
  assert(r.pause?.status === 429, "pausa por 429");
  assert(r.currentIndex === 45, `indice parou em 45 (veio ${r.currentIndex})`);
  assert(applied.includes(61), "lote 61-80 que ja estava em voo foi gravado mesmo assim");
  assert(commitsAfterPause === 0, "nenhum commit alem do ponto de pausa");
}

async function test3() {
  console.log("3) stop() no meio aborta faixas em voo e nao avanca o indice");
  const all = rows(100);
  const h = runBatchScheduler<Row, { resultados: { id: number }[] }>({
    total: 100,
    startIndex: 0,
    batchSize: 20,
    concurrency: 2,
    launchDelayMs: 0,
    pauseStatuses: [429],
    fetchRows: fetchFrom(all),
    post: async (batch, signal) => {
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, batch[0].id === 1 ? 10 : 200);
        signal.addEventListener("abort", () => {
          clearTimeout(t);
          resolve();
        });
      });
      if (signal.aborted) return { aborted: true, status: 0, ok: false, body: { resultados: [] } };
      return {
        aborted: false,
        status: 200,
        ok: true,
        body: { resultados: batch.map((r) => ({ id: r.id })) },
      };
    },
    onLaneSettled: async (batch, outcome) => ({
      returnedIds: new Set(outcome.body.resultados.map((r) => r.id)),
      errors: 0,
    }),
    onCommit: async () => {},
  });
  setTimeout(() => h.stop(), 60);
  const r = await h.done;
  assert(r.stopped, "marcado como parado");
  assert(r.currentIndex === 20, `so o primeiro lote commitado (veio ${r.currentIndex})`);
}

async function test4() {
  console.log("4) retomada pula linhas ja otimizadas e conta janelas vazias");
  const all = rows(50).map((r) => ({ ...r, done: r.id <= 30 || r.id === 35 }));
  const posted: number[][] = [];
  const h = runBatchScheduler<Row, { resultados: { id: number }[] }>({
    total: 50,
    startIndex: 20,
    batchSize: 10,
    concurrency: 2,
    launchDelayMs: 0,
    pauseStatuses: [429],
    fetchRows: fetchFrom(all),
    shouldSkip: (row) => Boolean(row.done),
    post: async (batch) => {
      posted.push(batch.map((r) => r.id));
      await delay(5);
      return {
        aborted: false,
        status: 200,
        ok: true,
        body: { resultados: batch.map((r) => ({ id: r.id })) },
      };
    },
    onLaneSettled: async (batch, outcome) => ({
      returnedIds: new Set(outcome.body.resultados.map((r) => r.id)),
      errors: 0,
    }),
    onCommit: async () => {},
  });
  const r = await h.done;
  assert(r.currentIndex === 50, `indice final 50 (veio ${r.currentIndex})`);
  const sent = posted.flat().sort((a, b) => a - b);
  assert(!sent.includes(25) && !sent.includes(35), "linhas ja prontas nao foram reenviadas");
  assert(sent.length === 19, `19 linhas enviadas (veio ${sent.length})`);
}

async function test5() {
  console.log("5) erro de servidor derruba a fila e aborta o resto");
  const all = rows(60);
  const h = runBatchScheduler<Row, { error?: string; resultados?: { id: number }[] }>({
    total: 60,
    startIndex: 0,
    batchSize: 20,
    concurrency: 3,
    launchDelayMs: 0,
    pauseStatuses: [429],
    fetchRows: fetchFrom(all),
    post: async (batch) => {
      await delay(10);
      if (batch[0].id === 1)
        return { aborted: false, status: 500, ok: false, body: { error: "boom" } };
      return {
        aborted: false,
        status: 200,
        ok: true,
        body: { resultados: batch.map((r) => ({ id: r.id })) },
      };
    },
    onLaneSettled: async (batch, outcome) => ({
      returnedIds: new Set((outcome.body.resultados ?? []).map((r) => r.id)),
      errors: 0,
    }),
    onCommit: async () => {},
  });
  let threw = "";
  try {
    await h.done;
  } catch (e) {
    threw = (e as Error).message;
  }
  assert(threw === "boom", `erro propagado (${threw})`);
}

(async () => {
  await test1();
  await test2();
  await test3();
  await test4();
  await test5();
  console.log(failures === 0 ? "\nTODOS OS TESTES PASSARAM" : `\n${failures} FALHA(S)`);
  process.exit(failures === 0 ? 0 : 1);
})();
