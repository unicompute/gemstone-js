import {
  gemstoneExpress,
  gemstoneFastify,
  gemstoneFetch,
  gemstoneHono,
  withGemStoneFetch,
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

test("Fastify onResponse aborts after failed commits before releasing cleanly", async () => {
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

  assertEqual(lease.session.calls.join(","), "commit,abort");
  assertEqual(lease.releaseOptions[0]?.clean, true);
  assertEqual(lease.releaseOptions[0]?.discard, false);
});

test("Fastify onResponse discards the lease when commit cleanup abort fails", async () => {
  const lease = new FakeLease();
  lease.session.commitError = new Error("commit failed");
  lease.session.abortError = new Error("abort failed");
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

  assertEqual(lease.session.calls.join(","), "commit,abort");
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

test("Express middleware exposes request scope and aborts default client errors", async () => {
  const lease = new FakeLease();
  const res = new FakeResponse(404);
  const req: Record<string, unknown> = {};
  const middleware = gemstoneExpress({ pool: new FakePool(lease) as never });

  await middleware(req, res, (error?: unknown) => {
    if (error) throw error;
  });
  await res.emit("finish");

  assertEqual(req.gemstoneSession, lease.session);
  assertEqual(Boolean(req.gemstoneScope), true);
  assertEqual(lease.session.calls.join(","), "abort");
  assertEqual(lease.releaseOptions[0]?.clean, true);
});

test("Hono middleware honors custom server error status", async () => {
  const lease = new FakeLease();
  const context = new FakeHonoContext(499);
  const middleware = gemstoneHono({ pool: new FakePool(lease) as never, serverErrorStatus: 500 });

  await middleware(context, async () => {});

  assertEqual(context.values.get("gemstoneSession"), lease.session);
  assertEqual(Boolean(context.values.get("gemstoneScope")), true);
  assertEqual(lease.session.calls.join(","), "commit");
});

test("Fetch adapter commits returned successful responses", async () => {
  const lease = new FakeLease();
  const pool = new FakePool(lease);
  const app = gemstoneFetch(async (_request, context) => {
    assertEqual(context.session, lease.session as never);
    return new Response("ok", { status: 200 });
  }, { pool: pool as never });

  const response = await app(new Request("http://example.test/health"));
  await app.close();

  assertEqual(response.status, 200);
  assertEqual(lease.session.calls.join(","), "commit");
  assertEqual(lease.releaseOptions[0]?.clean, true);
  assertEqual(pool.closeCalls, 1);
});

test("Fetch adapter aborts returned client errors by default", async () => {
  const lease = new FakeLease();
  const app = gemstoneFetch(async () => new Response("missing", { status: 404 }), {
    pool: new FakePool(lease) as never,
  });

  const response = await app(new Request("http://example.test/missing"));

  assertEqual(response.status, 404);
  assertEqual(lease.session.calls.join(","), "abort");
  assertEqual(lease.releaseOptions[0]?.clean, true);
});

test("Fetch adapter honors custom server error status", async () => {
  const lease = new FakeLease();
  await withGemStoneFetch(
    new Request("http://example.test/not-found"),
    { pool: new FakePool(lease) as never, serverErrorStatus: 500 },
    async () => new Response("not found", { status: 404 }),
  );

  assertEqual(lease.session.calls.join(","), "commit");
});

test("Fetch adapter finalizes thrown Responses by status", async () => {
  const lease = new FakeLease();
  const app = gemstoneFetch(async () => {
    throw new Response("redirect", { status: 302 });
  }, {
    pool: new FakePool(lease) as never,
  });

  await assertRejects(() => app(new Request("http://example.test/redirect")));

  assertEqual(lease.session.calls.join(","), "commit");
  assertEqual(lease.releaseOptions[0]?.clean, true);
});

test("Fetch adapter aborts thrown application errors and validates returned values", async () => {
  const errorLease = new FakeLease();
  const errorApp = gemstoneFetch(async () => {
    throw new Error("handler failed");
  }, { pool: new FakePool(errorLease) as never });

  await assertRejects(() => errorApp(new Request("http://example.test/error")));

  assertEqual(errorLease.session.calls.join(","), "abort");

  const invalidLease = new FakeLease();
  const invalidApp = gemstoneFetch(async () => "ok" as never, {
    pool: new FakePool(invalidLease) as never,
  });

  await assertRejects(() => invalidApp(new Request("http://example.test/invalid")));

  assertEqual(invalidLease.session.calls.join(","), "abort");
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
  closeCalls = 0;

  constructor(lease: FakeLease) {
    this.lease = lease;
  }

  async acquire(): Promise<FakeLease> {
    return this.lease;
  }

  async close(): Promise<void> {
    this.closeCalls += 1;
  }
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

class FakeHonoContext {
  readonly values = new Map<string, unknown>();
  readonly res: { status: number };

  constructor(status: number) {
    this.res = { status };
  }

  set(key: string, value: unknown): void {
    this.values.set(key, value);
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
