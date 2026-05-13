export type MetricLabels = Readonly<Record<string, string | number | boolean | null | undefined>>;
export type SpanAttributes = Readonly<Record<string, string | number | boolean | null | undefined>>;

export interface Span {
  setAttribute(key: string, value: string | number | boolean | null | undefined): void;
  recordException(error: unknown): void;
  end?(status?: "ok" | "error"): void;
}

export interface SpanContext {
  span: Span;
  end(error?: unknown): void;
}

export interface Tracer {
  startSpan(name: string, attrs?: SpanAttributes): SpanContext;
}

export interface MetricsCollector {
  increment(name: string, labels?: MetricLabels, value?: number): void;
  recordDuration(name: string, labels: MetricLabels | undefined, durationMs: number): void;
}

class NullSpan implements Span {
  setAttribute(_key: string, _value: string | number | boolean | null | undefined): void {}
  recordException(_error: unknown): void {}
  end(_status?: "ok" | "error"): void {}
}

class NullSpanContext implements SpanContext {
  readonly span = NULL_SPAN;
  end(_error?: unknown): void {}
}

export class NullTracer implements Tracer {
  startSpan(_name: string, _attrs?: SpanAttributes): SpanContext {
    return NULL_SPAN_CONTEXT;
  }
}

export class NullMetrics implements MetricsCollector {
  increment(_name: string, _labels?: MetricLabels, _value = 1): void {}
  recordDuration(_name: string, _labels: MetricLabels | undefined, _durationMs: number): void {}
}

export const NULL_SPAN = new NullSpan();
export const NULL_SPAN_CONTEXT = new NullSpanContext();
export const NULL_TRACER = new NullTracer();
export const NULL_METRICS = new NullMetrics();

export class OpenTelemetryTracer implements Tracer {
  readonly #tracer: {
    startActiveSpan?: (name: string, options: unknown, callback: (span: unknown) => unknown) => unknown;
    startSpan?: (name: string, options?: unknown) => unknown;
  };

  constructor(tracer: {
    startActiveSpan?: (name: string, options: unknown, callback: (span: unknown) => unknown) => unknown;
    startSpan?: (name: string, options?: unknown) => unknown;
  }) {
    this.#tracer = tracer;
  }

  startSpan(name: string, attrs?: SpanAttributes): SpanContext {
    const raw = this.#tracer.startSpan?.(name, { attributes: { ...(attrs ?? {}) } });
    const span = new OpenTelemetrySpan(raw);
    return {
      span,
      end(error?: unknown) {
        if (error !== undefined) span.recordException(error);
        span.end(error === undefined ? "ok" : "error");
      },
    };
  }
}

class OpenTelemetrySpan implements Span {
  readonly #span: unknown;

  constructor(span: unknown) {
    this.#span = span;
  }

  setAttribute(key: string, value: string | number | boolean | null | undefined): void {
    const span = this.#span as { setAttribute?: (key: string, value: unknown) => void };
    span.setAttribute?.(key, value);
  }

  recordException(error: unknown): void {
    const span = this.#span as { recordException?: (error: unknown) => void };
    span.recordException?.(error);
  }

  end(status?: "ok" | "error"): void {
    const span = this.#span as {
      setStatus?: (status: { code: number; message?: string }) => void;
      end?: () => void;
    };
    if (status === "error") {
      span.setStatus?.({ code: 2, message: "GemStone operation failed" });
    }
    span.end?.();
  }
}

export async function observe<T>(
  operation: string,
  attrs: SpanAttributes | undefined,
  tracer: Tracer | undefined,
  metrics: MetricsCollector | undefined,
  slowQueryThresholdMs: number | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  if (!tracer && !metrics && slowQueryThresholdMs === undefined) {
    return fn();
  }

  const labels = { operation };
  const spanContext = (tracer ?? NULL_TRACER).startSpan(`gemstone.session.${operation}`, attrs);
  const started = performance.now();
  try {
    const result = await fn();
    const durationMs = performance.now() - started;
    spanContext.span.setAttribute("duration_ms", durationMs);
    spanContext.span.setAttribute("status", "ok");
    spanContext.end();
    metrics?.increment("gemstone_js_session_operations", { ...labels, status: "ok" });
    metrics?.recordDuration("gemstone_js_session_duration_ms", { ...labels, status: "ok" }, durationMs);
    warnIfSlow(operation, durationMs, slowQueryThresholdMs, "ok");
    return result;
  } catch (error) {
    const durationMs = performance.now() - started;
    spanContext.span.setAttribute("duration_ms", durationMs);
    spanContext.span.setAttribute("status", "error");
    spanContext.span.recordException(error);
    spanContext.end(error);
    metrics?.increment("gemstone_js_session_operations", { ...labels, status: "error" });
    metrics?.recordDuration("gemstone_js_session_duration_ms", { ...labels, status: "error" }, durationMs);
    warnIfSlow(operation, durationMs, slowQueryThresholdMs, "error");
    throw error;
  }
}

function warnIfSlow(
  operation: string,
  durationMs: number,
  threshold: number | undefined,
  status: "ok" | "error",
): void {
  if (threshold === undefined || durationMs < threshold) return;
  console.warn(`slow GemStone operation ${operation} took ${durationMs.toFixed(3)}ms`, {
    gemstoneOperation: operation,
    durationMs,
    status,
  });
}
