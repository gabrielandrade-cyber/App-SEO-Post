import { createRouter, useRouter } from "@tanstack/react-router";
import { AlertTriangle } from "lucide-react";
import { routeTree } from "./routeTree.gen";

function DefaultErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  const router = useRouter();

  return (
    <main className="px-4 pb-20 pt-16">
      <div className="lg lg-lens mx-auto max-w-md rounded-3xl p-8 text-center">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl border border-rose-300/25 bg-rose-400/10">
          <AlertTriangle className="h-7 w-7 text-rose-300" />
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-white">Algo deu errado</h1>
        <p className="mt-2 text-sm text-white/60">
          Ocorreu um erro inesperado. Tente novamente ou volte para o inicio.
        </p>
        {error.message && (
          <pre className="mt-4 max-h-40 overflow-auto rounded-xl border border-white/10 bg-black/30 p-3 text-left font-mono text-xs text-rose-200">
            {error.message}
          </pre>
        )}
        <div className="mt-6 flex items-center justify-center gap-3">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="liquid-glass-button inline-flex items-center justify-center rounded-full border border-emerald-300/30 px-5 py-2 text-sm font-medium text-white"
          >
            Tentar de novo
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-full border border-white/10 bg-white/5 px-5 py-2 text-sm font-medium text-white/80 transition-colors hover:bg-white/10 hover:text-white"
          >
            Ir para o inicio
          </a>
        </div>
      </div>
    </main>
  );
}

export const getRouter = () => {
  return createRouter({
    routeTree,
    context: {},
    scrollRestoration: true,
    defaultPreload: "intent",
    defaultPreloadStaleTime: 0,
    defaultErrorComponent: DefaultErrorComponent,
  });
};
