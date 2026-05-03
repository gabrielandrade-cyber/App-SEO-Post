import { Outlet, Link, createRootRoute, HeadContent, Scripts, useRouterState } from "@tanstack/react-router";
import { Toaster } from "@/components/ui/sonner";
import { Sparkles, BookOpen, LayoutDashboard, ImageIcon, TextSearch } from "lucide-react";

import appCss from "../styles.css?url";
import { SettingsProvider } from "../lib/store";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "OPTMOS" },
      { name: "description", content: "OPTMOS - Liquid intelligence for your metadata" },
      { name: "author", content: "Gabriel Andrade" },
      { property: "og:title", content: "OPTMOS" },
      { property: "og:description", content: "Lovable Generated Project" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:site", content: "@Lovable" },
    ],
    links: [
      {
        rel: "icon",
        href: "/logo.svg",
      },
      {
        rel: "stylesheet",
        href: appCss,
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
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

function RootComponent() {
  const routerState = useRouterState();
  const currentPath = routerState.location.pathname;

  const isImagensRoute = currentPath.startsWith("/imagens") || currentPath.startsWith("/como-usar-imagens");
  const workspacePath = isImagensRoute ? "/imagens" : "/";
  const tutorialPath = isImagensRoute ? "/como-usar-imagens" : "/como-usar";

  return (
    <SettingsProvider>
      <div className="dark min-h-screen text-foreground relative overflow-hidden">
      {/* SVG filter for Liquid Glass distortion — referenced by .liquid-glass-card::after */}
      <svg
        width="0"
        height="0"
        style={{ position: "absolute" }}
        aria-hidden="true"
      >
        <defs>
          <filter id="glass-distortion" x="0%" y="0%" width="100%" height="100%">
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.01 0.01"
              numOctaves={2}
              seed={92}
              result="noise"
            />
            <feGaussianBlur in="noise" stdDeviation="2" result="blurred" />
            <feDisplacementMap
              in="SourceGraphic"
              in2="blurred"
              scale={55}
              xChannelSelector="R"
              yChannelSelector="G"
            />
          </filter>
        </defs>
      </svg>

      {/* iOS 26 Liquid Glass — deep navy wallpaper with diagonal light streaks */}
      <div className="fixed inset-0 -z-20 bg-black" />
      <div
        className="fixed inset-0 -z-10"
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
      />

      {/* Shared Header */}
      <header className="sticky top-0 z-20 border-b border-white/5 bg-slate-950/40 backdrop-blur-xl">
        <div className="mx-auto grid grid-cols-3 items-center px-6 py-4 max-w-7xl">
          {/* Logo (Esquerda) */}
          <div className="flex items-center gap-4 justify-self-start">
            <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-400 to-fuchsia-500 shadow-[0_0_30px_-5px_rgba(168,85,247,0.6)]">
              <img src="/logo.svg" alt="OPTMOS Logo" className="h-10 w-10 object-contain" />
            </div>
            <div>
              <h1 className="text-3xl font-bold tracking-tight text-white">OPTMOS</h1>
            </div>
          </div>

          {/* Seletor Central (SERP vs Imagens) */}
          <div className="flex justify-center justify-self-center">
            <nav className="flex items-center rounded-full border border-white/10 bg-white/5 p-1 backdrop-blur-xl">
              <Link
                to="/"
                className={`flex items-center gap-2 rounded-full px-5 py-2 text-sm font-medium transition-all duration-300 ${!isImagensRoute
                  ? "bg-white/10 text-white shadow-[0_0_15px_-5px_rgba(255,255,255,0.3)]"
                  : "text-white/60 hover:text-white hover:bg-white/[0.05]"
                  }`}
              >
                <TextSearch className="h-4 w-4" />
                <span className="hidden sm:inline">SERP Optimizer</span>
              </Link>
              <Link
                to="/imagens"
                className={`flex items-center gap-2 rounded-full px-5 py-2 text-sm font-medium transition-all duration-300 ${isImagensRoute
                  ? "bg-white/10 text-white shadow-[0_0_15px_-5px_rgba(255,255,255,0.3)]"
                  : "text-white/60 hover:text-white hover:bg-white/[0.05]"
                  }`}
              >
                <ImageIcon className="h-4 w-4" />
                <span className="hidden sm:inline">Image Optimizer</span>
              </Link>
            </nav>
          </div>

          {/* Menu Contextual (Direita) */}
          <div className="flex items-center gap-4 justify-self-end">
            <nav className="flex items-center rounded-full border border-white/10 bg-white/5 p-1 backdrop-blur-xl">
              <Link
                to={workspacePath}
                className={`flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-medium transition-all duration-300 ${currentPath === workspacePath
                  ? "bg-white/10 text-white shadow-[0_0_15px_-5px_rgba(255,255,255,0.3)]"
                  : "text-white/60 hover:text-white hover:bg-white/[0.05]"
                  }`}
              >
                <LayoutDashboard className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Workspace</span>
              </Link>
              <Link
                to={tutorialPath}
                className={`flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-medium transition-all duration-300 ${currentPath === tutorialPath
                  ? "bg-white/10 text-white shadow-[0_0_15px_-5px_rgba(255,255,255,0.3)]"
                  : "text-white/60 hover:text-white hover:bg-white/[0.05]"
                  }`}
              >
                <BookOpen className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Como Usar</span>
              </Link>
            </nav>
          </div>
        </div>
      </header>

      <Outlet />
      <Toaster richColors position="top-right" />
    </div>
    </SettingsProvider>
  );
}
