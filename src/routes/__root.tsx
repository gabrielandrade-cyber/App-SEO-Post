import {
  Outlet,
  Link,
  createRootRoute,
  HeadContent,
  Scripts,
  useRouterState,
} from "@tanstack/react-router";
import { Toaster } from "@/components/ui/sonner";
import { GlassCard, GlassPill } from "@/components/ui/glass";
import { BookOpen, LayoutDashboard, ImageIcon, TextSearch } from "lucide-react";

import appCss from "../styles.css?url";
import { SettingsProvider } from "../lib/store";

function NotFoundComponent() {
  return (
    <main className="px-4 pb-20 pt-16">
      <GlassCard className="mx-auto max-w-md text-center" distort>
        <p className="text-6xl font-extrabold tracking-tight text-white">404</p>
        <h2 className="mt-3 text-xl font-semibold text-white">Pagina nao encontrada</h2>
        <p className="mt-2 text-sm text-white/60">
          O endereco que voce abriu nao existe ou foi movido.
        </p>
        <Link
          to="/"
          className="liquid-glass-button mt-6 inline-flex items-center gap-2 rounded-full border border-white/15 px-5 py-2 text-sm font-medium text-white"
        >
          Voltar ao SERP Optimizer
        </Link>
      </GlassCard>
    </main>
  );
}

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "OPTMOS" },
      {
        name: "description",
        content:
          "Hub de ferramentas de SEO com IA: meta titles e descriptions em lote a partir de CSV, e imagens WebP com alt text. Bring Your Own Key.",
      },
      { name: "author", content: "Gabriel Andrade" },
      { property: "og:title", content: "OPTMOS" },
      {
        property: "og:description",
        content: "Otimizacao de SERP e de imagens com a sua propria chave de IA.",
      },
      { property: "og:type", content: "website" },
      { property: "og:locale", content: "pt_BR" },
      { name: "twitter:card", content: "summary" },
    ],
    links: [
      { rel: "icon", href: "/logo.svg" },
      { rel: "stylesheet", href: appCss },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className="dark">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

/**
 * Mapa de deslocamento em gradiente para feDisplacementMap. Valor 128 = sem
 * deslocamento; a faixa `band` (fracao da dimensao) vai de 0 ate 128 numa
 * borda e de 128 ate 255 na oposta. Com color-interpolation-filters="sRGB"
 * os valores sao lidos como estao (em linearRGB 128 viraria ~0.22 e o mapa
 * deslocaria a superficie inteira).
 */
function lensMap(axis: "x" | "y", band: number): string {
  const [x2, y2] = axis === "x" ? ["1", "0"] : ["0", "1"];
  const color = (value: number) =>
    axis === "x" ? `rgb(${value},128,128)` : `rgb(128,${value},128)`;
  const stops = [
    `<stop offset='0' stop-color='${color(0)}'/>`,
    `<stop offset='${band}' stop-color='${color(128)}'/>`,
    `<stop offset='${1 - band}' stop-color='${color(128)}'/>`,
    `<stop offset='1' stop-color='${color(255)}'/>`,
  ].join("");
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='256' height='256' preserveAspectRatio='none'>` +
    `<defs><linearGradient id='g' x1='0' y1='0' x2='${x2}' y2='${y2}'>${stops}</linearGradient></defs>` +
    `<rect width='256' height='256' fill='url(#g)'/></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function LensFilter({
  id,
  bandX,
  bandY,
  scale,
}: {
  id: string;
  bandX: number;
  bandY: number;
  scale: number;
}) {
  return (
    <filter id={id} x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
      <feImage
        href={lensMap("x", bandX)}
        x="0"
        y="0"
        width="100%"
        height="100%"
        preserveAspectRatio="none"
        result="mapX"
      />
      <feDisplacementMap
        in="SourceGraphic"
        in2="mapX"
        scale={scale}
        xChannelSelector="R"
        yChannelSelector="B"
        result="bentX"
      />
      <feImage
        href={lensMap("y", bandY)}
        x="0"
        y="0"
        width="100%"
        height="100%"
        preserveAspectRatio="none"
        result="mapY"
      />
      <feDisplacementMap
        in="bentX"
        in2="mapY"
        scale={scale}
        xChannelSelector="B"
        yChannelSelector="G"
      />
    </filter>
  );
}

function NavPill({
  to,
  active,
  icon: Icon,
  children,
  compact = false,
}: {
  to: string;
  active: boolean;
  icon: typeof TextSearch;
  children: React.ReactNode;
  compact?: boolean;
}) {
  return (
    <Link
      to={to}
      className={`flex items-center gap-2 rounded-full font-medium transition-all duration-300 ${
        compact ? "px-4 py-1.5 text-xs" : "px-5 py-2 text-sm"
      } ${
        active
          ? "bg-white/10 text-white shadow-[0_0_15px_-5px_rgba(255,255,255,0.35),inset_0_1px_0_0_rgba(255,255,255,0.12)]"
          : "text-white/60 hover:bg-white/[0.05] hover:text-white"
      }`}
    >
      <Icon className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} />
      <span className="hidden sm:inline">{children}</span>
    </Link>
  );
}

function RootComponent() {
  const currentPath = useRouterState({ select: (state) => state.location.pathname });

  const isImagensRoute =
    currentPath.startsWith("/imagens") || currentPath.startsWith("/como-usar-imagens");
  const workspacePath = isImagensRoute ? "/imagens" : "/";
  const tutorialPath = isImagensRoute ? "/como-usar-imagens" : "/como-usar";

  return (
    <SettingsProvider>
      <div className="relative min-h-screen text-foreground">
        {/*
          Lentes do Liquid Glass, usadas por .lg-lens::before via backdrop-filter.
          Em vez de ruido (feTurbulence), o deslocamento vem de mapas em gradiente:
          neutro (128) no centro e crescente so na faixa da borda, como o bevel
          das referencias. R desloca em x, G em y, B fica neutro. Chromium aplica;
          outros navegadores ignoram a lente e ficam so com o blur.
        */}
        <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
          <defs>
            <LensFilter id="lg-lens-card" bandX={0.05} bandY={0.07} scale={14} />
            <LensFilter id="lg-lens-pill" bandX={0.06} bandY={0.28} scale={7} />
          </defs>
        </svg>

        {/* Wallpaper Liquid Glass: navy profundo, feixes de luz e orbes que derivam */}
        <div className="fixed inset-0 -z-20 bg-black" />
        <div
          className="fixed inset-0 -z-10 overflow-hidden"
          style={{
            backgroundImage: [
              "linear-gradient(115deg, transparent 30%, rgba(40, 90, 200, 0.45) 55%, rgba(20, 50, 140, 0.25) 70%, transparent 90%)",
              "linear-gradient(295deg, transparent 40%, rgba(80, 140, 220, 0.18) 65%, transparent 85%)",
              "radial-gradient(ellipse 80% 60% at 75% 35%, rgba(30, 80, 180, 0.55), transparent 70%)",
              "radial-gradient(ellipse 70% 50% at 25% 80%, rgba(40, 100, 200, 0.4), transparent 70%)",
              "radial-gradient(ellipse 50% 40% at 90% 90%, rgba(60, 120, 220, 0.3), transparent 70%)",
              "linear-gradient(180deg, #050814 0%, #060a1c 50%, #04060f 100%)",
            ].join(","),
          }}
        >
          <div
            className="optmos-orb optmos-orb-a"
            style={{
              width: "42vw",
              height: "42vw",
              left: "-8vw",
              top: "-10vh",
              background: "radial-gradient(circle, rgba(99, 102, 241, 0.28), transparent 65%)",
            }}
          />
          <div
            className="optmos-orb optmos-orb-b"
            style={{
              width: "36vw",
              height: "36vw",
              right: "-6vw",
              bottom: "-12vh",
              background: "radial-gradient(circle, rgba(217, 70, 239, 0.22), transparent 65%)",
            }}
          />
        </div>

        <header className="sticky top-0 z-30 border-b border-white/5 bg-slate-950/40 backdrop-blur-xl">
          <div className="mx-auto grid max-w-7xl grid-cols-[auto_1fr_auto] items-center gap-4 px-6 py-4">
            <Link to="/" className="flex items-center gap-4 justify-self-start">
              <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-400 to-fuchsia-500 shadow-[0_0_30px_-5px_rgba(168,85,247,0.6)]">
                <img src="/logo.svg" alt="" className="h-10 w-10 object-contain" />
              </div>
              <div className="text-3xl font-bold tracking-tight text-white">OPTMOS</div>
            </Link>

            <div className="flex justify-center">
              <GlassPill>
                <NavPill to="/" active={!isImagensRoute} icon={TextSearch}>
                  SERP Optimizer
                </NavPill>
                <NavPill to="/imagens" active={isImagensRoute} icon={ImageIcon}>
                  Image Optimizer
                </NavPill>
              </GlassPill>
            </div>

            <div className="flex items-center justify-self-end">
              <GlassPill>
                <NavPill
                  to={workspacePath}
                  active={currentPath === workspacePath}
                  icon={LayoutDashboard}
                  compact
                >
                  Workspace
                </NavPill>
                <NavPill
                  to={tutorialPath}
                  active={currentPath === tutorialPath}
                  icon={BookOpen}
                  compact
                >
                  Como usar
                </NavPill>
              </GlassPill>
            </div>
          </div>
        </header>

        <Outlet />
        <Toaster richColors position="top-right" />
      </div>
    </SettingsProvider>
  );
}
