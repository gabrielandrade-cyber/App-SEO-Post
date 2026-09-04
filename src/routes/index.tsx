import { createFileRoute } from "@tanstack/react-router";
import { SerpOptimizer } from "@/components/serp-optimizer";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "SERP Optimizer | OPTMOS" },
      {
        name: "description",
        content:
          "Importe um CSV de URLs e gere meta titles e descriptions otimizados em lote, com justificativa e tom de voz da marca, usando a sua propria chave de IA.",
      },
    ],
  }),
  component: Index,
});

function Index() {
  return <SerpOptimizer />;
}
