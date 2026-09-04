import { createFileRoute } from "@tanstack/react-router";
import { ImageOptimizer } from "@/components/image-optimizer";

export const Route = createFileRoute("/imagens")({
  head: () => ({
    meta: [
      { title: "Image Optimizer | OPTMOS" },
      {
        name: "description",
        content:
          "Converta imagens para WebP no navegador e gere nomes de arquivo e alt texts otimizados para SEO com visao computacional.",
      },
    ],
  }),
  component: ImagensHub,
});

function ImagensHub() {
  return <ImageOptimizer />;
}
