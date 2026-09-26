/**
 * Runtime error reporting for StockSense.
 *
 * Normalizes an unknown throw into a structured report and fans it out to any
 * registered sinks. With no sink registered it falls back to `console.error`,
 * so a failure is never silently dropped.
 *
 * Register a sink once during app startup to forward reports somewhere durable:
 *
 *   registerErrorReporter((report) => {
 *     void fetch('/api/errors', {
 *       method: 'POST',
 *       headers: { 'content-type': 'application/json' },
 *       body: JSON.stringify({ ...report, error: undefined }),
 *     });
 *   });
 *
 * Deliberately standalone: `src/lib/error-capture.ts` patches `console.error`
 * as an import side effect, which is wanted on the server but not in the
 * browser, so this module does not import from it.
 */

export type ErrorSeverity = "error" | "warning" | "info";

export type ErrorMechanism = "manual" | "onerror" | "unhandledrejection" | "react_error_boundary";

export type CaptureOptions = {
  /** How the error reached us. Helps separate boundary catches from manual calls. */
  mechanism?: ErrorMechanism;
  /** False when the error escaped to a boundary rather than being handled inline. */
  handled?: boolean;
  severity?: ErrorSeverity;
};

export type ErrorReport = {
  message: string;
  stack?: string;
  severity: ErrorSeverity;
  mechanism: ErrorMechanism;
  handled: boolean;
  /** Path where the failure happened. Absent during server rendering. */
  route?: string;
  timestamp: string;
  context: Record<string, unknown>;
  /** The original throw, for sinks that serialize it themselves. */
  error: unknown;
};

export type ErrorReporter = (report: ErrorReport) => void;

const reporters = new Set<ErrorReporter>();

/**
 * Attach a sink — an HTTP endpoint, a logging service, a test spy. Returns a
 * function that detaches it again, suitable for a `useEffect` cleanup.
 */
export function registerErrorReporter(reporter: ErrorReporter): () => void {
  reporters.add(reporter);
  return () => {
    reporters.delete(reporter);
  };
}

/** Detach every sink. Intended for tests. */
export function clearErrorReporters(): void {
  reporters.clear();
}

/**
 * Turn an unknown throw into a readable message.
 *
 * Router loaders and server functions commonly throw a raw `Response`, whose
 * `String()` form is the opaque "[object Response]" — pull out the status and
 * URL instead.
 */
export function describeThrown(error: unknown): string {
  if (error instanceof Response) {
    return `Response ${error.status}${error.url ? ` at ${error.url}` : ""}`;
  }
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error) ?? String(error);
  } catch {
    return String(error);
  }
}

/**
 * Report an error. Returns the report so callers can log or assert against it.
 */
export function captureError(
  error: unknown,
  context: Record<string, unknown> = {},
  options: CaptureOptions = {},
): ErrorReport {
  const stack = error instanceof Error ? error.stack : undefined;
  const route = typeof window === "undefined" ? undefined : window.location.pathname;

  const report: ErrorReport = {
    message: describeThrown(error),
    ...(stack !== undefined && { stack }),
    severity: options.severity ?? "error",
    mechanism: options.mechanism ?? "manual",
    handled: options.handled ?? false,
    ...(route !== undefined && { route }),
    timestamp: new Date().toISOString(),
    context,
    error,
  };

  if (reporters.size === 0) {
    logFallback(report);
    return report;
  }

  for (const reporter of reporters) {
    try {
      reporter(report);
    } catch {
      // A failing sink must never mask the error it was handed.
    }
  }

  return report;
}

function logFallback(report: ErrorReport): void {
  const where = report.route === undefined ? "" : ` (${report.route})`;
  const label = `[${report.severity}] ${report.mechanism}${where}: ${report.message}`;

  // Pass the original throw through so devtools renders a clickable stack, and
  // so the server-side console.error patch can expand its cause chain.
  const extras: unknown[] = [];
  if (report.error instanceof Error || report.error instanceof Response) {
    extras.push(report.error);
  }
  if (Object.keys(report.context).length > 0) extras.push(report.context);

  console.error(label, ...extras);
}
