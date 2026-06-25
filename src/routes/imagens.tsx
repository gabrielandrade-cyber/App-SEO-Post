import { createFileRoute } from "@tanstack/react-router";
import { ImageOptimizer } from "@/components/image-optimizer";

export const Route = createFileRoute("/imagens")({
  component: ImagensHub,
});

function ImagensHub() {
  return <ImageOptimizer />;
}
