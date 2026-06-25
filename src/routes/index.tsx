import { createFileRoute } from "@tanstack/react-router";
import { SerpOptimizer } from "@/components/serp-optimizer";

export const Route = createFileRoute("/")({ component: Index });

function Index() {
  return <SerpOptimizer />;
}
