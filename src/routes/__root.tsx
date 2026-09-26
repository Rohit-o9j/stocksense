import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useNavigate,
  useRouter,
  useRouterState,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { StockProvider } from "@/lib/stock";
import { AuthProvider, useAuth } from "@/lib/auth";
import { StockShell } from "@/components/stock-shell";
import { Button } from "@/components/ui/button";
import { captureError } from "../lib/error-reporting";

function NotFoundComponent() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4">
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

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    captureError(
      error,
      { boundary: "tanstack_root_error_component" },
      { mechanism: "react_error_boundary", handled: false },
    );
  }, [error]);

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </Button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "StockSense · Inventory management" },
      {
        name: "description",
        content:
          "Inventory operations, products, stock counts and movement history in one workspace.",
      },
      { name: "author", content: "Lovable" },
      { property: "og:title", content: "StockSense · Inventory management" },
      {
        property: "og:description",
        content:
          "Inventory operations, products, stock counts and movement history in one workspace.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Manrope:wght@400;500;600;700;800&display=swap",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
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

/**
 * Keeps the URL and the session in agreement: signed-out visitors are sent to
 * /auth, and signed-in ones are bounced off it. Waits for `isLoading` so a
 * refresh does not flash the sign-in screen before the cookie is read.
 */
/**
 * Routes that render on their own, without the application shell.
 *
 * `/about` is a full-bleed marketing page that ships its own header, nav and
 * footer, so putting it inside StockShell would give it two sets of chrome. It
 * also needs no session — its own call to action is what leads into the app.
 */
const STANDALONE_ROUTES = new Set(["/auth", "/about"]);
const PUBLIC_ROUTES = new Set(["/auth", "/about"]);

function SessionGate() {
  const { user, isLoading } = useAuth();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  const isAuthRoute = pathname === "/auth";
  const isPublic = PUBLIC_ROUTES.has(pathname);
  const isStandalone = STANDALONE_ROUTES.has(pathname);

  useEffect(() => {
    if (isLoading) return;
    if (!user && !isPublic) void navigate({ to: "/auth", replace: true });
    // Only bounce off the sign-in screen; a signed-in user may still read /about.
    if (user && isAuthRoute) void navigate({ to: "/", replace: true });
  }, [user, isLoading, isAuthRoute, isPublic, navigate]);

  // Public standalone pages render immediately — no need to wait on the session.
  if (isStandalone && !isAuthRoute) return <Outlet />;

  if (isLoading) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background">
        <p className="text-sm text-muted-foreground">Loading StockSense…</p>
      </div>
    );
  }

  if (isStandalone) return <Outlet />;

  // Render nothing rather than an empty shell while the redirect above runs.
  if (!user) return null;

  return (
    <StockProvider>
      <StockShell>
        <Outlet />
      </StockShell>
    </StockProvider>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const isStandalone = useRouterState({
    select: (state) => ["/auth", "/about"].includes(state.location.pathname),
  });
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <SessionGate />
      </AuthProvider>
    </QueryClientProvider>
  );
}
