import {
  gemstoneExpress,
  gemstoneFastify,
  gemstoneHono,
} from "../src/index.ts";

const registeredTests: Array<() => Promise<void>> = [];

test("Hono middleware discards the lease when aborting an application error fails", async () => {
  const lease = new FakeLease();
  lease.session.abortError = new Error("abort failed");
  const middleware = gemstoneHono({ pool: new FakePool(lease) as never });

  await assertRejects(() => middleware({ set() {}, res: { status: 200 } }, async () => {
    throw new Error("handler failed");
  }));

  assertEqual(lease.session.calls.join(","), "abort");
  assertEqual(lease.releaseOptions[0]?.discard, true);
});

test("Fastify onResponse discards the lease when commit fails", async () => {
  const lease = new FakeLease();
  lease.session.commitError = new Error("commit failed");
  const hooks = new Map<string, Function>();
  await gemstoneFastify({
    decorateRequest() {},
    addHook(name: string, fn: Function) {
      hooks.set(name, fn);
    },
  }, { pool: new FakePool(lease) as never });

  const request: Record<string, unknown> = {};
  await hooks.get("onRequest")?.(request);
  await assertRejects(() => hooks.get("onResponse")?.(request, { statusCode: 200 }) as Promise<void>);

  assertEqual(lease.session.calls.join(","), "commit");
  assertEqual(lease.releaseOptions[0]?.discard, true);
});

test("Fastify clears leases after onError so onResponse does not finalize twice", async () => {
  const lease = new FakeLease();
  const hooks = new Map<string, Function>();
  await gemstoneFastify({
    decorateRequest() {},
    addHook(name: string, fn: Function) {
      hooks.set(name, fn);
    },
  }, { pool: new FakePool(lease) as never });

  const request: Record<string, unknown> = {};
  await hooks.get("onRequest")?.(request);
  await hooks.get("onError")?.(request);
  await hooks.get("onResponse")?.(request, { statusCode: 500 });

  assertEqual(lease.session.calls.join(","), "abort");
  assertEqual(lease.releaseOptions.length, 1);
});

test("Express middleware commits successful responses and releases cleanly", async () => {
  const lease = new FakeLease();
  const res = new FakeResponse(204);
  const middleware = gemstoneExpress({ pool: new FakePool(lease) as never });
  let nextCalls = 0;

  await middleware({}, res, (error?: unknown) => {
    if (error) throw error;
    nextCalls += 1;
  });
  await res.emit("finish");

  assertEqual(nextCalls, 1);
  assertEqual(lease.session.calls.join(","), "commit");
  assertEqual(lease.releaseOptions[0]?.clean, true);
});

class FakeSession {
  calls: string[] = [];
  commitError: Error | undefined;
  abortError: Error | undefined;

  async commit(): Promise<void> {
    this.calls.push("commit");
    if (this.commitError) throw this.commitError;
  }

  async abort(): Promise<void> {
    this.calls.push("abort");
    if (this.abortError) throw this.abortError;
  }
}

class FakeLease {
  readonly session = new FakeSession();
  readonly releaseOptions: Array<{ clean?: boolean; discard?: boolean }> = [];

  async release(options: { clean?: boolean; discard?: boolean } = {}): Promise<void> {
    this.releaseOptions.push(options);
  }
}

class FakePool {
  readonly lease: FakeLease;

  constructor(lease: FakeLease) {
    this.lease = lease;
  }

  async acquire(): Promise<FakeLease> {
    return this.lease;
  }

  async close(): Promise<void> {}
}

class FakeResponse {
  readonly statusCode: number;
  readonly #handlers = new Map<string, Array<() => void | Promise<void>>>();

  constructor(statusCode: number) {
    this.statusCode = statusCode;
  }

  on(name: string, handler: () => void | Promise<void>): void {
    const handlers = this.#handlers.get(name) ?? [];
    handlers.push(handler);
    this.#handlers.set(name, handlers);
  }

  async emit(name: string): Promise<void> {
    for (const handler of this.#handlers.get(name) ?? []) {
      await handler();
    }
  }
}

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
