import {
  InMemoryMetrics,
  InMemoryTracer,
  observe,
} from "../src/index.ts";

const registeredTests: Array<() => Promise<void>> = [];

test("observe records successful spans and metrics", async () => {
  const tracer = new InMemoryTracer();
  const metrics = new InMemoryMetrics();

  const result = await observe("execute", { stone: "demo" }, tracer, metrics, undefined, async () => 42);

  assertEqual(result, 42);
  assertEqual(metrics.increments.length, 1);
  assertEqual(metrics.increments[0].name, "gemstone_js_session_operations");
  assertEqual(metrics.increments[0].labels?.operation, "execute");
  assertEqual(metrics.increments[0].labels?.status, "ok");
  assertEqual(metrics.durations.length, 1);
  assertEqual(metrics.durations[0].labels?.status, "ok");
  assertEqual(tracer.spans.length, 1);
  assertEqual(tracer.spans[0].name, "gemstone.session.execute");
  assertEqual(tracer.spans[0].attributes.stone, "demo");
  assertEqual(tracer.spans[0].attributes.status, "ok");
  assertEqual(tracer.spans[0].status, "ok");
  assertEqual(tracer.spans[0].ended, true);
});

test("observe records failed spans and metrics once", async () => {
  const tracer = new InMemoryTracer();
  const metrics = new InMemoryMetrics();
  const failure = new Error("boom");

  await assertRejects(() => observe("perform", undefined, tracer, metrics, undefined, async () => {
    throw failure;
  }));

  assertEqual(metrics.increments.length, 1);
  assertEqual(metrics.increments[0].labels?.status, "error");
  assertEqual(metrics.durations[0].labels?.status, "error");
  assertEqual(tracer.spans.length, 1);
  assertEqual(tracer.spans[0].attributes.status, "error");
  assertEqual(tracer.spans[0].status, "error");
  assertEqual(tracer.spans[0].exceptions.length, 1);
  assertEqual(tracer.spans[0].exceptions[0], failure);
});

test("in-memory observability recorders can be cleared", () => {
  const tracer = new InMemoryTracer();
  const metrics = new InMemoryMetrics();

  metrics.increment("count");
  metrics.recordDuration("duration", undefined, 3);
  tracer.startSpan("span").end();

  metrics.clear();
  tracer.clear();

  assertEqual(metrics.increments.length, 0);
  assertEqual(metrics.durations.length, 0);
  assertEqual(tracer.spans.length, 0);
});

for (const run of registeredTests) {
  await run();
}

function test(name: string, fn: () => void | Promise<void>): void {
  registeredTests.push(async () => {
    try {
      await fn();
    } catch (error) {
      if (error instanceof Error) {
        error.message = `${name}: ${error.message}`;
      }
      throw error;
    }
  });
}

function assertEqual<T>(actual: T, expected: T): void {
  if (actual !== expected) {
    throw new Error(`expected ${String(expected)}, got ${String(actual)}`);
  }
}

async function assertRejects(fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch {
    return;
  }
  throw new Error("expected rejection");
}
