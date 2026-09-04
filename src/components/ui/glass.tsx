import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Superficies do Liquid Glass. Fonte unica para todos os cards e pilulas.
 * As camadas (blur, tint, fio interno, glare, lente) vivem em `styles.css`
 * nas classes `.lg*`; aqui so se escolhe a variante.
 *
 * Variantes (segue a hierarquia da Apple: vidro forte nos controles e na
 * navegacao, vidro fino na camada de conteudo):
 * - `control`: vidro completo com lente nas bordas. Painel de provedor,
 *   dialogs, cards de destaque. Mais caro; usar em poucos elementos.
 * - `panel` (padrao): vidro regular, um pouco mais opaco, sem lente.
 * - `content`: vidro fino para grandes areas de dados (a grade de SERP).
 */
export type GlassVariant = "control" | "panel" | "content";

const VARIANT_CLASS: Record<GlassVariant, string> = {
  control: "lg lg-lens",
  panel: "lg lg-panel",
  content: "lg lg-content",
};

export function GlassCard({
  children,
  className,
  variant,
  distort = false,
  as: Tag = "div",
}: {
  children: ReactNode;
  className?: string;
  variant?: GlassVariant;
  /** Atalho para `variant="control"` (mantido por compatibilidade). */
  distort?: boolean;
  as?: "div" | "section" | "aside" | "article";
}) {
  const resolved: GlassVariant = variant ?? (distort ? "control" : "panel");
  return (
    <Tag className={cn("rounded-3xl p-6", VARIANT_CLASS[resolved], className)}>{children}</Tag>
  );
}

/** Pilula de vidro para grupos de navegacao e badges. */
export function GlassPill({
  children,
  className,
  lens = true,
}: {
  children: ReactNode;
  className?: string;
  lens?: boolean;
}) {
  return (
    <div className={cn("lg lg-pill flex items-center p-1", lens && "lg-lens", className)}>
      {children}
    </div>
  );
}

/** Orbe de luz decorativa (blur grande), usada atras de cards de destaque. */
export function GlowOrb({
  className,
  color = "indigo",
}: {
  className?: string;
  color?: "indigo" | "fuchsia" | "emerald" | "cyan" | "amber";
}) {
  const tone = {
    indigo: "bg-indigo-500/15 group-hover:bg-indigo-500/25",
    fuchsia: "bg-fuchsia-500/15 group-hover:bg-fuchsia-500/25",
    emerald: "bg-emerald-500/15 group-hover:bg-emerald-500/25",
    cyan: "bg-cyan-500/15 group-hover:bg-cyan-500/25",
    amber: "bg-amber-500/15 group-hover:bg-amber-500/25",
  }[color];

  return (
    <div
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute h-64 w-64 rounded-full blur-3xl transition-all duration-700",
        tone,
        className,
      )}
    />
  );
}
